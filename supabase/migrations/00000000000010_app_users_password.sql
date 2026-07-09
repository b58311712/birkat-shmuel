-- =============================================================================
-- מטבח החסד — מיגרציה 10: סיסמה למשתמשי מערכת (אימות מנהל, שלב ראשון)
-- =============================================================================
-- שלב ביניים לפני מעבר מלא ל-Supabase Auth (ראה הערה במיגרציה 01):
-- שומרים hash של סיסמה (bcrypt) ישירות ב-app_users. הכניסה נעשית דרך שרת ה-Node
-- שמחזיר טוקן חתום (JWT); הפרונט שולח את הטוקן בכל קריאה ל-/api/admin.
-- ה-hash לעולם לא נחשף לפרונט.

alter table app_users
  add column if not exists password_hash text,          -- bcrypt hash של הסיסמה
  add column if not exists last_login_at  timestamptz;   -- כניסה אחרונה (מעקב)

comment on column app_users.password_hash is 'bcrypt hash של סיסמת המשתמש — שלב ביניים עד Supabase Auth';
comment on column app_users.last_login_at is 'זמן הכניסה המוצלחת האחרונה';
