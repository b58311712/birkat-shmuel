// =============================================================================
// שליחת מייל דרך Gmail API (HTTPS/443) — עוקף חסימת SMTP של Render
// =============================================================================
// Render חוסמת פורטי SMTP יוצאים (587/465/25), ולכן nodemailer נכשל בפרודקשן
// (ENETUNREACH / Connection timeout — הוכח בסשן 2026-07-15). Gmail API רץ על
// HTTPS/443 שאינו חסום, ושולח מאותה תיבת Gmail (b58311712@gmail.com) בלי דומיין.
//
// המנגנון:
//   - OAuth2 עם refresh_token קבוע (scope gmail.send). ה-access_token מתחדש
//     אוטומטית ע"י ספריית googleapis בכל שליחה — אין מה לשמור/לרענן ידנית.
//   - בונים הודעת MIME multipart/alternative ידנית (Gmail API לא מקבל
//     attachments array כמו nodemailer): חלק text וחלק html. המעטפת רשמית
//     וטקסטואלית — אין תמונות/לוגו מצורפים.
//   - שולחים דרך gmail.users.messages.send עם raw = base64url של ה-MIME.
//
// env נדרשים: GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, GMAIL_REFRESH_TOKEN.
// אם חסר אחד מהם — isGmailApiConfigured()=false והמערכת נופלת ל-SMTP/dry-run.
// =============================================================================
import { google } from 'googleapis';

export function isGmailApiConfigured() {
  return !!(
    process.env.GMAIL_CLIENT_ID &&
    process.env.GMAIL_CLIENT_SECRET &&
    process.env.GMAIL_REFRESH_TOKEN
  );
}

let cachedClient;
function getGmailClient() {
  if (cachedClient !== undefined) return cachedClient;
  if (!isGmailApiConfigured()) {
    cachedClient = null;
    return null;
  }
  const oauth2 = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
  );
  oauth2.setCredentials({ refresh_token: process.env.GMAIL_REFRESH_TOKEN });
  cachedClient = google.gmail({ version: 'v1', auth: oauth2 });
  return cachedClient;
}

// --- קידוד base64url (RFC 4648 §5) — נדרש ל-raw של Gmail API ---
function toBase64Url(buf) {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

// --- קידוד כותרת מייל עם עברית (RFC 2047 encoded-word) ---
// נושא/שם שולח בעברית חייבים encoding, אחרת נשברים בתיבת הדואר.
function encodeHeader(text) {
  const s = String(text ?? '');
  // ASCII נקי — אין צורך בקידוד.
  if (/^[\x00-\x7F]*$/.test(s)) return s;
  return `=?UTF-8?B?${Buffer.from(s, 'utf8').toString('base64')}?=`;
}

// כותרת "From" עם שם תצוגה בעברית: קודדים רק את השם, משאירים את הכתובת גלויה.
function encodeFrom(from) {
  const m = String(from ?? '').match(/^(.*?)\s*<(.+?)>\s*$/);
  if (!m) return from; // כתובת בלבד, בלי שם תצוגה
  const name = m[1].replace(/^"|"$/g, '').trim();
  const addr = m[2].trim();
  return name ? `${encodeHeader(name)} <${addr}>` : addr;
}

// =============================================================================
// buildMimeMessage — בונה הודעת RFC 822 מלאה: multipart/alternative (text + html).
// =============================================================================
function buildMimeMessage({ from, to, subject, text, html }) {
  const altBoundary = 'alt_' + Math.random().toString(36).slice(2);
  const nl = '\r\n';

  const headers = [
    `From: ${encodeFrom(from)}`,
    `To: ${to}`,
    `Subject: ${encodeHeader(subject)}`,
    'MIME-Version: 1.0',
  ];

  const body = [
    `Content-Type: multipart/alternative; boundary="${altBoundary}"`, '',
    `--${altBoundary}`,
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: base64', '',
    Buffer.from(String(text ?? ''), 'utf8').toString('base64'), '',
    `--${altBoundary}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: base64', '',
    Buffer.from(String(html ?? ''), 'utf8').toString('base64'), '',
    `--${altBoundary}--`,
  ].join(nl);

  return headers.join(nl) + nl + body;
}

// =============================================================================
// sendViaGmailApi — שולח מייל אחד דרך Gmail API. זורק בכשל (הקורא תופס ומתעד).
// =============================================================================
export async function sendViaGmailApi({ from, to, subject, text, html }) {
  const gmail = getGmailClient();
  if (!gmail) throw new Error('Gmail API not configured');

  const mime = buildMimeMessage({ from, to, subject, text, html });
  await gmail.users.messages.send({
    userId: 'me',
    requestBody: { raw: toBase64Url(mime) },
  });
}
