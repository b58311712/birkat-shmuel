import { useState } from 'react';
import { api, consumeAdminAuthNotice } from '../lib/api.js';

// כניסת משתמש מערכת (מנהל / רכז / מפתחת) - אימייל + סיסמה (סעיף 5)
export default function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notice] = useState(() => consumeAdminAuthNotice());

  async function handleSubmit(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const res = await api.adminLogin(email, password);
      onLogin(res);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="customer-login min-h-screen px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-5xl items-center gap-8 lg:grid-cols-[1.05fr_.95fr]">
        <div className="login-brand-panel text-center lg:text-right">
          <img src="/logo.png" alt="מטבח החסד" className="mx-auto h-40 w-40 object-contain lg:mx-0 lg:h-52 lg:w-52" />
          <p className="mt-4 text-sm font-bold tracking-[0.18em] text-brand-gold-dark">ברכת שמואל</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-[#2b2024] sm:text-5xl">
            מנהלים את המטבח<br />בפשטות ובנחת
          </h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-7 text-[#746a6d] lg:mx-0">
            כל מה שצריך לניהול ההזמנות, המטבח והקהילה - במקום אחד.
          </p>
        </div>

        <div className="login-card">
          <div className="mb-6">
            <span className="section-title">אזור ניהול</span>
            <h2 className="mt-2 text-2xl font-extrabold text-[#2b2024]">כניסה למערכת הניהול</h2>
            <p className="mt-1 text-sm text-[#81777a]">הזינו את פרטי המשתמש שלכם</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-4">
            {notice && (
              <p className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800" role="status">
                {notice}
              </p>
            )}
            <div>
              <label className="block text-sm font-medium text-brand-burgundy mb-1">אימייל</label>
              <input className="input" type="email" placeholder="manager@example.com"
                inputMode="email" autoComplete="email" dir="ltr" required value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-burgundy mb-1">סיסמה</label>
              <input className="input" type="password" placeholder="••••••••" dir="ltr"
                autoComplete="current-password"
                required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            <button className="btn-primary w-full text-lg" disabled={loading}>
              {loading ? 'רגע...' : 'כניסה'}
            </button>
          </form>

          <p className="mt-5 text-center text-sm text-[#81777a]">
            שכחת סיסמה? פנה למנהל המערכת לאיפוס.
          </p>
        </div>
      </div>
    </div>
  );
}
