# סיכום סשן — תיקון שליחת מיילים (Render חוסם SMTP → מעבר ל-Gmail API)

תאריך: 2026-07-15

## הבעיה (אובחנה חד-משמעית)
כל שליחות המיילים בפרודקשן נכשלו — כל השורות ב-`email_log` בסטטוס `failed`.
שתי שגיאות ביומן:
- `connect ENETUNREACH 2a00:1450:...::6c:587` (ניסיון IPv6)
- `Connection timeout` (ניסיון IPv4)

**הסיבה: Render חוסמת פורטי SMTP יוצאים (587/465/25).**

### איך הוכח
נוסף נתיב אבחון זמני `GET /api/cron/net-diag` שרץ **מתוך** Render. התוצאה:
```
tcp_ipv4:  142.251.127.109:587  → ok:false, err:"timeout" (8s מלאות)
tcp_ipv6:  2a00:1450:...::6c:587 → ok:false, err:"ENETUNREACH"
verify:    FAILED (ESOCKET)
dns:       תקין (מחזיר גם A וגם AAAA)
```
חיבור TCP גולמי לפורט 587 עושה timeout → זו חסימת פורט, לא DNS/IPv6/סיסמה/קוד.
ה-App Password תקין: `verify()` **מקומית** תמיד מצליח (המחשב לא חסום, Render כן).

**מסקנה: שום תיקון בקוד SMTP לא יעזור. חייבים לשלוח על HTTPS/443.**

## מה כבר נדחף ל-main (פרודקשן חי) — לא פתר, כי הבעיה חסימת פורט
- `6b1b1b4` — `family: 4` ב-`smtpConfig()`.
- `73c05a0` — `dns.setDefaultResultOrder('ipv4first')` ב-index.js + timeouts + שליחת מיילים ברקע ב-orders.js (`sendOrderEmails()`) + מיגרציה 26 idempotent.
- `1825173` — נתיב אבחון זמני `/api/cron/net-diag` ב-`cron.js`. **⚠️ למחוק בסוף.**

## ההחלטה: לעבור ל-Gmail API
- שולח דרך `googleapis.com:443` (HTTPS, **לא חסום**) במקום `smtp.gmail.com:587` (חסום).
- מאותה תיבה `b58311712@gmail.com`.
- **למה לא Resend/Brevo:** זה מוצר לשכפול ללקוחות, ולרובם אין דומיין → Resend בלי דומיין שולח מכתובת גנרית (ספאם/לא מקצועי). Gmail API שולח מכתובת ה-Gmail של הלקוח — מקצועי, בלי דומיין.
- זה בדיוק מה ש-n8n עושה: OAuth → token → Gmail API על 443.

"התחבר עם גוגל" (OAuth) = הדרך לקבל token לשליחה דרך Gmail API. פותר כי עוקף את פורט 587.

## הבא בתור (הסשן הבא) — המשתמשת בחרה להפיק refresh_token חדש ב-Google Cloud
1. הקמת פרויקט Google Cloud → הפעלת **Gmail API** → OAuth consent screen → OAuth Client → הפקת `refresh_token` (scope `gmail.send`).
2. ⚠️ במצב "Testing" עם @gmail.com refresh_token **פג אחרי 7 ימים**. למוצר לשכפול → app **Published** (verification פעם אחת). לתיקון התיבה הנוכחית פחות קריטי.
3. להחליף ב-`server/src/services/email.js` את nodemailer+SMTP ב-Gmail API (`gmail.users.messages.send`, MIME base64url). לשמור מעטפת מותגית (`emailTemplate.js`), `sendTemplateEmail`, `email_log`, dry-run.
4. env חדשים ב-Render: `GMAIL_CLIENT_ID`, `GMAIL_CLIENT_SECRET`, `GMAIL_REFRESH_TOKEN`. להסיר SMTP_*.
5. **למחוק את `/api/cron/net-diag`** מ-`cron.js` (כולל imports net/dns/nodemailer) לפני commit סופי.
6. ארכיטקטורת "מוצר לשכפול" (טוקן פר-לקוח, "התחבר עם Gmail" בהתקנה) — אחר כך.

## הערות
- `client/src/pages/AdminLogin.jsx` — עיצוב מחדש בעבודה של המשתמשת. **לא לגעת / לא לקמט לקומיטים של מייל.**
- push רק באישור מפורש בכל פעם (הכלל בזיכרון).
- CRON_SECRET קיים ב-Render (לא ב-.env מקומי).
