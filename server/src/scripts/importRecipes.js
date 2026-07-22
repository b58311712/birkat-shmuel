// יבוא מתכונים מקובץ טקסט (recipes-source.txt) למאכלים + שורות מתכון.
//
// הרצה:
//   node src/scripts/importRecipes.js            → תצוגה בלבד (dry-run), לא כותב ל-DB
//   node src/scripts/importRecipes.js --commit   → מעלה בפועל ל-DB (מאכלים חדשים בלבד; קיימים מדולגים)
//   node src/scripts/importRecipes.js --commit --update-existing
//                                                → בנוסף: למאכלים שכבר קיימים, מעדכן את
//                                                  recipe_portions + אופן ההכנה, ומחליף את
//                                                  שורות המתכון מהמקור (מזין מחדש את הכמויות).
//
// כל מתכון בקובץ מופרד ב-### <שם המאכל>, ואחריו שורת תפוקה, רכיבים,
// כותרת "אופן ההכנה:" והוראות. הקטגוריה נגזרת אוטומטית משם המאכל.
import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { supabase } from '../lib/supabase.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE = join(__dirname, 'recipes-source.txt');
const COMMIT = process.argv.includes('--commit');
const UPDATE_EXISTING = process.argv.includes('--update-existing');

// נרמול שם מאכל להתאמה בין המקור ל-DB: שמות המקור עשויים להשתמש בסוגריים
// הפוכים (ארטיפקט RTL: ")שבת(" במקום "(שבת)") ובביטויים בסוגריים שאינם ב-DB.
// לכן מסירים לגמרי כל קבוצת סוגריים (בשני הכיוונים) ומכווצים רווחים.
function normalizeName(name) {
  return String(name || '')
    .replace(/\([^)(]*\)/g, '')  // (טקסט)
    .replace(/\)[^)(]*\(/g, '')  // )טקסט(  - סוגריים הפוכים
    .replace(/\s+/g, ' ')
    .trim();
}

// ---------------------------------------------------------------------------
// מיפוי קטגוריות: לפי מילת מפתח בשם המאכל. הראשון שמתאים - קובע.
// שמות הקטגוריות חייבים להתאים לקיימים ב-DB (seed.sql).
// ---------------------------------------------------------------------------
const CATEGORY_RULES = [
  { match: /^סלט|^הערינג|^ביצים/, category: 'סלטים קבועים' },
  { match: /^דגים/, category: 'דגים' },
  { match: /^מרק/, category: 'מרק' },
  { match: /^לפתן|^נקטר|^קומפוט/, category: 'מנה אחרונה' },
  { match: /^עוף|^רולדה|^טשולנט|^צ'ולנט|^בשר|^שניצל/, category: 'מנה עיקרית' },
  // ברירת מחדל לכל השאר (אורז, קוגל, פערפיל, אטריות, קניידל, צימעס, שעועית, תפו"א, כבד, קישקע)
  { match: /.*/, category: 'תוספות' },
];

function categoryFor(name) {
  for (const rule of CATEGORY_RULES) if (rule.match.test(name)) return rule.category;
  return 'כללי';
}

// ---------------------------------------------------------------------------
// פרסר כמויות: תומך בשלם, עשרוני, שבר (1/2), מספר+שבר (1 1/2), טווח (7-8 → 8).
// ---------------------------------------------------------------------------
function parseQuantity(raw) {
  const str = String(raw).trim().replace(',', '.');
  if (!str) return null;

  // טווח "7-8" / "3-5" → לוקחים את הגבוה (מספיק לרכיב)
  const range = str.match(/^(\d+(?:\.\d+)?)-(\d+(?:\.\d+)?)$/);
  if (range) return Number(range[2]);

  const mixed = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const d = Number(mixed[3]);
    return d === 0 ? null : Number(mixed[1]) + Number(mixed[2]) / d;
  }

  const frac = str.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const d = Number(frac[2]);
    return d === 0 ? null : Number(frac[1]) / d;
  }

  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

