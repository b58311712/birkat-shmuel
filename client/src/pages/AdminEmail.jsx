import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';

// ניהול מיילים (סעיף 18) — עריכת נוסחי מייל דינמיים, שליחת תזכורות תשלום, ויומן שליחה.
// שמות ידידותיים לנוסחים המוכרים.
const TEMPLATE_LABELS = {
  order_summary: 'סיכום הזמנה ללקוח (בעת יצירה)',
  order_approved: 'אישור הזמנה ללקוח',
  new_order_manager_alert: 'התראת מנהל — הזמנה חדשה',
  payment_reminder: 'תזכורת תשלום ללקוח',
};

// placeholders זמינים לשימוש בנוסחים.
const PLACEHOLDERS = [
  ['{customer_name}', 'שם הלקוח'],
  ['{order_number}', 'מספר הזמנה'],
  ['{parasha}', 'פרשת השבוע'],
  ['{final_amount}', 'סכום לתשלום'],
  ['{payment_method}', 'אמצעי תשלום'],
  ['{payment_deadline}', 'מועד אחרון לתשלום'],
];

const LOG_STATUS = {
  sent: { label: 'נשלח', cls: 'bg-green-100 text-green-800' },
  dry_run: { label: 'מצב יבש', cls: 'bg-amber-100 text-amber-800' },
  failed: { label: 'נכשל', cls: 'bg-red-100 text-red-700' },
};

