import { useState } from 'react';
import { api } from '../lib/api.js';

// כניסת לקוח לפי טלפון (סעיף 7) + בקשת רישום אם לא נמצא
export default function Login({ onLogin }) {
  const [phone, setPhone] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [notFound, setNotFound] = useState(false);
  const [reg, setReg] = useState({ full_name: '', email: '', address: '' });
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
    <div className="min-h-screen flex items-center justify-center bg-brand-burgundy px-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-6">
          <img src="/logo.png" alt="מטבח החסד" className="h-32 w-32 object-contain mx-auto mb-3" />
          <h1 className="text-3xl font-extrabold text-brand-cream">מטבח החסד</h1>
          <p className="text-brand-gold-light">ברכת שמואל</p>
        </div>

        <div className="card">
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
              <input className="input" placeholder="שם מלא" required
                value={reg.full_name} onChange={(e) => setReg({ ...reg, full_name: e.target.value })} />
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
              <h2 className="text-xl font-bold text-brand-burgundy">כניסה למערכת</h2>
              <div>
                <label className="block text-sm font-medium text-brand-burgundy mb-1">מספר טלפון</label>
                <input className="input text-center tracking-widest" placeholder="050-000-0000"
                  inputMode="tel" required value={phone} onChange={(e) => setPhone(e.target.value)} />
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