// יחידות מוכרות (source ל-regex). ארוכות/רב-מיליות קודם.
const UNITS = [
  'ק"ג', 'קילו', 'גרם', 'גר\'', 'מ"ל', 'ליטר', 'גלון',
  'כפיות', 'כפית', 'כפות', 'כף', 'כוסות', 'כוס',
  'שקיות', 'שקית', 'שק', 'קופסאות', 'קופסה', 'קופסת', 'צנצנת',
  'חבילות', 'חבילה', 'חב\'', 'יחידות', 'יחי\'', 'יח\'', 'יח',
  'פסים', 'פס', 'שיני', 'שן', 'חופן', 'קורט', 'ראשים', 'ראש',
];
// היחידה חייבת להסתיים ברווח או בסוף המחרוזת (לא \b - הוא לא עובד עם עברית/מרכאות).
const UNIT_RE = new RegExp(`^(${UNITS.join('|')})(?=\\s|$)`);

// כותרות שמתחילות את חלק ההוראות.
const INSTRUCTION_HEADINGS = [
  'אופן ההכנה', 'אופן הכנה', 'הוראות הכנה', 'הוראות אפיה', 'לאפות', 'הפרשת חלה',
];
// כותרת תת-מתכון (רוטב נפרד) - נכניס אותה כטקסט לאופן ההכנה, ואת הרכיבים שלה כרכיבים רגילים.
const SUBRECIPE_HEADINGS = ['אופן הכנת הרוטב', 'הכנת התערובת', 'הכנת התרכובת', 'הכנת הרוטב'];

function isInstructionHeading(line) {
  const t = line.replace(/[:：]\s*$/, '').trim();
  return INSTRUCTION_HEADINGS.some((h) => t === h || t.startsWith(h));
}
function isSubrecipeHeading(line) {
  const t = line.replace(/[:：]\s*$/, '').trim();
  return SUBRECIPE_HEADINGS.some((h) => t === h);
}

// דפוס כמות משותף. סדר האלטרנטיבות קריטי: שבר-מעורב (1 1/2) ושבר (1/2) לפני
// מספר שלם, אחרת "\d+" היה תופס רק את "1" מתוך "1/2".
const QTY_PATTERN = '\\d+\\s+\\d+\\/\\d+|\\d+\\/\\d+|\\d+-\\d+|\\d+(?:[.,]\\d+)?';

// שורה שמתחילה בכמות?
const STARTS_WITH_QTY = new RegExp(`^\\s*(${QTY_PATTERN})\\s`);

// חילוץ מספר המנות משורת התפוקה: "מיועד ל 20 מנות", "80 מנות סעודת שבת",
// "80-100 מנות", "כ- 300 מנות". מחזיר את המספר או null.
function parsePortions(line) {
  // "מיועד ל X מנות" / "ל X מנות"
  let m = line.match(/(?:מיועד\s+ל|ל)\s*(\d+)(?:-\d+)?\s*מנות/);
  if (m) return Number(m[1]);
  // "X מנות" / "X-Y מנות" / "כ- X מנות"
  m = line.match(/(\d+)(?:-\d+)?\s*מנות/);
  if (m) return Number(m[1]);
  return null;
}

// פירוק שורת רכיב → { quantity, unit, name } או null.
function parseIngredient(line) {
  const text = line.trim().replace(/\.$/, '');
  const qtyMatch = text.match(new RegExp(`^(${QTY_PATTERN})\\s*`));
  if (!qtyMatch) return null;

  const quantity = parseQuantity(qtyMatch[1]);
  if (quantity == null || quantity <= 0) return null;

  let rest = text.slice(qtyMatch[0].length).trim();

  // יחידה (אם יש) בתחילת השארית
  let unit = '';
  const unitMatch = rest.match(UNIT_RE);
  if (unitMatch) {
    unit = unitMatch[1];
    rest = rest.slice(unitMatch[0].length).trim();
  }

  const name = rest.trim();
  if (!name) return null;

  // אם אין יחידה מפורשת - נשתמש ב"יח'" (למשל "4 גזר", "10 ביצים", "80 דגי מושט")
  return { quantity, unit: unit || 'יח\'', name };
}

