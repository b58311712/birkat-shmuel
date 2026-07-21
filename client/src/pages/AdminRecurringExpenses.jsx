import { Fragment, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { Badge, SUPPLIER_PAYMENT_STATUS } from '../lib/status.jsx';

const nis = (n) => `${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
const thisMonth = () => new Date().toISOString().slice(0, 7); // YYYY-MM

const EMPTY_FORM = { name: '', amount: '', day_of_month: 1, category: '', supplier_id: '', payment_method: '', note: '' };

export default function AdminRecurringExpenses({ onAuthError }) {
  const [data, setData] = useState(null);          // { templates, monthly_total }
  const [suppliers, setSuppliers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  // הפקה חודשית
  const [genMonth, setGenMonth] = useState(thisMonth());
  const [genStatus, setGenStatus] = useState(null); // { pending_count, pending_total, ... }
  const [genMsg, setGenMsg] = useState('');
  const [genBusy, setGenBusy] = useState(false);
  const [generated, setGenerated] = useState(null); // { expenses, summary } — הוצאות שכבר הופקו לחודש

  const handleAuth = (err, fallback) => {
    if (err.name === 'AdminAuthError') onAuthError?.();
    else setError(err.message || fallback);
  };

  const load = () => {
    api.recurringExpenses().then(setData).catch((err) => handleAuth(err, 'שגיאה בטעינת ההוצאות הקבועות.'));
  };

  const loadGenStatus = (month) => {
    api.recurringGenerationStatus(month).then(setGenStatus).catch(() => setGenStatus(null));
    api.generatedRecurringExpenses(month).then(setGenerated).catch(() => setGenerated(null));
  };

  useEffect(() => {
    load();
    api.suppliers('?active=true').then((rows) => setSuppliers(rows || [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setGenMsg('');
    if (/^\d{4}-\d{2}$/.test(genMonth)) loadGenStatus(genMonth);
    else setGenStatus(null);
  }, [genMonth]); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (t) => {
    setEditingId(t.id);
    setForm({
      name: t.name || '',
      amount: String(t.amount ?? ''),
      day_of_month: t.day_of_month || 1,
      category: t.category || '',
      supplier_id: t.supplier_id || '',
      payment_method: t.payment_method || '',
      note: t.note || '',
    });
    setFormError('');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setFormError('');
  };

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    const amount = Number(form.amount);
    if (!form.name.trim()) { setFormError('יש להזין שם להוצאה.'); return; }
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('יש להזין סכום חיובי.'); return; }
    const day = Number(form.day_of_month);
    if (!Number.isInteger(day) || day < 1 || day > 28) { setFormError('יום בחודש חייב להיות מספר שלם בין 1 ל-28.'); return; }

    const payload = {
      name: form.name.trim(),
      amount,
      day_of_month: day,
      category: form.category || undefined,
      supplier_id: form.supplier_id || undefined,
      payment_method: form.payment_method || undefined,
      note: form.note || undefined,
    };

    setBusy(true);
    try {
      if (editingId) await api.updateRecurringExpense(editingId, payload);
      else await api.createRecurringExpense(payload);
      cancelEdit();
      load();
      if (genStatus) loadGenStatus(genMonth);
    } catch (err) {
      if (err.name === 'AdminAuthError') onAuthError?.();
      else setFormError(err.message || 'שמירת ההוצאה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (t) => {
    if (!window.confirm(`להשבית את "${t.name}"? רשומות שכבר הופקו לא יימחקו, אך לא יופקו רשומות חדשות.`)) return;
    try {
      await api.deleteRecurringExpense(t.id);
      if (editingId === t.id) cancelEdit();
      load();
      if (genStatus) loadGenStatus(genMonth);
    } catch (err) {
      handleAuth(err, 'ההשבתה נכשלה.');
    }
  };

  const generate = async () => {
    setGenMsg('');
    if (!/^\d{4}-\d{2}$/.test(genMonth)) { setGenMsg('בחרו חודש תקין.'); return; }
    const monthLabel = genMonth;
    if (!window.confirm(`להפיק את ההוצאות הקבועות לחודש ${monthLabel}? רשומות שכבר הופקו לחודש זה יידלגו.`)) return;
    setGenBusy(true);
    try {
      const res = await api.generateRecurringExpenses(genMonth);
      setGenMsg(
        res.created_count > 0
          ? `הופקו ${res.created_count} הוצאות לחודש ${monthLabel}${res.skipped_count ? ` (${res.skipped_count} כבר קיימות)` : ''}.`
          : `אין מה להפיק — כל ההוצאות הקבועות כבר קיימות לחודש ${monthLabel}.`,
      );
      loadGenStatus(genMonth);
    } catch (err) {
      if (err.name === 'AdminAuthError') onAuthError?.();
      else setGenMsg(err.message || 'ההפקה נכשלה.');
    } finally {
      setGenBusy(false);
    }
  };

  const templates = data?.templates || [];
  const activeTemplates = useMemo(() => templates.filter((t) => t.is_active), [templates]);
  const monthlyTotal = data?.monthly_total || 0;
  const generatedRows = generated?.expenses || [];
  const genSummary = generated?.summary || { total: 0, open_total: 0, paid_total: 0, count: 0 };

  if (error) {
    return (
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="pilot-panel flex items-center gap-4 border-red-200 bg-red-50 p-5 text-red-700" role="alert">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-red-100 font-extrabold">!</span>
          <div><h1 className="font-extrabold">לא ניתן לטעון את ההוצאות הקבועות</h1><p className="mt-0.5 text-sm">{error}</p></div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand-gold/20 bg-brand-gold/[0.08] px-3 py-1 text-xs font-bold text-brand-gold-dark">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" /> תקורה חוזרת
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#2b2024] sm:text-3xl">הוצאות קבועות חודשיות</h1>
          <p className="mt-1 text-sm text-[#7c7175]">מגדירים כל הוצאה חוזרת (שכירות, חשמל, שכר…) פעם אחת, ומפיקים אותן להוצאות החודש בלחיצה. ההוצאות המופקות נכנסות לסיכום הכספי.</p>
        </div>
        <Link to="/admin/finance" className="rounded-xl border border-black/[0.07] bg-white px-4 py-2.5 text-sm font-bold text-brand-burgundy shadow-[0_5px_16px_rgba(42,31,36,0.05)] transition hover:border-brand-gold/35">למודול הכספי</Link>
      </header>

      {/* סיכומים */}
      <section className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="סיכום">
        <SummaryTile label="עלות חודשית קבועה" value={monthlyTotal} sub={`${activeTemplates.length} הוצאות פעילות`} tone="gold" />
        <SummaryTile label="עלות שנתית משוערת" value={monthlyTotal * 12} sub="×12 חודשים" tone="neutral" />
        <div className="pilot-panel flex min-w-0 flex-col justify-center p-5">
          <p className="text-xs font-bold text-[#8a7f82]">סה״כ הוצאות מוגדרות</p>
          <p className="mt-1 text-2xl font-extrabold tabular-nums text-[#33272b]">{templates.length}</p>
          <p className="mt-1 text-xs font-medium text-[#91878a]">כולל מושבתות</p>
        </div>
      </section>

      {/* הפקה חודשית */}
      <section className="pilot-panel mt-5 border-brand-gold/25 bg-brand-gold/[0.05] p-5 sm:p-6" aria-labelledby="gen-title">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 id="gen-title" className="text-lg font-extrabold text-[#2b2024]">הפקת הוצאות החודש</h2>
            <p className="mt-1 text-sm text-[#7c7175]">
              יוצר רשומת הוצאה אמיתית לכל הוצאה קבועה פעילה, בסטטוס "לא שולם". ניתן להריץ שוב — רשומות קיימות לא ישוכפלו.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <Field label="חודש">
              <input type="month" value={genMonth}
                onChange={(e) => setGenMonth(e.target.value)}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" dir="ltr" />
            </Field>
            <button type="button" onClick={generate} disabled={genBusy || !genStatus?.pending_count}
              className="btn-primary">
              {genBusy ? 'מפיק…' : 'הפק לחודש זה'}
            </button>
          </div>
        </div>
        {genStatus && (
          <p className="mt-3 text-sm font-semibold text-[#655b5f]">
            {genStatus.pending_count > 0
              ? <>ממתינות להפקה: <span className="tabular-nums">{genStatus.pending_count}</span> הוצאות · <span className="tabular-nums" dir="ltr">{nis(genStatus.pending_total)}</span></>
              : <span className="text-emerald-700">כל ההוצאות הקבועות כבר הופקו לחודש זה. ✓</span>}
          </p>
        )}
        {genMsg && <p className="mt-2 text-sm font-bold text-brand-burgundy">{genMsg}</p>}
      </section>

      {/* טבלת ההוצאות שכבר הופקו לחודש הנבחר */}
      <section className="pilot-panel mt-5 overflow-hidden">
        <div className="flex flex-wrap items-end justify-between gap-3 border-b border-black/[0.05] px-5 py-4">
          <div>
            <h2 className="font-extrabold text-[#33272b]">הוצאות שהופקו — {genMonth}</h2>
            <p className="mt-0.5 text-xs font-semibold text-[#958b8e]">
              {generatedRows.length} רשומות שנוצרו מהתבניות הקבועות. נכנסות לסך ההוצאות במודול הכספי.
            </p>
          </div>
          {generatedRows.length > 0 && (
            <div className="flex gap-4 text-sm">
              <span className="font-semibold text-[#655b5f]">סה״כ: <span className="font-extrabold tabular-nums text-[#33272b]" dir="ltr">{nis(genSummary.total)}</span></span>
              <span className="font-semibold text-[#655b5f]">פתוח: <span className="font-extrabold tabular-nums text-red-600" dir="ltr">{nis(genSummary.open_total)}</span></span>
            </div>
          )}
        </div>
        {!generated ? (
          <div className="px-5 py-10 text-sm text-[#7f7478]">טוען…</div>
        ) : generatedRows.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[#7f7478]">עדיין לא הופקו הוצאות לחודש {genMonth}. השתמשו בכפתור ההפקה למעלה, או שההפקה האוטומטית תיצור אותן ביום שנקבע.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="pilot-table w-full text-right">
              <thead className="bg-[#f7f7f7]">
                <tr>{['תאריך', 'שם', 'קטגוריה', 'ספק', 'סכום', 'סטטוס תשלום'].map((h) => <th key={h} className="px-4 py-3.5 first:px-5">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-black/[0.045]">
                {generatedRows.map((r) => (
                  <tr key={r.id}>
                    <td className="whitespace-nowrap px-5 py-4 text-sm text-[#82777b]" dir="ltr">{r.expense_date}</td>
                    <td className="px-4 py-4 font-medium text-[#3d3135]">{r.name || r.note || '—'}</td>
                    <td className="px-4 py-4 text-sm text-[#655b5f]">{r.category || '—'}</td>
                    <td className="px-4 py-4 text-sm text-[#655b5f]">{r.supplier_name || '—'}</td>
                    <td className="whitespace-nowrap px-4 py-4 font-bold tabular-nums text-[#3d3135]" dir="ltr">{nis(r.amount)}</td>
                    <td className="px-4 py-4"><Badge map={SUPPLIER_PAYMENT_STATUS} value={r.payment_status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* יצירה נשארת למעלה; עריכה של רשומה קיימת מוצגת בתוך הטבלה ליד הרשומה. */}
      {!editingId && (
        <section className="pilot-panel mt-5 p-5 sm:p-6" aria-labelledby="add-title">
          <RecurringExpenseForm form={form} setForm={setForm} suppliers={suppliers} onSubmit={submit}
            onCancel={cancelEdit} busy={busy} error={formError} isEditing={false} />
        </section>
      )}

      {/* רשימת ההוצאות הקבועות */}
      <section className="pilot-panel mt-5 overflow-hidden">
        <div className="flex items-end justify-between gap-3 border-b border-black/[0.05] px-5 py-4">
          <div><h2 className="font-extrabold text-[#33272b]">הוצאות קבועות מוגדרות</h2><p className="mt-0.5 text-xs font-semibold text-[#958b8e]">{templates.length} הוצאות</p></div>
        </div>
        {!data ? (
          <div className="px-5 py-10 text-sm text-[#7f7478]">טוען…</div>
        ) : templates.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[#7f7478]">אין עדיין הוצאות קבועות. הגדירו את הראשונה כדי להתחיל.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="pilot-table w-full text-right">
              <thead className="bg-[#f7f7f7]">
                <tr>{['שם', 'סכום', 'יום בחודש', 'קטגוריה', 'ספק', 'אמצעי תשלום', 'סטטוס', ''].map((h) => <th key={h} className="px-4 py-3.5 first:px-5">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-black/[0.045]">
                {templates.map((t) => (
                  <Fragment key={t.id}>
                  <tr className={`${editingId === t.id ? 'bg-brand-gold/[0.06]' : ''} ${!t.is_active ? 'opacity-55' : ''}`}>
                    <td className="px-5 py-4 font-medium text-[#3d3135]">{t.name}</td>
                    <td className="whitespace-nowrap px-4 py-4 font-bold tabular-nums text-[#3d3135]" dir="ltr">{nis(t.amount)}</td>
                    <td className="px-4 py-4 text-sm tabular-nums text-[#655b5f]" dir="ltr">{t.day_of_month}</td>
                    <td className="px-4 py-4 text-sm text-[#655b5f]">{t.category || '—'}</td>
                    <td className="px-4 py-4 text-sm text-[#655b5f]">{t.supplier_name || '—'}</td>
                    <td className="px-4 py-4 text-sm text-[#655b5f]">{t.payment_method || '—'}</td>
                    <td className="px-4 py-4">
                      {t.is_active
                        ? <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">פעילה</span>
                        : <span className="inline-flex items-center rounded-full bg-black/5 px-2.5 py-1 text-xs font-bold text-[#8a7f82]">מושבתת</span>}
                    </td>
                    <td className="px-4 py-4">
                      <div className="flex items-center gap-1.5">
                        {t.is_active && <ActionIconButton icon={editingId === t.id ? 'cancel' : 'edit'} label={editingId === t.id ? 'סגירה' : 'עריכה'} onClick={() => editingId === t.id ? cancelEdit() : startEdit(t)} />}
                        {t.is_active && <ActionIconButton icon="delete" label="השבתה" tone="danger" onClick={() => remove(t)} />}
                      </div>
                    </td>
                  </tr>
                  {editingId === t.id && (
                    <tr className="bg-brand-gold/[0.035]">
                      <td colSpan={8} className="p-4 sm:p-5">
                        <div className="rounded-2xl border border-brand-gold/20 bg-white p-4 sm:p-5">
                          <RecurringExpenseForm form={form} setForm={setForm} suppliers={suppliers} onSubmit={submit}
                            onCancel={cancelEdit} busy={busy} error={formError} isEditing />
                        </div>
                      </td>
                    </tr>
                  )}
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function RecurringExpenseForm({ form, setForm, suppliers, onSubmit, onCancel, busy, error, isEditing }) {
  return (
    <>
      <h2 id={isEditing ? undefined : 'add-title'} className="text-lg font-extrabold text-[#2b2024]">
        {isEditing ? 'עריכת הוצאה קבועה' : 'הוצאה קבועה חדשה'}
      </h2>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="שם ההוצאה">
          <input type="text" required value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" placeholder="למשל: שכירות" />
        </Field>
        <Field label="סכום חודשי (₪)">
          <input type="number" min="0" step="0.01" required value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" dir="ltr" placeholder="0.00" />
        </Field>
        <Field label="יום בחודש (1–28)">
          <input type="number" min="1" max="28" step="1" required value={form.day_of_month}
            onChange={(e) => setForm((f) => ({ ...f, day_of_month: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" dir="ltr" />
          <span className="mt-1 block text-[11px] font-medium text-[#958b8e]">היום שבו ההפקה האוטומטית תיצור את ההוצאה.</span>
        </Field>
        <Field label="קטגוריה (אופציונלי)">
          <input type="text" value={form.category}
            onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" placeholder="למשל: תקורה, שכר" />
        </Field>
        <Field label="ספק / נותן שירות (אופציונלי)">
          <select value={form.supplier_id}
            onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold">
            <option value="">— ללא ספק —</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="אמצעי תשלום (אופציונלי)">
          <input type="text" value={form.payment_method}
            onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" placeholder="למשל: הוראת קבע, העברה" />
        </Field>
        <Field label="הערה (אופציונלי)" className="sm:col-span-2 lg:col-span-3">
          <input type="text" value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" placeholder="פרטים נוספים" />
        </Field>
        <div className="flex items-center gap-3 sm:col-span-2 lg:col-span-3">
          {error && <p className="text-sm font-semibold text-red-600">{error}</p>}
          <div className="mr-auto flex gap-2">
            {isEditing && (
              <button type="button" onClick={onCancel} className="btn-secondary">ביטול</button>
            )}
            <button type="submit" disabled={busy}
              className="btn-primary">
              {busy ? 'שומר…' : isEditing ? 'שמירת שינויים' : 'הוספת הוצאה קבועה'}
            </button>
          </div>
        </div>
      </form>
    </>
  );
}

function Field({ label, children, className = '' }) {
  return (
    <label className={`block ${className}`}>
      <span className="mb-1 block text-xs font-bold text-[#655b5f]">{label}</span>
      {children}
    </label>
  );
}

function SummaryTile({ label, value, sub, tone }) {
  const valueTone = tone === 'gold' ? 'text-brand-gold-dark' : 'text-[#33272b]';
  return (
    <div className="pilot-panel flex min-w-0 flex-col justify-center p-5">
      <p className="text-xs font-bold text-[#8a7f82]">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${valueTone}`} dir="ltr">{nis(value)}</p>
      <p className="mt-1 text-xs font-medium text-[#91878a]">{sub}</p>
    </div>
  );
}
