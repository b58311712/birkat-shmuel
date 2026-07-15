// =============================================================================
// בדיקה חד-פעמית — שליחת מייל אמיתי דרך Gmail API (לפני עדכון Render)
// =============================================================================
// מוודא ששלושת ה-GMAIL_* עובדים ושהמייל (כולל הלוגו inline) מגיע בפועל.
// הרצה (PowerShell, מתוך server):
//   $env:GMAIL_CLIENT_ID="..."; $env:GMAIL_CLIENT_SECRET="..."; $env:GMAIL_REFRESH_TOKEN="..."; node src/scripts/testGmailSend.js
// אפשר להוסיף נמען אחר:  $env:TEST_TO="someone@example.com"
// =============================================================================
import { isGmailApiConfigured, sendViaGmailApi } from '../services/gmailApi.js';
import { renderBrandedEmail, brandLogoAttachment } from '../services/emailTemplate.js';

const to = process.env.TEST_TO || 'b58311712@gmail.com';
const from = process.env.SMTP_FROM || 'מטבח החסד - ברכת שמואל <b58311712@gmail.com>';

if (!isGmailApiConfigured()) {
  console.error('\n❌ חסרים GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET / GMAIL_REFRESH_TOKEN.\n');
  process.exit(1);
}

const subject = 'בדיקת Gmail API — מטבח החסד ✅';
const body = 'זהו מייל בדיקה שנשלח דרך Gmail API (HTTPS/443).\n\nאם קיבלת אותו — השליחה עובדת, כולל המעטפת המותגית והלוגו.\n\nבהצלחה!';
const logo = brandLogoAttachment();
const html = renderBrandedEmail({ subject, body, hasLogo: !!logo });

console.log(`\n📤 שולח מייל בדיקה אל ${to} ...`);
try {
  await sendViaGmailApi({ from, to, subject, text: body, html, logo });
  console.log('✅ נשלח בהצלחה! בדקי את תיבת הדואר של', to, '\n');
  process.exit(0);
} catch (e) {
  console.error('\n❌ השליחה נכשלה:', e.message);
  if (e.errors) console.error(JSON.stringify(e.errors, null, 2));
  console.error('');
  process.exit(1);
}
