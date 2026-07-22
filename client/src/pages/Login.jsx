import { useState } from 'react';
import { api } from '../lib/api.js';

// כניסת לקוח לפי טלפון (סעיף 7) + בקשת רישום אם לא נמצא
export default function Login({ onLogin }) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [reg, setReg] = useState({ first_name: '', last_name: '', email: '', address: '' });
  const [regDone, setRegDone] = useState(false);

  async function handleLogin(e) {
    e.preventDefault();
    setError(''); setNotFound(false); setLoading(true);
    try {
      const res = await api.login(phone);
      if (!res.found) { setNotFound(true); }
      else if (!res.active) { setError('המשתמש קיים אך ממתין לאישור מנהל.'); }
      else { onLogin(res.customer); }
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  async function handleRegister(e) {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      await api.register({ ...reg, phone });
      setRegDone(true);
    } catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="customer-login min-h-screen px-4 py-8 sm:px-6 sm:py-12">
      <div className="mx-auto grid min-h-[calc(100vh-6rem)] w-full max-w-5xl items-center gap-8 lg:grid-cols-[1.05fr_.95fr]">
        <div className="login-brand-panel text-center lg:text-right">
          <img src="/logo.png" alt="מטבח החסד" className="mx-auto h-40 w-40 object-contain lg:mx-0 lg:h-52 lg:w-52" />
          <p className="mt-4 text-sm font-bold tracking-[0.18em] text-brand-gold-dark">ברכת שמואל</p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-[#2b2024] sm:text-5xl">מזמינים לשבת<br />בפשטות ובנחת</h1>
          <p className="mx-auto mt-4 max-w-md text-base leading-7 text-[#746a6d] lg:mx-0">
            בוחרים שבת, סעודות ומאכלים - ואנחנו דואגים לכל השאר.
          </p>
        </div>

        <div className="login-card">
          <div className="mb-6">
            <span className="section-title">אזור אישי</span>
            <h2 className="mt-2 text-2xl font-extrabold text-[#2b2024]">כניסה למערכת ההזמנות</h2>
            <p className="mt-1 text-sm text-[#81777a]">הזינו את מספר הטלפון הרשום במערכת</p>
          </div>
          {regDone ? (
            <div className="text-center py-4">
              <div className="text-5xl mb-3">✓</div>
              <h2 className="text-xl font-bold text-brand-burgundy mb-2">בקשת הרישום נשלחה</h2>
              <p className="text-brand-burgundy/70">לאחר אישור מנהל תוכל/י להיכנס ולהזמין.</p>
            </div>
          ) : notFound ? (
            <form onSubmit={handleRegister} className="space-y-3">
              <h2 className="text-xl font-bold text-brand-burgundy">רישום לקוח חדש</h2>
              <p className="text-sm text-brand-burgundy/70">המספר {phone} לא נמצא. נא למלא פרטים לבקשת רישום.</p>
              <input className="input" placeholder="שם פרטי" required
                value={reg.first_name} onChange={(e) => setReg({ ...reg, first_name: e.target.value })} />
              <input className="input" placeholder="שם משפחה"
                value={reg.last_name} onChange={(e) => setReg({ ...reg, last_name: e.target.value })} />
              <input className="input" placeholder="מייל (אופציונלי)"
                value={reg.email} onChange={(e) => setReg({ ...reg, email: e.target.value })} />
              <input className="input" placeholder="כתובת (אופציונלי)"
                value={reg.address} onChange={(e) => setReg({ ...reg, address: e.target.value })} />
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button className="btn-primary w-full" disabled={loading}>שליחת בקשת רישום</button>
              <button type="button" className="btn-ghost w-full" onClick={() => setNotFound(false)}>חזרה</button>
            </form>
          ) : (
            <form onSubmit={handleLogin} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-brand-burgundy mb-1">מספר טלפון</label>
                <input className="input text-center tracking-widest" placeholder="050-000-0000"
                  inputMode="tel" autoComplete="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
              </div>
              {error && <p className="text-red-600 text-sm">{error}</p>}
              <button className="btn-primary w-full text-lg" disabled={loading}>
                {loading ? 'רגע...' : 'כניסה'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
