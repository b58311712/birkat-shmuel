// מציג את פריטי קטגוריית התבלינים + יחידת הבסיס + המרות קיימות. קריאה בלבד.
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

async function main() {
  // מוצאים קטגוריות שנראות כמו "תבלינים"
  const { data: cats } = await supabase.from('inventory_categories').select('id, name');
  console.log('קטגוריות מלאי:', cats.map((c) => c.name).join(', '));
  const spiceCat = (cats || []).find((c) => c.name.includes('תבלin') || c.name.includes('תבלינ'));
  if (!spiceCat) { console.log('\n⚠ לא נמצאה קטגוריה עם "תבלינ" בשם. בחרי מהרשימה למעלה.'); return; }

  console.log(`\nקטגוריה: ${spiceCat.name} (${spiceCat.id})`);
  const { data: items } = await supabase
    .from('inventory_items')
    .select('id, name, unit_id, unit, is_active, unit_ref:unit_id (name)')
    .eq('category_id', spiceCat.id).order('name');
  console.log(`\n${items.length} פריטים:`);
  const byUnit = {};
  for (const it of items) {
    const un = it.unit_ref?.name || it.unit || '?';
    (byUnit[un] ||= []).push(it.name + (it.is_active ? '' : ' [לא פעיל]'));
  }
  for (const [un, names] of Object.entries(byUnit)) {
    console.log(`\n  יחידת בסיס "${un}" - ${names.length} פריטים:`);
    console.log('    ' + names.join(', '));
  }

  // המרות קיימות בקטגוריה
  const ids = items.map((i) => i.id);
  const { data: convs } = await supabase
    .from('inventory_unit_conversions')
    .select('inventory_item_id, factor_to_base, from_unit_ref:from_unit_id (name)')
    .in('inventory_item_id', ids);
  console.log(`\nהמרות קיימות בקטגוריה: ${convs.length}`);
}
main().catch((e) => console.error('שגיאה:', e.message));