// ---------------------------------------------------------------------------
// פירוק בלוק מתכון בודד.
// ---------------------------------------------------------------------------
function parseRecipe(block) {
  const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
  const name = lines.shift().replace(/^#+\s*/, '').trim();

  let portions = null;
  const ingredients = [];
  const instructions = [];
  let seenContent = false; // האם כבר ראינו רכיב/הוראה (כדי לזהות את שורת התפוקה הפותחת)

  for (const line of lines) {
    // שורת תפוקה בסוגריים בתחילת המתכון (לפני כל רכיב/הוראה).
    // דוגמאות: "מיועד ל 20 מנות" / "80 מנות סעודת שבת" / "כ 150 קניידל'ך" / "אפוי בתנור".
    if (!seenContent && /^[)(].*[)(]$/.test(line)) {
      const p = parsePortions(line);
      if (p) portions = p;
      continue; // מדלגים על שורת התפוקה בכל מקרה - לא נכנסת להוראות
    }

    if (isInstructionHeading(line)) { seenContent = true; instructions.push(line.replace(/:$/, '') + ':'); continue; }
    if (isSubrecipeHeading(line)) { seenContent = true; instructions.push(line.replace(/:$/, '') + ':'); continue; }

    // תת-מתכון: גם אחרי כותרת "אופן הכנת הרוטב" יכולים לבוא רכיבים - נזהה לפי מבנה.
    if (STARTS_WITH_QTY.test(line)) {
      const ing = parseIngredient(line);
      if (ing) { ingredients.push(ing); seenContent = true; continue; }
    }

    // אחרת: הוראה
    seenContent = true;
    instructions.push(line);
  }

  return {
    name,
    category: categoryFor(name),
    portions: portions || 1,
    portionsDetected: portions != null,
    ingredients,
    instructions: instructions.join('\n'),
  };
}

function parseSource(text) {
  return text
    .split(/^###\s+/m)
    .map((b) => b.trim())
    .filter(Boolean)
    .map((b) => parseRecipe('### ' + b));
}

// ---------------------------------------------------------------------------
// תצוגה
// ---------------------------------------------------------------------------
function printSummary(recipes) {
  console.log(`\n📋 נמצאו ${recipes.length} מתכונים:\n`);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(pad('#', 3), pad('שם מאכל', 30), pad('קטגוריה', 14), pad('מנות', 6), 'רכיבים');
  console.log('─'.repeat(70));
  recipes.forEach((r, i) => {
    const flag = r.portionsDetected ? '' : ' ⚠';
    console.log(
      pad(i + 1, 3),
      pad(r.name, 30),
      pad(r.category, 14),
      pad(r.portions + flag, 6),
      r.ingredients.length,
    );
  });

  const noPortions = recipes.filter((r) => !r.portionsDetected);
  const noIngredients = recipes.filter((r) => r.ingredients.length === 0);
  if (noPortions.length) console.log(`\n⚠  ${noPortions.length} מתכונים ללא זיהוי מנות (ברירת מחדל 1): ${noPortions.map((r) => r.name).join(', ')}`);
  if (noIngredients.length) console.log(`\n⚠  ${noIngredients.length} מתכונים ללא רכיבים: ${noIngredients.map((r) => r.name).join(', ')}`);
}

function printDetail(recipes) {
  for (const r of recipes) {
    console.log(`\n${'='.repeat(60)}\n${r.name}  [${r.category}]  · מיועד ל-${r.portions} מנות`);
    for (const ing of r.ingredients) {
      console.log(`   • ${ing.quantity} ${ing.unit}  ${ing.name}`);
    }
    if (r.instructions) console.log(`   ── אופן הכנה ──\n${r.instructions.split('\n').map((l) => '     ' + l).join('\n')}`);
  }
}

// ---------------------------------------------------------------------------
// העלאה ל-DB
// ---------------------------------------------------------------------------
async function commit(recipes) {
  // קטגוריות קיימות
  const { data: cats, error: catErr } = await supabase.from('categories').select('id, name');
  if (catErr) throw catErr;
  const catByName = Object.fromEntries((cats || []).map((c) => [c.name, c.id]));

  // ודא שכל הקטגוריות הנדרשות קיימות
  const needed = [...new Set(recipes.map((r) => r.category))];
  const missing = needed.filter((n) => !catByName[n]);
  if (missing.length) throw new Error(`קטגוריות חסרות ב-DB: ${missing.join(', ')}. הריצי seed או צרי אותן ידנית.`);

  // מאכלים קיימים - מתאימים לפי שם מנורמל (מקור ל-DB), כדי לזהות קיימים גם כאשר
  // הסוגריים שונים. אם שני מאכלים מנורמלים לאותו שם - לא נבחר אוטומטית (ambiguous).
  const { data: existingMeals, error: mErr } = await supabase.from('meals').select('id, name');
  if (mErr) throw mErr;
  const byNorm = new Map();
  const ambiguous = new Set();
  for (const m of existingMeals || []) {
    const key = normalizeName(m.name);
    if (byNorm.has(key)) ambiguous.add(key);
    else byNorm.set(key, m);
  }

  // בונה את שורות המתכון מתוך המתכון שנותח. כמות למנה אחת = כמות למתכון / מנות.
  const linesFor = (mealId, r) => r.ingredients.map((ing) => ({
    meal_id: mealId,
    ingredient_name: ing.name,
    quantity_per_portion: Number((ing.quantity / r.portions).toFixed(4)),
    unit: ing.unit,
  }));

  let created = 0, updated = 0, skipped = 0;
  for (const r of recipes) {
    const key = normalizeName(r.name);
    const existing = byNorm.get(key);

    // ----- מאכל קיים -----
    if (existing) {
      if (ambiguous.has(key)) {
        console.log(`  ⏭  דילוג (שם דו-משמעי ב-DB, עדכני ידנית): ${r.name}`);
        skipped++;
        continue;
      }
      if (!UPDATE_EXISTING) {
        console.log(`  ⏭  דילוג (כבר קיים): ${r.name} → "${existing.name}"`);
        skipped++;
        continue;
      }

      // עדכון מספר המנות המקורי + אופן ההכנה על המאכל (לא נוגעים בשם/קטגוריה/מחיר).
      const { error: upErr } = await supabase.from('meals')
        .update({ recipe_portions: r.portions, preparation_instructions: r.instructions || null })
        .eq('id', existing.id);
      if (upErr) { console.error(`  ❌ ${existing.name}: ${upErr.message}`); continue; }

      // החלפת שורות המתכון: מחיקה ואז הזנה מחדש (מזין מחדש את הכמויות מהמקור).
      const { error: delErr } = await supabase.from('recipe_lines').delete().eq('meal_id', existing.id);
      if (delErr) { console.error(`  ❌ ${existing.name}: מחיקת שורות ישנות - ${delErr.message}`); continue; }
      if (r.ingredients.length) {
        const { error: rErr } = await supabase.from('recipe_lines').insert(linesFor(existing.id, r));
        if (rErr) { console.error(`  ⚠ ${existing.name}: הזנת שורות - ${rErr.message}`); continue; }
      }

      console.log(`  🔄 עודכן: ${existing.name}  (${r.ingredients.length} רכיבים, ${r.portions} מנות)`);
      updated++;
      continue;
    }

    // ----- מאכל חדש -----
    const { data: meal, error: insErr } = await supabase.from('meals').insert({
      name: r.name,
      category_id: catByName[r.category],
      included_in_base: true,
      requires_extra_charge: false,
      recipe_portions: r.portions,
      preparation_instructions: r.instructions || null,
      is_active: true,
    }).select('id').single();
    if (insErr) { console.error(`  ❌ ${r.name}: ${insErr.message}`); continue; }

    if (r.ingredients.length) {
      const { error: rErr } = await supabase.from('recipe_lines').insert(linesFor(meal.id, r));
      if (rErr) console.error(`  ⚠ ${r.name}: שגיאה בשורות מתכון - ${rErr.message}`);
    }

    console.log(`  ✓ נוצר: ${r.name}  (${r.ingredients.length} רכיבים, ${r.portions} מנות)`);
    created++;
  }

  console.log(`\n✅ הושלם: ${created} נוצרו, ${updated} עודכנו, ${skipped} דולגו.`);
  if (!UPDATE_EXISTING && skipped) {
    console.log('   💡 לעדכון מאכלים קיימים (recipe_portions + כמויות): הוסיפי --update-existing');
  }
}

// תצוגה מקדימה (read-only) של ההתאמה מול ה-DB: מה ייווצר, מה יעודכן, מה ידולג.
async function previewMatch(recipes) {
  const { data: existingMeals, error } = await supabase.from('meals').select('name');
  if (error) { console.log(`\n(לא ניתן לבדוק מול DB: ${error.message})`); return; }
  const byNorm = new Map();
  const ambiguous = new Set();
  for (const m of existingMeals || []) {
    const key = normalizeName(m.name);
    if (byNorm.has(key)) ambiguous.add(key); else byNorm.set(key, m);
  }

  const willCreate = [], willUpdate = [], willSkip = [];
  for (const r of recipes) {
    const key = normalizeName(r.name);
    if (!byNorm.has(key)) willCreate.push(r.name);
    else if (ambiguous.has(key)) willSkip.push(`${r.name} (דו-משמעי)`);
    else if (UPDATE_EXISTING) willUpdate.push(`${r.name} → "${byNorm.get(key).name}"`);
    else willSkip.push(`${r.name} → "${byNorm.get(key).name}"`);
  }
  console.log(`\n🔎 תצוגה מקדימה מול ה-DB (${UPDATE_EXISTING ? 'מצב עדכון קיימים' : 'ברירת מחדל - קיימים ידולגו'}):`);
  console.log(`   ➕ ייווצרו: ${willCreate.length}${willCreate.length ? ' - ' + willCreate.join(', ') : ''}`);
  console.log(`   🔄 יעודכנו: ${willUpdate.length}${willUpdate.length ? ' - ' + willUpdate.map((s) => s.split(' →')[0]).join(', ') : ''}`);
  console.log(`   ⏭  ידולגו: ${willSkip.length}${willSkip.length ? ' - ' + willSkip.map((s) => s.split(' →')[0].split(' (')[0]).join(', ') : ''}`);
}

// ---------------------------------------------------------------------------
async function main() {
  const text = readFileSync(SOURCE, 'utf8');
  const recipes = parseSource(text);

  printSummary(recipes);

  if (process.argv.includes('--detail')) printDetail(recipes);

  if (!COMMIT) {
    await previewMatch(recipes);
    console.log('\n💡 זו תצוגה בלבד (dry-run). להעלאה בפועל: node src/scripts/importRecipes.js --commit');
    console.log('   לעדכון מאכלים קיימים (recipe_portions + כמויות): --commit --update-existing');
    console.log('   לפירוט מלא של רכיבים והוראות: הוסיפי --detail');
    return;
  }

  console.log('\n🚀 מעלה ל-DB...\n');
  await commit(recipes);
}

main().catch((e) => { console.error('\n❌ שגיאה:', e.message); process.exit(1); });
