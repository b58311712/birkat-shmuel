// =============================================================================
// שירות שליחת מיילים (סעיף 18)
// =============================================================================
// - נוסחי המייל נשמרים ב-email_templates ונערכים ע"י המנהל (דינמיות, סעיף 3).
// - placeholders בסוגריים מסולסלים ({customer_name}, {order_number}...) מוחלפים
//   בזמן השליחה.
// - "מצב יבש": אם אין SMTP מוגדר ב-.env, המייל *לא נשלח* אלא מתועד ב-email_log
//   עם status='dry_run'. כך אפשר לבדוק את כל הזרימה בלי חשבון מייל אמיתי.
//   ברגע שמוגדרים משתני SMTP - המערכת עוברת אוטומטית לשליחה אמיתית.
// - כל שליחה (אמיתית או יבשה) מתועדת ב-email_log; כשל בשליחה לא מפיל את הבקשה
//   שקראה לשירות (המייל הוא תופעת-לוואי, לא חלק מהטרנזקציה).
// =============================================================================
import nodemailer from 'nodemailer';
import { supabase } from '../lib/supabase.js';
import { renderBrandedEmail } from './emailTemplate.js';
import { isGmailApiConfigured, sendViaGmailApi } from './gmailApi.js';

// תיאורים בעברית לאמצעי תשלום - לשימוש ב-placeholder {payment_method}, ומיוצא
// גם לבניית פירוט ההזמנה המלא (orderDetailsText.js).
export const PAYMENT_METHOD_HE = {
  bank_transfer: 'העברה בנקאית',
  cash: 'מזומן',
  check: 'צ׳ק',
};

// --- הגדרת SMTP מתוך משתני סביבה ---
// אם SMTP_HOST חסר - המערכת במצב יבש.
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
    // תקרות זמן - כדי ששליחה תקועה תיכשל מהר במקום להישאר תלויה דקות ברקע.
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

// כתובת השולח - מ-.env, עם ברירת מחדל סבירה.
function fromAddress() {
  return process.env.SMTP_FROM || process.env.SMTP_USER || 'מטבח החסד <no-reply@matbach-hachesed.local>';
}

// כתובת המשרד - היעד היחיד לכל מיילי ההתראה למנהל המערכת.
// כל התראות המנהל (למשל "הזמנה חדשה") נשלחות *רק* לתיבת המשרד, ולא לכל
// המשתמשים בהרשאת מנהל. ניתן לעקוף דרך .env, אך ברירת המחדל היא תיבת המשרד.
export function officeEmail() {
  return process.env.OFFICE_EMAIL || 'b58311712@gmail.com';
}

// --- מילוי placeholders ---
// מחליף {key} בערך מהמפה. מפתח חסר נשאר ריק (ולא משאיר "{key}" מבלבל בגוף).
// מיוצא כדי שקורא שבונה תצוגה מקדימה לעריכה (הזמנת רכש לספק) ימלא בדיוק את
// אותם placeholders שהשליחה הייתה ממלאת.
export function fillTemplate(text, vars) {
  return String(text || '').replace(/\{(\w+)\}/g, (_, key) =>
    vars[key] != null ? String(vars[key]) : ''
  );
}

// --- טעינת נוסח פעיל לפי code ---
// מיוצאת גם לשימוש מחוץ למייל (למשל shabbatFile.js קורא נוסח שמודפס בלבד,
// order_instructions_print, ולא נשלח כמייל בפועל).
export async function loadTemplate(code) {
  const { data, error } = await supabase
    .from('email_templates')
    .select('code, subject, body, is_active')
    .eq('code', code)
    .maybeSingle();
  if (error) throw error;
  return data;
}

// --- תיעוד ליומן (לא זורק - כישלון תיעוד לא צריך להפיל את הזרימה) ---
async function logEmail(row) {
  const { error } = await supabase.from('email_log').insert(row);
  if (error) console.warn('email_log insert failed:', error.message);
}

