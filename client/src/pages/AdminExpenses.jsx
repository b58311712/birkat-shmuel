import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { Badge, SUPPLIER_PAYMENT_STATUS, EXPENSE_PAYMENT_METHOD } from '../lib/status.jsx';

const nis = (n) => `${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = { expense_date: today(), amount: '', supplier_id: '', payment_method: '', payment_status: 'unpaid', invoice_number: '', note: '' };

export default function AdminExpenses({ onAuthError }) {
  const [data, setData] = useState(null);          // { expenses, summary }
  const [suppliers, setSuppliers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [editingId, setEditingId] = useState(null);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const handleAuth = (err, fallback) => {
    if (err.name === 'AdminAuthError') onAuthError?.();
    else setError(err.message || fallback);
  };

  const load = () => {
    api.expenses().then(setData).catch((err) => handleAuth(err, 'שגיאה בטעינת ההוצאות.'));
  };

  useEffect(() => {
    load();
    api.suppliers('?active=true').then((rows) => setSuppliers(rows || [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const startEdit = (e) => {
    setEditingId(e.id);
    setForm({
      expense_date: e.expense_date || today(),
      amount: String(e.amount ?? ''),
      supplier_id: e.supplier_id || '',
      payment_method: e.payment_method || '',
      payment_status: e.payment_status || 'unpaid',
      invoice_number: e.invoice_number || '',
      note: e.note || '',
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
    if (!Number.isFinite(amount) || amount <= 0) { setFormError('יש להזין סכום חיובי.'); return; }
    if (!form.payment_method) { setFormError('יש לבחור אמצעי תשלום.'); return; }

    const payload = {
      expense_date: form.expense_date || undefined,
      amount,
      supplier_id: form.supplier_id || undefined,
      payment_method: form.payment_method,
      payment_status: form.payment_status || undefined,
      invoice_number: form.invoice_number || undefined,
      note: form.note || undefined,
    };

    setBusy(true);
    try {
      if (editingId) await api.updateExpense(editingId, payload);
      else await api.createExpense(payload);
      cancelEdit();
      load();
    } catch (err) {
      if (err.name === 'AdminAuthError') onAuthError?.();
      else setFormError(err.message || 'שמירת ההוצאה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (e) => {
    if (!window.confirm('למחוק את ההוצאה?')) return;
    try {
      await api.deleteExpense(e.id);
      if (editingId === e.id) cancelEdit();
      load();
    } catch (err) {
      handleAuth(err, 'המחיקה נכשלה.');
    }
  };

  const expenses = data?.expenses || [];
  const summary = data?.summary || { count: 0, total: 0, paid_total: 0, open_total: 0 };

  if (error) {
    return (
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="pilot-panel flex items-center gap-4 border-red-200 bg-red-50 p-5 text-red-700" role="alert">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-red-100 font-extrabold">!</span>
          <div><h1 className="font-extrabold">לא ניתן לטעון את ההוצאות</h1><p className="mt-0.5 text-sm">{error}</p></div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand-gold/20 bg-brand-gold/[0.08] px-3 py-1 text-xs font-bold text-brand-gold-dark">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" /> הזנה חופשית
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#2b2024] sm:text-3xl">הוצאות</h1>
          <p className="mt-1 text-sm text-[#7c7175]">רישום חופשי של תשלומים והוצאות. נכנס לסיכום הכספי תחת "הוצאות כלליות".</p>
        </div>
        <Link to="/admin/finance" className="rounded-xl border border-black/[0.07] bg-white px-4 py-2.5 text-sm font-bold text-brand-burgundy shadow-[0_5px_16px_rgba(42,31,36,0.05)] transition hover:border-brand-gold/35">למודול הכספי</Link>
      </header>

      {/* סיכומים */}
      <section className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="סיכום">
        <SummaryTile label="סה״כ הוצאות" value={summary.total} sub={`${summary.count} רשומות`} tone="gold" />
        <SummaryTile label="שולם" value={summary.paid_total} sub="הוצאות בסטטוס שולם" tone="neutral" />
        <SummaryTile label="פתוח לתשלום" value={summary.open_total} sub="טרם שולם במלואו" tone="warning" />
      </section>

      {/* יצירה נשארת למעלה; עריכה של רשומה קיימת מוצגת בתוך הטבלה ליד הרשומה. */}
      {!editingId && (
        <section className="pilot-panel mt-5 p-5 sm:p-6" aria-labelledby="add-title">
          <ExpenseForm form={form} setForm={setForm} suppliers={suppliers} onSubmit={submit}
            onCancel={cancelEdit} busy={busy} error={formError} isEditing={false} />
        </section>
      )}

      {/* טבלת ההוצאות */}
      <section className="pilot-panel mt-5 overflow-hidden">
        <div className="flex items-end justify-between gap-3 border-b border-black/[0.05] px-5 py-4">
          <div><h2 className="font-extrabold text-[#33272b]">רשומות הוצאה</h2><p className="mt-0.5 text-xs font-semibold text-[#958b8e]">{expenses.length} רשומות (חדש→ישן)</p></div>
        </div>
        {!data ? (
          <div className="px-5 py-10 text-sm text-[#7f7478]">טוען…</div>
        ) : expenses.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[#7f7478]">עדיין לא נרשמו הוצאות. הוסיפו את הראשונה כדי להתחיל.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="pilot-table w-full text-right">
              <thead className="bg-[#f7f7f7]">
                <tr>{['תאריך', 'ספק', 'אמצעי תשלום', 'חשבונית', 'הערה', 'סכום', 'סטטוס', ''].map((h) => <th key={h} className="px-4 py-3.5 first:px-5">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-black/[0.045]">
                {expenses.map((e) => (
                  <ExpenseRow key={e.id} expense={e} editing={editingId === e.id}
                    form={form} setForm={setForm} suppliers={suppliers} onSubmit={submit}
                    onStartEdit={() => startEdit(e)} onCancelEdit={cancelEdit} onRemove={() => remove(e)}
                    busy={busy} formError={formError} />
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
  );
}

function ExpenseRow({ expense: e, editing, form, setForm, suppliers, onSubmit, onStartEdit, onCancelEdit, onRemove, busy, formError }) {
  return (
    <>
      <tr className={editing ? 'bg-brand-gold/[0.06]' : ''}>
        <td className="whitespace-nowrap px-5 py-4 text-sm text-[#82777b]" dir="ltr">{e.expense_date}</td>
        <td className="px-4 py-4 text-sm text-[#655b5f]">{e.supplier_name || '-'}</td>
        <td className="px-4 py-4 text-sm text-[#655b5f]">{EXPENSE_PAYMENT_METHOD[e.payment_method] || e.payment_method || '-'}</td>
        <td className="px-4 py-4 text-sm text-[#82777b]" dir="ltr">{e.invoice_number || '-'}</td>
        <td className="px-4 py-4 font-medium text-[#3d3135]">{e.note || '-'}</td>
        <td className="whitespace-nowrap px-4 py-4 font-bold tabular-nums text-[#3d3135]" dir="ltr">{nis(e.amount)}</td>
        <td className="px-4 py-4"><Badge map={SUPPLIER_PAYMENT_STATUS} value={e.payment_status} /></td>
        <td className="px-4 py-4">
          <div className="flex items-center gap-1.5">
            <ActionIconButton icon={editing ? 'cancel' : 'edit'} label={editing ? 'סגירה' : 'עריכה'} onClick={editing ? onCancelEdit : onStartEdit} />
            <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={onRemove} />
          </div>
        </td>
      </tr>
      {editing && (
        <tr className="bg-brand-gold/[0.035]">
          <td colSpan={8} className="p-4 sm:p-5">
            <div className="rounded-2xl border border-brand-gold/20 bg-white p-4 sm:p-5">
              <ExpenseForm form={form} setForm={setForm} suppliers={suppliers} onSubmit={onSubmit}
                onCancel={onCancelEdit} busy={busy} error={formError} isEditing />
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

function ExpenseForm({ form, setForm, suppliers, onSubmit, onCancel, busy, error, isEditing }) {
  return (
    <>
      <h2 id={isEditing ? undefined : 'add-title'} className="text-lg font-extrabold text-[#2b2024]">
        {isEditing ? 'עריכת הוצאה' : 'הוצאה חדשה'}
      </h2>
      <form onSubmit={onSubmit} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <Field label="תאריך">
          <input type="date" required value={form.expense_date}
            onChange={(e) => setForm((f) => ({ ...f, expense_date: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" dir="ltr" />
        </Field>
        <Field label="סכום (₪)">
          <input type="number" min="0" step="0.01" required value={form.amount}
            onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" dir="ltr" placeholder="0.00" />
        </Field>
        <Field label="סטטוס תשלום">
          <select value={form.payment_status}
            onChange={(e) => setForm((f) => ({ ...f, payment_status: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold">
            {Object.entries(SUPPLIER_PAYMENT_STATUS).map(([key, s]) => <option key={key} value={key}>{s.label}</option>)}
          </select>
        </Field>
        <Field label="ספק (אופציונלי)">
          <select value={form.supplier_id}
            onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold">
            <option value="">- ללא ספק -</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </Field>
        <Field label="אמצעי תשלום">
          <select required value={form.payment_method}
            onChange={(e) => setForm((f) => ({ ...f, payment_method: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold">
            <option value="">- נא לבחור -</option>
            {Object.entries(EXPENSE_PAYMENT_METHOD).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select>
        </Field>
        <Field label="מספר חשבונית (אופציונלי)">
          <input type="text" value={form.invoice_number}
            onChange={(e) => setForm((f) => ({ ...f, invoice_number: e.target.value }))}
            className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" dir="ltr" />
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
              {busy ? 'שומר…' : isEditing ? 'שמירת שינויים' : 'הוספת הוצאה'}
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
  const valueTone = tone === 'gold' ? 'text-brand-gold-dark' : tone === 'warning' ? 'text-red-600' : 'text-[#33272b]';
  return (
    <div className="pilot-panel flex min-w-0 flex-col justify-center p-5">
      <p className="text-xs font-bold text-[#8a7f82]">{label}</p>
      <p className={`mt-1 text-2xl font-extrabold tabular-nums ${valueTone}`} dir="ltr">{nis(value)}</p>
      <p className="mt-1 text-xs font-medium text-[#91878a]">{sub}</p>
    </div>
  );
}
