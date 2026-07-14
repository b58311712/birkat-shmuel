import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { ACTIVE_STATUS, Badge } from '../lib/status.jsx';

const ROLES = [
  { value: 'developer', label: 'מפתחת' },
  { value: 'manager', label: 'מנהל מערכת' },
  { value: 'coordinator', label: 'רכז תפעול' },
];
const ROLE_LABEL = Object.fromEntries(ROLES.map((r) => [r.value, r.label]));

export default function AdminUsers({ onAuthError, currentAdmin }) {
  const [users, setUsers] = useState(null);
  const [editing, setEditing] = useState(null);
  const [passwordUser, setPasswordUser] = useState(null);
  const [filter, setFilter] = useState({ search: '', role: '', active: 'true' });

  const canManage = currentAdmin?.role === 'developer' || currentAdmin?.role === 'manager';
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    if (filter.search.trim()) params.set('search', filter.search.trim());
    if (filter.role) params.set('role', filter.role);
    if (filter.active) params.set('active', filter.active);
    const q = params.toString();
    return q ? `?${q}` : '';
  }, [filter]);

  const load = useCallback(() => {
    api.adminUsers(query).then(setUsers).catch(handleErr);
  }, [query, handleErr]);

  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateAdminUser(form.id, form);
      else await api.createAdminUser(form);
      setEditing(null);
      load();
    } catch (e) { handleErr(e); }
  }

  async function toggleActive(user) {
    if (user.id === currentAdmin?.id && user.is_active) {
      return alert('לא ניתן להשבית את המשתמש המחובר.');
    }
    try {
      await api.updateAdminUser(user.id, { is_active: !user.is_active });
      load();
    } catch (e) { handleErr(e); }
  }

  async function deleteUser(user) {
    if (user.id === currentAdmin?.id) {
      return alert('לא ניתן למחוק את המשתמש המחובר.');
    }
    if (!confirm(`למחוק לצמיתות את ${user.full_name}?`)) return;
    try {
      await api.deleteAdminUser(user.id);
      load();
    } catch (e) { handleErr(e); }
  }

  async function resetPassword(password) {
    try {
      await api.resetAdminUserPassword(passwordUser.id, password);
      setPasswordUser(null);
      load();
      alert('הסיסמה עודכנה.');
    } catch (e) { handleErr(e); }
  }

  if (!canManage) {
    return (
      <Page title="ניהול משתמשים" subtitle="הרשאה למסך זה ניתנת למפתחת או למנהל מערכת בלבד.">
        <div className="card text-brand-burgundy/70">אין לך הרשאה לנהל משתמשים.</div>
      </Page>
    );
  }

  return (
    <Page title="ניהול משתמשים" subtitle="משתמשי מערכת פנימיים, תפקידים, סטטוס ואיפוס סיסמה">
      <div className="space-y-4">
        <div className="flex flex-wrap items-end gap-3">
          <button onClick={() => setEditing({})} className="btn-primary">+ משתמש חדש</button>
          <Field label="חיפוש">
            <input
              value={filter.search}
              onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
              className={inputCls}
              placeholder="שם, אימייל או טלפון"
            />
          </Field>
          <Field label="תפקיד">
            <select value={filter.role} onChange={(e) => setFilter((f) => ({ ...f, role: e.target.value }))} className={inputCls}>
              <option value="">הכל</option>
              {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
            </select>
          </Field>
          <Field label="סטטוס">
            <select value={filter.active} onChange={(e) => setFilter((f) => ({ ...f, active: e.target.value }))} className={inputCls}>
              <option value="true">פעילים</option>
              <option value="false">לא פעילים</option>
              <option value="">הכל</option>
            </select>
          </Field>
        </div>

        {editing && !editing.id && <UserForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
        {passwordUser && (
          <PasswordForm user={passwordUser} onSave={resetPassword} onCancel={() => setPasswordUser(null)} />
        )}

        <div className="overflow-x-auto">
          <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
            <thead className="bg-brand-burgundy text-brand-cream text-sm">
              <tr>
                <th className="p-3 text-right">שם</th>
                <th className="p-3 text-right">אימייל</th>
                <th className="p-3 text-right">טלפון</th>
                <th className="p-3 text-right">תפקיד</th>
                <th className="p-3 text-right">סטטוס</th>
                <th className="p-3 text-right">כניסה אחרונה</th>
                <th className="p-3 text-right"></th>
              </tr>
            </thead>
            <tbody>
              {!users ? (
                <tr><td colSpan={7} className="p-6 text-center text-brand-burgundy/50">טוען...</td></tr>
              ) : users.length === 0 ? (
                <tr><td colSpan={7} className="p-6 text-center text-brand-burgundy/50">לא נמצאו משתמשים.</td></tr>
              ) : users.map((user) => (
                <Fragment key={user.id}>
                <tr className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!user.is_active ? 'opacity-50' : ''} ${editing?.id === user.id ? 'bg-brand-cream/40' : ''}`}>
                  <td className="p-3 font-medium">
                    {user.full_name}
                    {user.id === currentAdmin?.id && <span className="text-xs text-brand-burgundy/50 mr-1">(מחובר)</span>}
                    {user.notes && <div className="text-xs text-brand-burgundy/50 mt-1">{user.notes}</div>}
                  </td>
                  <td className="p-3 text-sm" dir="ltr">{user.email}</td>
                  <td className="p-3 text-sm" dir="ltr">{user.phone || '-'}</td>
                  <td className="p-3 text-sm">{ROLE_LABEL[user.role] || user.role}</td>
                  <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={user.is_active ? 'active' : 'inactive'} /></td>
                  <td className="p-3 text-sm" dir="ltr">{formatDate(user.last_login_at)}</td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                    <ActionIconButton icon={editing?.id === user.id ? 'cancel' : 'edit'} label={editing?.id === user.id ? 'סגירה' : 'עריכה'} onClick={() => setEditing(editing?.id === user.id ? null : user)} />
                    <ActionIconButton icon="password" label="איפוס סיסמה" onClick={() => setPasswordUser(user)} />
                    <ActionIconButton
                      icon={user.is_active ? 'deactivate' : 'activate'}
                      label={user.is_active ? 'השבתה' : 'הפעלה'}
                      tone="muted"
                      onClick={() => toggleActive(user)}
                    />
                    {canDelete && user.id !== currentAdmin?.id && (
                      <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteUser(user)} />
                    )}
                    </div>
                  </td>
                </tr>
                {editing?.id === user.id && (
                  <tr className="border-b border-brand-cream-dark bg-brand-cream/20">
                    <td colSpan={7} className="p-3 sm:p-4">
                      <UserForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
                </Fragment>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Page>
  );
}

function UserForm({ initial, onSave, onCancel }) {
  const isEdit = !!initial.id;
  const [form, setForm] = useState({
    id: initial.id,
    full_name: initial.full_name || '',
    email: initial.email || '',
    phone: initial.phone || '',
    role: initial.role || 'coordinator',
    password: '',
    is_active: initial.is_active ?? true,
    notes: initial.notes || '',
  });
  const set = (key, value) => setForm((s) => ({ ...s, [key]: value }));

  function submit(e) {
    e.preventDefault();
    if (!form.full_name.trim()) return alert('חובה להזין שם מלא.');
    if (!form.email.trim()) return alert('חובה להזין אימייל.');
    if (!isEdit && form.password.length < 6) return alert('חובה להזין סיסמה באורך 6 תווים לפחות.');

    const payload = { ...form, phone: form.phone || null, notes: form.notes || null };
    if (isEdit) delete payload.password;
    onSave(payload);
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{isEdit ? 'עריכת משתמש' : 'משתמש חדש'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם מלא *">
          <input value={form.full_name} onChange={(e) => set('full_name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="אימייל *">
          <input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="טלפון">
          <input value={form.phone} onChange={(e) => set('phone', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="תפקיד">
          <select value={form.role} onChange={(e) => set('role', e.target.value)} className={inputCls}>
            {ROLES.map((role) => <option key={role.value} value={role.value}>{role.label}</option>)}
          </select>
        </Field>
        {!isEdit && (
          <Field label="סיסמה ראשונית *">
            <input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} className={inputCls} autoComplete="new-password" />
          </Field>
        )}
      </div>
      <Field label="הערות פנימיות">
        <input value={form.notes} onChange={(e) => set('notes', e.target.value)} className={inputCls} />
      </Field>
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} />
        משתמש פעיל
      </label>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

function PasswordForm({ user, onSave, onCancel }) {
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');

  function submit(e) {
    e.preventDefault();
    if (password.length < 6) return alert('סיסמה חייבת להכיל לפחות 6 תווים.');
    if (password !== confirm) return alert('הסיסמאות אינן תואמות.');
    onSave(password);
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-burgundy">
      <h3 className="font-bold text-brand-burgundy">איפוס סיסמה - {user.full_name}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="סיסמה חדשה">
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={inputCls} autoComplete="new-password" autoFocus />
        </Field>
        <Field label="אימות סיסמה">
          <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} className={inputCls} autoComplete="new-password" />
        </Field>
      </div>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">עדכון סיסמה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-burgundy/70 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function formatDate(value) {
  if (!value) return '-';
  return new Date(value).toLocaleString('he-IL', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}
