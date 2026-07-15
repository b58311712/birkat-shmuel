// =============================================================================
// שירות שליחת מיילים (סעיף 18)
// =============================================================================
// - נוסחי המייל נשמרים ב-email_templates ונערכים ע"י המנהל (דינמיות, סעיף 3).
// - placeholders בסוגריים מסולסלים ({customer_name}, {order_number}...) מוחלפים
//   בזמן השליחה.
// - "מצב יבש": אם אין SMTP מוגדר ב-.env, המייל *לא נשלח* אלא מתועד ב-email_log
//   עם status='dry_run'. כך אפשר לבדוק את כל הזרימה בלי חשבון מייל אמיתי.
//   ברגע שמוגדרים משתני SMTP — המערכת עוברת אוטומטית לשליחה אמיתית.
// - כל שליחה (אמיתית או יבשה) מתועדת ב-email_log; כשל בשליחה לא מפיל את הבקשה
//   שקראה לשירות (המייל הוא תופעת-לוואי, לא חלק מהטרנזקציה).
// =============================================================================
import nodemailer from 'nodemailer';
import { supabase } from '../lib/supabase.js';
import { renderBrandedEmail } from './emailTemplate.js';
import { isGmailApiConfigured, sendViaGmailApi } from './gmailApi.js';

// תיאורים בעברית לאמצעי תשלום — לשימוש ב-placeholder {payment_method}
const PAYMENT_METHOD_HE = {
  bank_transfer: 'העברה בנקאית',
  cash: 'מזומן',
  check: 'צ׳ק',
};

// --- הגדרת SMTP מתוך משתני סביבה ---
// אם SMTP_HOST חסר — המערכת במצב יבש.
function smtpConfig() {
  const host = process.env.SMTP_HOST;
  if (!host) return null;
  return {
    host,
    port: Number(process.env.SMTP_PORT) || 587,
    secure: String(process.env.SMTP_SECURE) === 'true', // true ל-465, false ל-587 (STARTTLS)
    // מכריחים חיבור מעל IPv4. ב-Render (ובחלק מהסביבות) אין ניתוב IPv6 יוצא
    // ל-SMTP של Gmail, ואז ה-DNS מחזיר כתובת IPv6 והחיבור נכשל ב-ENETUNREACH
    // / Connection timeout. family:4 מכריח resolve ל-A record (IPv4) ומייצב שליחה.
    family: 4,
    // תקרות זמן — כדי ששליחה תקועה תיכשל מהר במקום להישאר תלויה דקות ברקע.
    connectionTimeout: 10000, // המתנה מרבית לחיבור TCP
    greetingTimeout: 10000,   // המתנה מרבית ל-greeting של השרת
    socketTimeout: 20000,     // חוסר-פעילות מרבי על הסוקט
    auth: process.env.SMTP_USER
      ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
      : undefined,
  };
}

let cachedTransporter;
function getTransporter() {
  if (cachedTransporter !== undefined) return cachedTransporter;
  const config = smtpConfig();
  cachedTransporter = config ? nodemailer.createTransport(config) : null;
  return cachedTransporter;
}

// מצב יבש רק אם אין שום מסלול שליחה אמיתי: לא Gmail API ולא SMTP.
// עדיפות בשליחה: Gmail API (HTTPS/443, עובד ב-Render) → SMTP (fallback מקומי).
export function isDryRun() {
  return !isGmailApiConfigured() && getTransporter() === null;
}

// כתובת השולח — מ-.env, עם ברירת מחדל סבירה.
function fromAddress() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || 'מטבח החסד <no-reply@matbach-hachesed.local>';
}

// כתובת המשרד — היעד היחיד לכל מיילי ההתראה למנהל המערכת.
// כל התראות המנהל (למשל "הזמנה חדשה") נשלחות *רק* לתיבת המשרד, ולא לכל
// המשתמשים בהרשאת מנהל. ניתן לעקוף דרך .env, אך ברירת המחדל היא תיבת המשרד.
export function officeEmail() {
  return process.env.OFFICE_EMAIL || 'b58311712@gmail.com';
}

