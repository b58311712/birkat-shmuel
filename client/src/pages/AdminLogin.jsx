import { useState } from 'react';
import { api } from '../lib/api.js';

// כניסת משתמש מערכת (מנהל / רכז / מפתחת) — אימייל + סיסמה (סעיף 5)
export default function AdminLogin({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

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
    <div className="min-h-screen flex items-center justify-center bg-brand-cream px-4 py-10">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/logo.png" alt="מטבח החסד" className="h-32 w-32 object-contain mx-auto mb-3" />
          <h1 className="text-3xl font-extrabold text-brand-cream">אזור ניהול</h1>
          <p className="text-brand-gold-light">מטבח החסד — ברכת שמואל</p>
        </div>

        <div className="card">
          <form onSubmit={handleSubmit} className="space-y-4">
            <h2 className="text-xl font-bold text-brand-burgundy">כניסת מנהל</h2>
            <div>
              <label className="block text-sm font-medium text-brand-burgundy mb-1">אימייל</label>
              <input className="input" type="email" placeholder="manager@example.com"
                inputMode="email" required value={email}
                onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="block text-sm font-medium text-brand-burgundy mb-1">סיסמה</label>
              <input className="input" type="password" placeholder="••••••••"
                required value={password} onChange={(e) => setPassword(e.target.value)} />
            </div>
            {error && <p className="text-red-600 text-sm">{error}</p>}
            <button className="btn-primary w-full text-lg" disabled={loading}>
              {loading ? 'רגע...' : 'כניסה'}
            </button>
          </form>
        </div>

        <p className="text-center text-brand-cream/60 text-sm mt-4">
          שכחת סיסמה? פני למנהל המערכת לאיפוס.
        </p>
      </div>
    </div>
  );
}
