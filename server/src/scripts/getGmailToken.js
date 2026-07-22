// =============================================================================
// סקריפט חד-פעמי - הפקת GMAIL_REFRESH_TOKEN עבור שליחת מייל דרך Gmail API
// =============================================================================
// למה: Render חוסמת פורטי SMTP יוצאים (587/465/25), ולכן שליחה דרך nodemailer
// נכשלת בפרודקשן. Gmail API רץ על HTTPS/443 (לא חסום) ופותר את זה.
// לשליחה דרך Gmail API צריך refresh_token עם scope gmail.send - הסקריפט הזה
// מפיק אותו פעם אחת דרך זרימת OAuth בדפדפן.
//
// הרצה (מתוך תיקיית server):
//   GMAIL_CLIENT_ID=... GMAIL_CLIENT_SECRET=... node src/scripts/getGmailToken.js
// או ב-PowerShell:
//   $env:GMAIL_CLIENT_ID="..."; $env:GMAIL_CLIENT_SECRET="..."; node src/scripts/getGmailToken.js
//
// דרישה מקדימה: ב-OAuth Client שהקמתם ב-Google Cloud, הוסיפו URI מורשה להפניה:
//   http://localhost:5055/oauth2callback
// =============================================================================
import http from 'node:http';
import { URL } from 'node:url';
import { exec } from 'node:child_process';
import { google } from 'googleapis';

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const PORT = 5055;
const REDIRECT_URI = `http://localhost:${PORT}/oauth2callback`;
const SCOPE = 'https://www.googleapis.com/auth/gmail.send';

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('\n❌ חסרים GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET.');
  console.error('   הריצו כך (PowerShell):');
  console.error('   $env:GMAIL_CLIENT_ID="..."; $env:GMAIL_CLIENT_SECRET="..."; node src/scripts/getGmailToken.js\n');
  process.exit(1);
}

const oauth2 = new google.auth.OAuth2(CLIENT_ID, CLIENT_SECRET, REDIRECT_URI);

// access_type=offline + prompt=consent מכריחים את גוגל להחזיר refresh_token
// (בלעדיהם, בהתחברות חוזרת גוגל לא מחזירה refresh_token מחדש).
const authUrl = oauth2.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: [SCOPE],
});

function openBrowser(url) {
  // פותח דפדפן בכל פלטפורמה; אם נכשל, המשתמש יכול להעתיק את ה-URL ידנית.
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, () => {});
}

const server = http.createServer(async (req, res) => {
  if (!req.url.startsWith('/oauth2callback')) {
    res.writeHead(404).end();
    return;
  }
  const params = new URL(req.url, `http://localhost:${PORT}`).searchParams;
  const code = params.get('code');
  const err = params.get('error');

  if (err || !code) {
    res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2 dir="rtl">שגיאה: ${err || 'לא התקבל code'}</h2>`);
    console.error('\n❌ OAuth נכשל:', err || 'no code');
    server.close();
    process.exit(1);
  }

  try {
    const { tokens } = await oauth2.getToken(code);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end('<h2 dir="rtl">✅ הצליח! אפשר לסגור את החלון ולחזור לטרמינל.</h2>');

    console.log('\n=============================================================');
    console.log('✅ refresh_token הופק בהצלחה! העתיקו אותו ל-Render:');
    console.log('=============================================================\n');
    console.log('GMAIL_REFRESH_TOKEN=' + (tokens.refresh_token || '(חסר! ודאו prompt=consent)'));
    console.log('\n(access_token זמני - לא צריך לשמור אותו, השרת מרענן אוטומטית)\n');
    if (!tokens.refresh_token) {
      console.warn('⚠️ גוגל לא החזירה refresh_token. בטלו את הרשאת האפליקציה ב-');
      console.warn('   https://myaccount.google.com/permissions והריצו שוב.\n');
    }
  } catch (e) {
    res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(`<h2 dir="rtl">שגיאה בהחלפת code לטוקן: ${e.message}</h2>`);
    console.error('\n❌ getToken נכשל:', e.message, '\n');
  } finally {
    server.close();
    setTimeout(() => process.exit(0), 500);
  }
});

server.listen(PORT, () => {
  console.log('\n🔐 הפקת refresh_token ל-Gmail API');
  console.log('----------------------------------------------------------');
  console.log('נפתח דפדפן לאישור. אם לא נפתח - פתחו ידנית את הקישור:\n');
  console.log(authUrl + '\n');
  console.log(`ממתין ל-callback על ${REDIRECT_URI} ...\n`);
  openBrowser(authUrl);
});