// --- מילוי placeholders ---
// מחליף {key} בערך מהמפה. מפתח חסר נשאר ריק (ולא משאיר "{key}" מבלבל בגוף).
function fillTemplate(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ''
  );
}

// --- טעינת נוסח פעיל לפי code ---
async function loadTemplate(code) {
  const { data, error } = await supabase
    .from('email_templates')
    .select('code, subject, body, is_active')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// --- תיעוד ליומן (לא זורק — כישלון תיעוד לא צריך להפיל את הזרימה) ---
async function logEmail(row) {
  const { error } = await supabase.from('email_log').insert(row);
  if (error) console.warn('email_log insert failed:', error.message);
}

// =============================================================================
// sendTemplateEmail — הפונקציה המרכזית.
//   code      — מזהה הנוסח ב-email_templates
//   to        — כתובת נמען (אם ריקה, מדלגים בשקט; לקוח ללא מייל, סעיף 18.4)
//   vars      — ערכים ל-placeholders
//   orderId   — קישור אופציונלי להזמנה ליומן
// מחזיר { status } או null אם דילגנו (אין נמען / אין נוסח פעיל).
// =============================================================================
export async function sendTemplateEmail({ code, to, vars = {}, orderId = null }) {
  try {
    if (!to) return null; // אין מייל לנמען — סעיף 18.4: תיפול חזרה להתראה פנימית ע"י הקורא

    const tpl = await loadTemplate(code);
    if (!tpl || !tpl.is_active) {
      console.warn(`email template "${code}" missing or inactive — skipping.`);
      return null;
    }

    const subject = fillTemplate(tpl.subject, vars);
    const body = fillTemplate(tpl.body, vars);

    if (isDryRun()) {
      // מצב יבש — מתעדים ולא שולחים.
      await logEmail({ template_code: code, to_email: to, subject, body, status: 'dry_run', order_id: orderId });
      return { status: 'dry_run' };
    }

    // עוטפים את גוף הטקסט של המנהל במעטפת HTML רשמית; הטקסט נשמר כגיבוי.
    const html = renderBrandedEmail({ subject, body });

    try {
      if (isGmailApiConfigured()) {
        // מסלול מועדף — Gmail API על HTTPS/443 (עובד ב-Render, שחוסמת SMTP).
        await sendViaGmailApi({ from: fromAddress(), to, subject, text: body, html });
      } else {
        // fallback — SMTP דרך nodemailer (עובד מקומית; ב-Render נחסם).
        await getTransporter().sendMail({
          from: fromAddress(),
          to,
          subject,
          text: body,
          html,
        });
      }
      await logEmail({ template_code: code, to_email: to, subject, body, status: 'sent', order_id: orderId });
      return { status: 'sent' };
    } catch (sendErr) {
      await logEmail({
        template_code: code, to_email: to, subject, body,
        status: 'failed', error: sendErr.message, order_id: orderId,
      });
      return { status: 'failed' };
    }
  } catch (e) {
    // כל כשל לא-צפוי לא מפיל את הבקשה שקראה לשירות.
    console.warn(`sendTemplateEmail(${code}) failed:`, e.message);
    return null;
  }
}

// --- עוזר: בניית ערכי placeholder נפוצים מהזמנה+לקוח+שבת ---
export function orderVars({ order, customer, shabbat }) {
  return {
    customer_name: customer?.full_name || '',
    order_number: order?.order_number || '',
    parasha: shabbat?.parasha || '',
    final_amount: order?.final_amount != null ? Number(order.final_amount).toFixed(2) : '',
    payment_method: PAYMENT_METHOD_HE[order?.preferred_payment_method] || '',
    payment_deadline: shabbat?.payment_deadline || '',
  };
}
