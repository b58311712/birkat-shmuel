// קביעת/איפוס סיסמה למשתמש מערכת (מנהל/רכז/מפתחת).
// אם המשתמש לא קיים — נוצר עם התפקיד שהוזן.
//
// הרצה:
//   npm run set:admin -- <email> <password> [role] ["שם מלא"]
// דוגמה:
//   npm run set:admin -- manager@demo.local Sod1234! manager "מנהל המטבח"
//
// תפקידים אפשריים: manager | coordinator | developer
import 'dotenv/config';
import { supabase } from '../lib/supabase.js';
import { hashPassword } from '../lib/auth.js';

const VALID_ROLES = ['manager', 'coordinator', 'developer'];

async function main() {
  const [, , emailArg, password, roleArg, nameArg] = process.argv;
  const email = String(emailArg || '').trim().toLowerCase();
  const role = roleArg || 'manager';

  if (!email || !password) {
    console.error('שימוש: npm run set:admin -- <email> <password> [role] ["שם מלא"]');
    process.exit(1);
  }
  if (!VALID_ROLES.includes(role)) {
    console.error(`תפקיד לא תקין: "${role}". אפשרויות: ${VALID_ROLES.join(' | ')}`);
    process.exit(1);
  }
  if (password.length < 6) {
    console.error('הסיסמה קצרה מדי — נדרשות לפחות 6 תווים.');
    process.exit(1);
  }

  const password_hash = await hashPassword(password);

  const { data: existing } = await supabase
    .from('app_users').select('id').eq('email', email).maybeSingle();

  if (existing) {
    const { error } = await supabase.from('app_users')
      .update({ password_hash, is_active: true }).eq('id', existing.id);
    if (error) throw error;
    console.log(`✓ הסיסמה עודכנה למשתמש קיים: ${email}`);
  } else {
    const { error } = await supabase.from('app_users').insert({
      full_name: nameArg || email,
      email,
      role,
      is_active: true,
      password_hash,
    });
    if (error) throw error;
    console.log(`✓ נוצר משתמש חדש (${role}): ${email}`);
  }

  console.log('  כעת אפשר להתחבר ל-/admin עם האימייל והסיסמה.');
  process.exit(0);
}

main().catch((e) => { console.error('❌ שגיאה:', e.message); process.exit(1); });
