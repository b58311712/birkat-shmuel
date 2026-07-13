// =============================================================================
// תבנית מייל רשמית — מטבח החסד / ברכת שמואל (סעיף 18)
// =============================================================================
// ה"מעטפת" הקבועה שעוטפת את גוף המייל שהמנהל עורך (טקסט פשוט).
// - המנהל ממשיך לערוך טקסט פשוט ב-/admin/email; המערכת עוטפת אותו אוטומטית
//   במעטפת מותגית (כותרת עם לוגו, גוף מעוצב, כותרת תחתונה עם ההקדשה מהלוגו).
// - HTML "בטוח למייל": layout מבוסס טבלאות + inline styles בלבד (Gmail מסיר
//   בלוקי <style> ולא תומך ב-flexbox/CSS מודרני). RTL מלא.
// - גוף המנהל עובר escaping כדי שלא יוכל להזריק HTML; שבירות שורה נשמרות.
// - הלוגו מוטמע כקובץ מצורף (CID) — תמיד נטען, לא נחסם, לא תלוי בשרת חיצוני.
// =============================================================================
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const LOGO_PATH = path.join(__dirname, '..', 'assets', 'email-logo.png');
const LOGO_CID = 'brand-logo';

// --- צבעי מותג (מ-tailwind.config.js) ---
const C = {
  burgundy: '#5C1A2E',
  burgundyLight: '#6B1E2D',
  burgundyDark: '#42121F',
  gold: '#C79A4B',
  goldLight: '#D4AF6A',
  goldDark: '#A67C34',
  cream: '#F5EFE0',
  creamDark: '#EADFC8',
  ink: '#3A2226',
  boxBg: '#EFE7D3',
};

// --- escaping ל-HTML (הגוף מגיע מהמנהל כטקסט פשוט; אסור שיזריק תגיות) ---
function escapeHtml(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// --- טקסט פשוט → HTML: escaping + שמירת פסקאות ושבירות שורה ---
// שורה ריקה מפרידה פסקאות; שבירת שורה בודדת → <br>.
function bodyToHtml(body) {
  const paragraphs = String(body ?? '')
    .replace(/\r\n/g, '\n')
    .split(/\n{2,}/);
  return paragraphs
    .map((p) => {
      const inner = escapeHtml(p.trim()).replace(/\n/g, '<br>');
      return inner
        ? `<p style="margin:0 0 16px;">${inner}</p>`
        : '';
    })
    .filter(Boolean)
    .join('\n');
}

// --- קובץ הלוגו המצורף (CID) — null אם הקובץ חסר, כדי לא להפיל שליחה ---
export function brandLogoAttachment() {
  try {
    if (!fs.existsSync(LOGO_PATH)) return null;
    return {
      filename: 'birkat-shmuel.png',
      path: LOGO_PATH,
      cid: LOGO_CID,
    };
  } catch {
    return null;
  }
}

// =============================================================================
// renderBrandedEmail — עוטף גוף טקסט פשוט במעטפת HTML מותגית.
//   subject   — נושא (לכותרת הפנימית / preheader)
//   body      — גוף שהמנהל ערך (טקסט פשוט, placeholders כבר מולאו)
//   hasLogo   — האם קובץ הלוגו זמין (משפיע אם להציג <img> או גיבוי טיפוגרפי)
// מחזיר מחרוזת HTML מלאה.
// =============================================================================
export function renderBrandedEmail({ subject = '', body = '', hasLogo = true } = {}) {
  const bodyHtml = bodyToHtml(body);
  const preheader = escapeHtml(String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 120));

  // כותרת: לוגו מוטמע אם קיים, אחרת גיבוי טיפוגרפי במסגרת זהב (תמיד נטען).
  const header = hasLogo
    ? `<img src="cid:${LOGO_CID}" width="180" alt="ברכת שמואל — מטבח החסד"
           style="display:block;margin:0 auto;width:180px;max-width:70%;height:auto;border:0;">`
    : `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto;">
         <tr><td align="center" style="border:2px solid ${C.gold};border-radius:14px;padding:14px 30px;">
           <div style="font-size:13px;letter-spacing:.28em;color:${C.goldLight};font-weight:600;padding-bottom:4px;">מטבח החסד</div>
           <div style="font-size:32px;line-height:1.15;font-weight:800;color:${C.cream};">ברכת שמואל</div>
         </td></tr>
       </table>`;

  return `<!DOCTYPE html>
<html lang="he" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:#E7DECB;">
  <!-- preheader (מוסתר; מציג תקציר בתיבת הדואר לפני הפתיחה) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:#E7DECB;">
    <tr>
      <td align="center" style="padding:28px 12px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" dir="rtl"
               style="width:600px;max-width:100%;background:${C.cream};border-radius:16px;overflow:hidden;
                      box-shadow:0 8px 30px rgba(66,18,31,0.18);
                      font-family:'Heebo','Assistant',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;">

          <!-- קו זהב עליון -->
          <tr>
            <td style="height:5px;line-height:5px;font-size:0;background:${C.goldDark};background:linear-gradient(90deg,${C.goldDark},${C.goldLight} 50%,${C.goldDark});">&nbsp;</td>
          </tr>

          <!-- כותרת -->
          <tr>
            <td align="center" style="background:${C.burgundy};background:radial-gradient(120% 120% at 50% 0%,${C.burgundyLight} 0%,${C.burgundy} 55%,${C.burgundyDark} 100%);padding:30px 24px 26px;">
              ${header}
            </td>
          </tr>

          <!-- מפריד זהב -->
          <tr>
            <td style="height:3px;line-height:3px;font-size:0;background:linear-gradient(90deg,rgba(199,154,75,0) 0%,${C.gold} 50%,rgba(199,154,75,0) 100%);">&nbsp;</td>
          </tr>

          <!-- גוף -->
          <tr>
            <td style="padding:32px 40px 24px;font-size:16px;line-height:1.85;color:${C.ink};">
              ${bodyHtml}
            </td>
          </tr>

          <!-- כותרת תחתונה -->
          <tr>
            <td align="center" style="background:${C.burgundyDark};padding:22px 40px 24px;">
              <div style="font-size:13px;line-height:1.7;color:${C.goldLight};">ע״ש הרה״ח ר׳ שמואל רבינוביץ׳ ז״ל · בן הרה״ח ר׳ דוד נחמן ז״ל</div>
              <div style="font-size:12px;color:${C.gold};letter-spacing:.06em;padding-top:6px;">• • •&nbsp; קלויז נחלת יעקב באיאן ביתר&nbsp; • • •</div>
              <div style="font-size:11px;color:rgba(245,239,224,0.55);padding-top:12px;">מייל זה נשלח באופן אוטומטי ממערכת ניהול ההזמנות של מטבח החסד.</div>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
