import { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api } from '../lib/api.js';

const QUESTIONS = [
  ['overall_rating', 'שביעות רצון כללית'],
  ['food_rating', 'איכות וטעם האוכל'],
  ['quantity_rating', 'התאמת הכמויות'],
  ['delivery_rating', 'אריזה ואספקה'],
];

export default function Feedback() {
  const { token } = useParams();
  const [details, setDetails] = useState(null);
  const [form, setForm] = useState({
    overall_rating: 0,
    food_rating: 0,
    quantity_rating: 0,
    delivery_rating: 0,
    comment: '',
  });
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    api.feedback(token)
      .then((data) => {
        setDetails(data);
        if (data.response) setForm((current) => ({ ...current, ...data.response }));
      })
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  async function submit(event) {
    event.preventDefault();
    if (QUESTIONS.some(([field]) => !form[field])) {
      setError('יש לתת ציון בכל ארבעת הסעיפים.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.saveFeedback(token, form);
      setSaved(true);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  }

  if (loading) return <FeedbackShell><p className="text-center text-brand-burgundy/70">טוען את השאלון...</p></FeedbackShell>;
  if (!details) return <FeedbackShell><Message title="לא ניתן לפתוח את השאלון" text={error || 'הקישור אינו תקף או שפג תוקפו.'} error /></FeedbackShell>;
  if (saved) return (
    <FeedbackShell>
      <Message title="תודה רבה!" text="המשוב נשמר בהצלחה ועוזר לנו להשתפר משבת לשבת." />
      <button type="button" className="btn-ghost mx-auto mt-4 flex" onClick={() => setSaved(false)}>עריכת התשובה</button>
    </FeedbackShell>
  );

  return (
    <FeedbackShell>
      <div className="mb-6 text-center">
        <h1 className="text-2xl font-extrabold text-brand-burgundy">נשמח לשמוע איך היה</h1>
        <p className="mt-2 text-sm text-brand-burgundy/70">
          שלום {details.customer_name}, משוב על הזמנה {details.order_number}
          {details.shabbat?.parasha ? ` · פרשת ${details.shabbat.parasha}` : ''}
        </p>
        {details.response && <p className="mt-2 text-xs font-semibold text-brand-gold-dark">התשובה הקודמת מוצגת וניתנת לעריכה.</p>}
      </div>

      <form onSubmit={submit} className="space-y-6">
        {QUESTIONS.map(([field, label]) => (
          <RatingQuestion
            key={field}
            label={label}
            value={form[field]}
            onChange={(value) => setForm((current) => ({ ...current, [field]: value }))}
          />
        ))}
        <label className="block">
          <span className="mb-2 block font-bold text-brand-burgundy">מה היה טוב ומה כדאי לשפר?</span>
          <textarea
            className="input min-h-28 resize-y"
            maxLength={3000}
            value={form.comment}
            onChange={(event) => setForm((current) => ({ ...current, comment: event.target.value }))}
            placeholder="אפשר לכתוב כאן כל דבר שחשוב שנדע (רשות)"
          />
        </label>
        {error && <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">{error}</div>}
        <button className="btn-primary w-full text-base" disabled={saving}>
          {saving ? 'שומר...' : details.response ? 'עדכון המשוב' : 'שליחת המשוב'}
        </button>
      </form>
    </FeedbackShell>
  );
}

function RatingQuestion({ label, value, onChange }) {
  return (
    <fieldset>
      <legend className="mb-2 font-bold text-brand-burgundy">{label}</legend>
      <div className="grid grid-cols-5 gap-2" dir="rtl">
        {[1, 2, 3, 4, 5].map((rating) => (
          <button
            key={rating}
            type="button"
            aria-label={`${label}: ${rating} מתוך 5`}
            aria-pressed={value === rating}
            onClick={() => onChange(rating)}
            className={`min-h-12 rounded-xl border text-lg font-extrabold transition-colors ${
              value === rating
                ? 'border-brand-burgundy bg-brand-burgundy text-white'
                : 'border-brand-cream-dark bg-white text-brand-burgundy hover:bg-brand-cream/50'
            }`}
          >
            {rating}
          </button>
        ))}
      </div>
      <div className="mt-1 flex justify-between text-xs text-brand-burgundy/50" dir="rtl">
        <span>לא מרוצה</span><span>מרוצה מאוד</span>
      </div>
    </fieldset>
  );
}

function FeedbackShell({ children }) {
  return (
    <div className="min-h-screen bg-brand-cream/40 px-4 py-8" dir="rtl">
      <main className="mx-auto max-w-xl">
        <div className="mb-5 text-center">
          <img src="/logo.png" alt="מטבח החסד" className="mx-auto h-20 w-20 object-contain" />
        </div>
        <section className="card">{children}</section>
      </main>
    </div>
  );
}

function Message({ title, text, error = false }) {
  return (
    <div className="py-8 text-center">
      <div className="mb-3 text-4xl" aria-hidden="true">{error ? '!' : '✓'}</div>
      <h1 className={`text-2xl font-extrabold ${error ? 'text-red-700' : 'text-brand-burgundy'}`}>{title}</h1>
      <p className="mt-2 text-brand-burgundy/70">{text}</p>
    </div>
  );
}