// =============================================================================
// deliverEmail - השליחה בפועל + התיעוד ביומן. הנוסח שמגיע לכאן כבר סופי
// (placeholders מולאו, ואולי גם נערך ידנית לפני השליחה - ראו sendCustomEmail).
// מחזיר { status, error } ולעולם לא זורק.
// =============================================================================
async function deliverEmail({ code, to, cc = null, subject, body, orderId = null, purchaseOrderId = null }) {
  const logRow = {
    template_code: code,
    to_email: to,
    cc_email: cc || null,
    subject,
    body,
    order_id: orderId,
    purchase_order_id: purchaseOrderId,
  };

  if (isDryRun()) {
    // מצב יבש - מתעדים ולא שולחים.
    await logEmail({ ...logRow, status: 'dry_run' });
    return { status: 'dry_run', error: null };
  }

  // עוטפים את גוף הטקסט של המנהל במעטפת HTML רשמית; הטקסט נשמר כגיבוי.
  const html = renderBrandedEmail({ subject, body });

  try {
    if (isGmailApiConfigured()) {
      // מסלול מועדף - Gmail API על HTTPS/443 (עובד ב-Render, שחוסמת SMTP).
      await sendViaGmailApi({ from: fromAddress(), to, cc, subject, text: body, html });
    } else {
      // fallback - SMTP דרך nodemailer (עובד מקומית; ב-Render נחסם).
      await getTransporter().sendMail({
        from: fromAddress(),
        to,
        ...(cc ? { cc } : {}),
        subject,
        text: body,
        html,
      });
    }
    await logEmail({ ...logRow, status: 'sent' });
    return { status: 'sent', error: null };
  } catch (sendErr) {
    await logEmail({ ...logRow, status: 'failed', error: sendErr.message });
    return { status: 'failed', error: sendErr.message };
  }
}

// =============================================================================
// sendCustomEmail - שליחת נוסח סופי שכבר נערך ידנית (הזמנת רכש לספק: המנהלת
// רואה תצוגה מקדימה, מתקנת נמען/נושא/גוף, ורק אז שולחת). בניגוד ל-
// sendTemplateEmail כאן *לא* נטען נוסח מ-email_templates ולא ממולאים
// placeholders - הקורא אחראי לנוסח הסופי. code נשמר ליומן לצורך סיווג בלבד.
// מחזיר { status, error }; זורק רק על קלט חסר (באג של הקורא, לא כשל שליחה).
// =============================================================================
export async function sendCustomEmail({ code, to, cc = null, subject, body, orderId = null, purchaseOrderId = null }) {
  if (!to) throw new Error('חסר נמען.');
  if (!String(subject || '').trim()) throw new Error('חסר נושא המייל.');
  if (!String(body || '').trim()) throw new Error('חסר גוף המייל.');
  return deliverEmail({ code, to, cc, subject, body, orderId, purchaseOrderId });
}

// =============================================================================
// sendTemplateEmail - הפונקציה המרכזית.
//   code      - מזהה הנוסח ב-email_templates
//   to        - כתובת נמען (אם ריקה, מדלגים בשקט; לקוח ללא מייל, סעיף 18.4)
//   vars      - ערכים ל-placeholders
//   orderId   - קישור אופציונלי להזמנה ליומן
// מחזיר { status } או null אם דילגנו (אין נמען / אין נוסח פעיל).
// =============================================================================
export async function sendTemplateEmail({ code, to, vars = {}, orderId = null }) {
  try {
    if (!to) return null; // אין מייל לנמען - סעיף 18.4: תיפול חזרה להתראה פנימית ע"י הקורא

    const tpl = await loadTemplate(code);
    if (!tpl || !tpl.is_active) {
      console.warn(`email template "${code}" missing or inactive - skipping.`);
      return null;
    }

    const subject = fillTemplate(tpl.subject, vars);
    const body = fillTemplate(tpl.body, vars);

    const { status } = await deliverEmail({ code, to, subject, body, orderId });
    return { status };
  } catch (e) {
    // כל כשל לא-צפוי לא מפיל את הבקשה שקראה לשירות.
    console.warn(`sendTemplateEmail(${code}) failed:`, e.message);
    return null;
  }
}

// --- עוזר: בניית ערכי placeholder לבקשת רישום לקוח (סעיף 7) ---
// משמש גם להתראת המשרד וגם למייל החוזר ללקוח. reason רלוונטי רק בדחייה.
export function registrationVars({ registration, reason = '' }) {
  return {
    full_name: registration?.full_name || '',
    phone: registration?.phone || '',
    email: registration?.email || '',
    address: registration?.address || '',
    reject_reason: reason || '',
  };
}

// --- עוזר: בניית ערכי placeholder נפוצים מהזמנה+לקוח+שבת ---
export function orderVars({ order, customer, shabbat }) {
  return {
    customer_name: customer?.full_name || '',
    order_number: order?.order_number || '',
    // המשתנה נקרא parasha מטעמי תאימות לנוסחי המייל הקיימים, אך הערך הוא תווית
    // המועד: פרשה בשבת, ושם האירוע באירוע (מיגרציה 52).
    parasha: (shabbat?.kind === 'event' ? shabbat?.title : shabbat?.parasha) || '',
    final_amount: order?.final_amount != null ? Number(order.final_amount).toFixed(2) : '',
    payment_method: PAYMENT_METHOD_HE[order?.preferred_payment_method] || '',
    payment_deadline: shabbat?.payment_deadline || '',
  };
}
