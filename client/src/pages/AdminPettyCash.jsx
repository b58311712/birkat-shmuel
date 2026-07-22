import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ActionIconButton } from '../components/ActionIcon.jsx';

const nis = (n) => `${Number(n || 0).toLocaleString('he-IL', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₪`;
const today = () => new Date().toISOString().slice(0, 10);

const EMPTY_FORM = { kind: 'expense', amount: '', tx_date: today(), category: '', description: '', supplier_id: '', receipt_number: '' };

export default function AdminPettyCash({ onAuthError }) {
  const [data, setData] = useState(null);         // { transactions, summary }
  const [suppliers, setSuppliers] = useState([]);
  const [error, setError] = useState('');
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState('');

  const handleAuth = (err) => {
    if (err.name === 'AdminAuthError') onAuthError?.();
    else setError(err.message || 'שגיאה בטעינת הקופה הקטנה.');
  };

  const load = () => {
    api.pettyCash().then(setData).catch(handleAuth);
  };

  useEffect(() => {
    load();
    api.suppliers('?active=true').then((rows) => setSuppliers(rows || [])).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const submit = async (event) => {
    event.preventDefault();
    setFormError('');
    const amount = Number(form.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      setFormError('יש להזין סכום חיובי.');
      return;
    }
    setBusy(true);
    try {
      await api.addPettyCashTx({
        kind: form.kind,
        amount,
        tx_date: form.tx_date || undefined,
        category: form.category || undefined,
        description: form.description || undefined,
        supplier_id: form.kind === 'expense' ? (form.supplier_id || undefined) : undefined,
        receipt_number: form.receipt_number || undefined,
      });
      setForm({ ...EMPTY_FORM, kind: form.kind, tx_date: form.tx_date });
      load();
    } catch (err) {
      if (err.name === 'AdminAuthError') onAuthError?.();
      else setFormError(err.message || 'שמירת התנועה נכשלה.');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id) => {
    if (!window.confirm('למחוק את התנועה? היתרה תחושב מחדש.')) return;
    try {
      await api.deletePettyCashTx(id);
      load();
    } catch (err) {
      handleAuth(err);
    }
  };

  const transactions = data?.transactions || [];
  const summary = data?.summary || { deposits_total: 0, expenses_total: 0, balance: 0 };
  const negative = summary.balance < 0;

  const rowCount = useMemo(
    () => ({ deposits: transactions.filter((t) => t.kind === 'deposit').length, expenses: transactions.filter((t) => t.kind === 'expense').length }),
    [transactions],
  );

  if (error) {
    return (
      <main className="mx-auto max-w-[1200px] px-4 py-8 sm:px-6 lg:px-8">
        <div className="pilot-panel flex items-center gap-4 border-red-200 bg-red-50 p-5 text-red-700" role="alert">
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-red-100 font-extrabold">!</span>
          <div><h1 className="font-extrabold">לא ניתן לטעון את הקופה הקטנה</h1><p className="mt-0.5 text-sm">{error}</p></div>
        </div>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-[1200px] px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-brand-gold/20 bg-brand-gold/[0.08] px-3 py-1 text-xs font-bold text-brand-gold-dark">
            <span className="h-1.5 w-1.5 rounded-full bg-brand-gold" /> מזומן שוטף
          </div>
          <h1 className="text-2xl font-extrabold tracking-tight text-[#2b2024] sm:text-3xl">קופה קטנה</h1>
          <p className="mt-1 text-sm text-[#7c7175]">הפקדות והוצאות מזומן שוטפות - יתרה רצה. ההוצאות נספרות בסך ההוצאות במודול הכספי.</p>
        </div>
        <Link to="/admin/finance" className="rounded-xl border border-black/[0.07] bg-white px-4 py-2.5 text-sm font-bold text-brand-burgundy shadow-[0_5px_16px_rgba(42,31,36,0.05)] transition hover:border-brand-gold/35">למודול הכספי</Link>
      </header>

      {/* יתרה + סיכומים */}
      <section className="mt-5 grid gap-3 sm:grid-cols-3" aria-label="סיכום קופה">
        <div className={`pilot-panel flex min-w-0 flex-col justify-center p-5 ${negative ? 'border-red-200 bg-red-50' : 'border-emerald-200 bg-emerald-50/60'}`}>
          <p className="text-xs font-bold text-[#8a7f82]">יתרה בקופה</p>
          <p className={`mt-1 text-3xl font-extrabold tabular-nums ${negative ? 'text-red-700' : 'text-emerald-700'}`} dir="ltr">{nis(summary.balance)}</p>
          {negative && <p className="mt-1 text-xs font-semibold text-red-600">היתרה שלילית - נדרשת הפקדה.</p>}
        </div>
        <SummaryTile label="סך הפקדות" value={summary.deposits_total} sub={`${rowCount.deposits} תנועות`} tone="neutral" />
        <SummaryTile label="סך הוצאות" value={summary.expenses_total} sub={`${rowCount.expenses} תנועות`} tone="gold" />
      </section>

      {/* טופס הוספה */}
      <section className="pilot-panel mt-5 p-5 sm:p-6" aria-labelledby="add-tx-title">
        <h2 id="add-tx-title" className="text-lg font-extrabold text-[#2b2024]">רישום תנועה</h2>
        <form onSubmit={submit} className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label="סוג תנועה">
            <div className="flex rounded-xl border border-black/10 bg-white p-1">
              <KindToggle active={form.kind === 'expense'} onClick={() => setForm((f) => ({ ...f, kind: 'expense' }))} tone="expense">הוצאה</KindToggle>
              <KindToggle active={form.kind === 'deposit'} onClick={() => setForm((f) => ({ ...f, kind: 'deposit' }))} tone="deposit">הפקדה</KindToggle>
            </div>
          </Field>
          <Field label="סכום (₪)">
            <input type="number" min="0" step="0.01" required value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" dir="ltr" placeholder="0.00" />
          </Field>
          <Field label="תאריך">
            <input type="date" value={form.tx_date}
              onChange={(e) => setForm((f) => ({ ...f, tx_date: e.target.value }))}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" dir="ltr" />
          </Field>
          <Field label="קטגוריה">
            <input type="text" value={form.category}
              onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" placeholder={form.kind === 'expense' ? 'למשל: ירקות' : 'למשל: תרומה'} />
          </Field>
          {form.kind === 'expense' && (
            <Field label="ספק (אופציונלי)">
              <select value={form.supplier_id}
                onChange={(e) => setForm((f) => ({ ...f, supplier_id: e.target.value }))}
                className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold">
                <option value="">- ללא ספק -</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </Field>
          )}
          <Field label="מספר קבלה (אופציונלי)">
            <input type="text" value={form.receipt_number}
              onChange={(e) => setForm((f) => ({ ...f, receipt_number: e.target.value }))}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" dir="ltr" />
          </Field>
          <Field label="תיאור" className={form.kind === 'expense' ? 'sm:col-span-2 lg:col-span-2' : 'sm:col-span-2 lg:col-span-3'}>
            <input type="text" value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
              className="w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-sm outline-none focus:border-brand-gold" placeholder="פרטים נוספים" />
          </Field>
          <div className="flex items-end sm:col-span-2 lg:col-span-4">
            {formError && <p className="ml-auto self-center text-sm font-semibold text-red-600">{formError}</p>}
            <button type="submit" disabled={busy}
              className="btn-primary mr-auto">
              {busy ? 'שומר…' : form.kind === 'expense' ? 'רישום הוצאה' : 'רישום הפקדה'}
            </button>
          </div>
        </form>
      </section>

      {/* ספר תנועות */}
      <section className="pilot-panel mt-5 overflow-hidden">
        <div className="flex items-end justify-between gap-3 border-b border-black/[0.05] px-5 py-4">
          <div><h2 className="font-extrabold text-[#33272b]">ספר תנועות</h2><p className="mt-0.5 text-xs font-semibold text-[#958b8e]">{transactions.length} תנועות (חדש→ישן)</p></div>
        </div>
        {!data ? (
          <div className="px-5 py-10 text-sm text-[#7f7478]">טוען…</div>
        ) : transactions.length === 0 ? (
          <div className="px-5 py-10 text-sm text-[#7f7478]">אין עדיין תנועות בקופה. רשמו הפקדה ראשונה כדי להתחיל.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="pilot-table w-full text-right">
              <thead className="bg-[#f7f7f7]">
                <tr>{['תאריך', 'סוג', 'תיאור', 'קטגוריה', 'ספק', 'קבלה', 'סכום', ''].map((h) => <th key={h} className="px-4 py-3.5 first:px-5">{h}</th>)}</tr>
              </thead>
              <tbody className="divide-y divide-black/[0.045]">
                {transactions.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap px-5 py-4 text-sm text-[#82777b]" dir="ltr">{t.tx_date}</td>
                    <td className="px-4 py-4"><KindBadge kind={t.kind} /></td>
                    <td className="px-4 py-4 font-medium text-[#3d3135]">{t.description || '-'}</td>
                    <td className="px-4 py-4 text-sm text-[#655b5f]">{t.category || '-'}</td>
                    <td className="px-4 py-4 text-sm text-[#655b5f]">{t.supplier_name || '-'}</td>
                    <td className="px-4 py-4 text-sm text-[#82777b]" dir="ltr">{t.receipt_number || '-'}</td>
                    <td className={`whitespace-nowrap px-4 py-4 font-bold tabular-nums ${t.kind === 'deposit' ? 'text-emerald-700' : 'text-[#3d3135]'}`} dir="ltr">
                      {t.kind === 'deposit' ? '+' : '−'}{nis(t.amount)}
                    </td>
                    <td className="px-4 py-4"><ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => remove(t.id)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </main>
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

function KindToggle({ active, onClick, tone, children }) {
  const activeClass = tone === 'deposit' ? 'bg-emerald-600 text-white' : 'bg-brand-burgundy text-white';
  return (
    <button type="button" onClick={onClick}
      className={`flex-1 rounded-lg px-3 py-1.5 text-sm font-bold transition ${active ? activeClass : 'text-[#7c7175] hover:bg-black/[0.04]'}`}>
      {children}
    </button>
  );
}

function KindBadge({ kind }) {
  return kind === 'deposit'
    ? <span className="inline-flex items-center rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-bold text-emerald-700">הפקדה</span>
    : <span className="inline-flex items-center rounded-full bg-brand-gold/10 px-2.5 py-1 text-xs font-bold text-brand-gold-dark">הוצאה</span>;
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
