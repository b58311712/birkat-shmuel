// =============================================================================
// תבנית מייל רשמית — מטבח החסד / ברכת שמואל (סעיף 18)
// =============================================================================
// ה"מעטפת" הקבועה שעוטפת את גוף המייל שהמנהל עורך (טקסט פשוט).
// - המנהל ממשיך לערוך טקסט פשוט ב-/admin/email; המערכת עוטפת אותו אוטומטית
//   במעטפת רשמית ורגועה (בלי לוגו, כותרת שקטה, חתימה קבועה בתחתית).
// - HTML "בטוח למייל": layout מבוסס טבלאות + inline styles בלבד (Gmail מסיר
//   בלוקי <style> ולא תומך ב-flexbox/CSS מודרני). RTL מלא. בלי אנימציות
//   (CSS animation נחסם ב-Gmail/Outlook) — חתימה סטטית נקייה.
// - גוף המנהל עובר escaping כדי שלא יוכל להזריק HTML; שבירות שורה נשמרות.
// - אין לוגו/תמונות מצורפות — המעטפת טקסטואלית לחלוטין.
// =============================================================================

// --- צבעי מותג (מ-tailwind.config.js) ---
const C = {
  burgundy: '#5C1A2E',
  gold: '#C79A4B',
  ink: '#3A3A3A',
  muted: '#8A8378',
  footer: '#A8A196',
  pageBg: '#F2EFE9',
  cardBorder: '#E5E0D5',
  hairline: '#ECE7DC',
  footerBg: '#FAF8F3',
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

// =============================================================================
// renderBrandedEmail — עוטף גוף טקסט פשוט במעטפת HTML רשמית.
//   subject   — נושא (ל-title / preheader)
//   body      — גוף שהמנהל ערך (טקסט פשוט, placeholders כבר מולאו)
// מחזיר מחרוזת HTML מלאה.
// =============================================================================
export function renderBrandedEmail({ subject = '', body = '' } = {}) {
  const bodyHtml = bodyToHtml(body);
  const preheader = escapeHtml(String(body ?? '').replace(/\s+/g, ' ').trim().slice(0, 120));

  return `<!DOCTYPE html>
<html lang="he" dir="rtl" xmlns="http://www.w3.org/1999/xhtml">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="X-UA-Compatible" content="IE=edge">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin:0;padding:0;background:${C.pageBg};">
  <!-- preheader (מוסתר; מציג תקציר בתיבת הדואר לפני הפתיחה) -->
  <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</div>

  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="background:${C.pageBg};">
    <tr>
      <td align="center" style="padding:32px 12px;">

        <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600" dir="rtl"
               style="width:600px;max-width:100%;background:#ffffff;border:1px solid ${C.cardBorder};border-radius:8px;overflow:hidden;
                      font-family:'Heebo','Assistant',system-ui,-apple-system,'Segoe UI',Arial,sans-serif;">

          <!-- קו בורדו דק — אלמנט המיתוג היחיד בראש -->
          <tr>
            <td style="height:4px;line-height:4px;font-size:0;background:${C.burgundy};">&nbsp;</td>
          </tr>

          <!-- גוף המייל (נפתח ישר בתוכן, בלי כותרת עליונה) -->
          <tr>
            <td style="padding:34px 40px 8px;font-size:16px;line-height:1.8;color:${C.ink};">
              ${bodyHtml}
            </td>
          </tr>

          <!-- חתימה קבועה סטטית -->
          <tr>
            <td style="padding:20px 40px 30px;">
              <div style="height:2px;line-height:2px;font-size:0;background:${C.gold};border-radius:2px;">&nbsp;</div>
              <div style="padding-top:18px;">
                <div style="font-size:15px;font-weight:700;color:${C.burgundy};">מטבח החסד · ברכת שמואל</div>
                <div style="font-size:12px;color:${C.muted};line-height:1.7;padding-top:4px;">
                  ע״ש הרה״ח ר׳ שמואל רבינוביץ׳ ז״ל<br>
                  קלויז נחלת יעקב באיאן · ביתר עילית
                </div>
              </div>
            </td>
          </tr>

          <!-- כותרת תחתונה שקטה -->
          <tr>
            <td align="center" style="background:${C.footerBg};border-top:1px solid ${C.hairline};padding:16px 40px;">
              <div style="font-size:11px;color:${C.footer};line-height:1.6;">
                מייל זה נשלח באופן אוטומטי ממערכת ניהול ההזמנות של מטבח החסד.
              </div>
            </td>
          </tr>

        </table>

      </td>
    </tr>
  </table>
</body>
</html>`;
}