export default function AdminEmail({ onAuthError }) {
  const [templates, setTemplates] = useState([]);
  const [dryRun, setDryRun] = useState(false);
  const [log, setLog] = useState([]);
  const [error, setError] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);

  const handleErr = useCallback((err) => {
    if (err.name === 'AdminAuthError') onAuthError?.();
    else setError(err.message || 'אירעה שגיאה.');
  }, [onAuthError]);

  const loadLog = useCallback(() => {
    api.emailLog().then((d) => setLog(d.log || [])).catch(handleErr);
  }, [handleErr]);

  useEffect(() => {
    api.emailTemplates()
      .then((d) => { setTemplates(d.templates || []); setDryRun(!!d.dry_run); })
      .catch(handleErr)
      .finally(() => setLoading(false));
    loadLog();
  }, [handleErr, loadLog]);

  async function saveTemplate(code, patch) {
    setError(''); setMsg('');
    try {
      const { template } = await api.updateEmailTemplate(code, patch);
      setTemplates((prev) => prev.map((t) => (t.code === code ? template : t)));
      setMsg('הנוסח נשמר.');
    } catch (err) { handleErr(err); }
  }

  async function sendReminders(overdueOnly) {
    setError(''); setMsg('');
    try {
      const r = await api.sendPaymentReminders(overdueOnly);
      setMsg(
        `תזכורות: ${r.emailed} נשלחו, ${r.dry_run} במצב יבש, ${r.internal} התראות פנימיות (ללא מייל), ${r.skipped} דולגו — מתוך ${r.total} הזמנות.`
      );
      loadLog();
    } catch (err) { handleErr(err); }
  }

  if (loading) return <Page title="מיילים" subtitle="טוען…"><p className="text-brand-burgundy/70">טוען נוסחי מייל…</p></Page>;

  return (
    <Page title="מיילים" subtitle="עריכת נוסחי מייל, שליחת תזכורות תשלום ויומן שליחה (סעיף 18).">
      {error && <div className="mb-4 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-red-700">{error}</div>}
      {msg && <div className="mb-4 rounded-xl border border-green-200 bg-green-50 px-4 py-3 text-green-800">{msg}</div>}

      {dryRun && (
        <div className="mb-6 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
          <strong>מצב יבש פעיל:</strong> לא הוגדר חשבון SMTP, ולכן מיילים <em>מתועדים ביומן</em> ולא נשלחים בפועל.
          כדי לשלוח באמת — מלאו את פרטי ה-SMTP בקובץ <code>.env</code> והפעילו מחדש את השרת.
        </div>
      )}

      {/* פעולת תזכורות תשלום (18.4) */}
      <section className="card mb-6">
        <h2 className="mb-2 text-lg font-bold text-brand-burgundy">תזכורות תשלום</h2>
        <p className="mb-3 text-sm text-brand-burgundy/70">
          שליחת תזכורת לכל ההזמנות המאושרות שטרם שולמו במלואן. ללקוח ללא מייל תיווצר התראה פנימית.
        </p>
        <div className="flex flex-wrap gap-2">
          <button className="btn-primary" onClick={() => sendReminders(false)}>שלח לכל הלא-משולמות</button>
          <button className="btn-ghost" onClick={() => sendReminders(true)}>רק לאיחור בתשלום</button>
        </div>
      </section>

      {/* מקרא placeholders */}
      <section className="card mb-6">
        <h2 className="mb-2 text-lg font-bold text-brand-burgundy">שדות זמינים לנוסח</h2>
        <div className="flex flex-wrap gap-2">
          {PLACEHOLDERS.map(([ph, label]) => (
            <span key={ph} className="badge bg-brand-cream text-brand-burgundy">
              <code className="font-mono">{ph}</code> — {label}
            </span>
          ))}
        </div>
      </section>

      {/* עורכי נוסחים */}
      <div className="space-y-4">
        {templates.map((t) => (
          <TemplateEditor key={t.code} template={t} onSave={saveTemplate} />
        ))}
      </div>

      {/* יומן שליחה */}
      <section className="card mt-8">
        <h2 className="mb-3 text-lg font-bold text-brand-burgundy">יומן שליחה אחרון</h2>
        {log.length === 0 ? (
          <p className="text-sm text-brand-burgundy/60">עדיין לא נשלחו מיילים.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-right text-brand-burgundy/60 border-b border-brand-cream-dark">
                  <th className="py-2 pl-3 font-semibold">מתי</th>
                  <th className="py-2 pl-3 font-semibold">נוסח</th>
                  <th className="py-2 pl-3 font-semibold">נמען</th>
                  <th className="py-2 pl-3 font-semibold">נושא</th>
                  <th className="py-2 font-semibold">סטטוס</th>
                </tr>
              </thead>
              <tbody>
                {log.map((r) => {
                  const st = LOG_STATUS[r.status] || { label: r.status, cls: 'bg-gray-100 text-gray-600' };
                  return (
                    <tr key={r.id} className="border-b border-brand-cream-dark/50">
                      <td className="py-2 pl-3 whitespace-nowrap text-brand-burgundy/70">
                        {new Date(r.created_at).toLocaleString('he-IL')}
                      </td>
                      <td className="py-2 pl-3">{TEMPLATE_LABELS[r.template_code] || r.template_code}</td>
                      <td className="py-2 pl-3">{r.to_email}</td>
                      <td className="py-2 pl-3">{r.subject}</td>
                      <td className="py-2"><span className={`badge ${st.cls}`}>{st.label}</span></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </Page>
  );
}

// עורך נוסח בודד — נושא, גוף, סטטוס פעיל.
function TemplateEditor({ template, onSave }) {
  const [subject, setSubject] = useState(template.subject);
  const [body, setBody] = useState(template.body);
  const dirty = subject !== template.subject || body !== template.body;

  return (
    <section className="card">
      <div className="mb-3 flex items-center justify-between gap-2 flex-wrap">
        <h3 className="text-lg font-bold text-brand-burgundy">
          {TEMPLATE_LABELS[template.code] || template.code}
        </h3>
        <label className="flex items-center gap-2 text-sm text-brand-burgundy/80">
          <input
            type="checkbox"
            checked={template.is_active}
            onChange={(e) => onSave(template.code, { is_active: e.target.checked })}
          />
          פעיל
        </label>
      </div>

      <label className="block mb-3">
        <span className="mb-1 block text-sm font-semibold text-brand-burgundy/80">נושא</span>
        <input
          className="input w-full"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
        />
      </label>

      <label className="block mb-3">
        <span className="mb-1 block text-sm font-semibold text-brand-burgundy/80">גוף המייל</span>
        <textarea
          className="input w-full font-mono text-sm"
          rows={8}
          value={body}
          onChange={(e) => setBody(e.target.value)}
        />
      </label>

      <div className="flex gap-2">
        <button
          className="btn-primary"
          disabled={!dirty}
          onClick={() => onSave(template.code, { subject, body })}
        >
          שמירה
        </button>
        {dirty && (
          <button
            className="btn-ghost"
            onClick={() => { setSubject(template.subject); setBody(template.body); }}
          >
            ביטול שינויים
          </button>
        )}
      </div>
    </section>
  );
}
