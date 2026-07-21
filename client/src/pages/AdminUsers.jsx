import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { DataTable } from '../components/DataTable.jsx';
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

  const canManage = currentAdmin?.role === 'developer' || currentAdmin?.role === 'manager';
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  // טוענים את כל המשתמשים; הסינון (חיפוש/תפקיד/סטטוס) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.adminUsers().then(setUsers).catch(handleErr);
  }, [handleErr]);

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

  const columns = [
    {
      key: 'full_name',
      label: 'שם',
      type: 'text',
      className: 'font-medium',
      render: (user) => (
        <>
          {user.full_name}
          {user.id === currentAdmin?.id && <span className="text-xs text-brand-burgundy/50 mr-1">(מחובר)</span>}
          {user.notes && <div className="text-xs text-brand-burgundy/50 mt-1">{user.notes}</div>}
        </>
      ),
    },
    { key: 'email', label: 'אימייל', type: 'text', dir: 'ltr' },
    { key: 'phone', label: 'טלפון', type: 'text', dir: 'ltr', render: (u) => u.phone || '-' },
    {
      key: 'role',
      label: 'תפקיד',
      type: 'enum',
      options: ROLES,
      render: (u) => ROLE_LABEL[u.role] || u.role,
    },
    {
      key: 'is_active',
      label: 'סטטוס',
      type: 'boolean',
      trueLabel: 'פעיל',
      falseLabel: 'לא פעיל',
      render: (u) => <Badge map={ACTIVE_STATUS} value={u.is_active ? 'active' : 'inactive'} />,
    },
    { key: 'last_login_at', label: 'כניסה אחרונה', type: 'date', dir: 'ltr', render: (u) => formatDate(u.last_login_at) },
  ];

  return (
    <Page title="ניהול משתמשים" subtitle="משתמשי מערכת פנימיים, תפקידים, סטטוס ואיפוס סיסמה">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3">
          <button onClick={() => setEditing({})} className="btn-primary">+ משתמש חדש</button>
        </div>

        {editing && !editing.id && <UserForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
        {passwordUser && (
          <PasswordForm user={passwordUser} onSave={resetPassword} onCancel={() => setPasswordUser(null)} />
        )}

        <DataTable
          columns={columns}
          rows={users}
          empty="לא נמצאו משתמשים."
          expandedId={editing?.id}
          rowClassName={(user) => `${!user.is_active ? 'opacity-50' : ''} ${editing?.id === user.id ? 'bg-brand-cream/40' : ''}`}
          renderExpanded={() => <UserForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />}
          actions={(user) => (
            <>
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
            </>
          )}
        />
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
