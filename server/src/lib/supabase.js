// חיבור ל-Supabase עם מפתח service_role - עוקף RLS.
// ⚠️ נשמר בשרת בלבד. לעולם לא נחשף לפרונט.
import { createClient } from '@supabase/supabase-js';

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY } = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error('\n❌ חסרים משתני סביבה: SUPABASE_URL ו/או SUPABASE_SERVICE_ROLE_KEY');
  console.error('   העתיקי את server/.env.example ל-server/.env ומלאי את הערכים.\n');
  process.exit(1);
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
