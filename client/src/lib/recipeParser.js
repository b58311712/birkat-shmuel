// פרסר מתכון: מקבל טקסט חופשי של מתכון ומחזיר { portions, lines, instructions }.
//
// זיהוי מבנה:
//   1. קודם מחפשים כותרת "אופן ההכנה" (וּוריאציות) - כל מה שאחריה = הוראות הכנה.
//   2. אם אין כותרת, כל שורה מזוהה לפי מבנה: שורה שמתחילה בכמות (מספר/שבר) = רכיב,
//      אחרת = הוראת הכנה.
//
// כל שורת רכיב מפוצלת ל: quantity_for_recipe (מספר), unit (יחידה), ingredient_name (שם).

// כותרות שמסמנות מעבר לחלק "אופן ההכנה".
const INSTRUCTION_HEADINGS = [
  'אופן ההכנה',
  'אופן הכנה',
  'הוראות הכנה',
  'הוראות ההכנה',
  'הכנה',
  'אופן ההגשה',
];

// יחידות מידה מוכרות - הראשונות הן בעלות שתי מילים / רב-משמעיות, לפני היחידות הפשוטות.
// כל יחידה כאן היא regex-source; הסדר משפיע (יחידה ארוכה יותר קודם).
const UNIT_PATTERNS = [
  'ק"ג', 'קג', 'קילו', 'קילוגרם',
  'גרם', 'גר\'?', 'ג\'',
  'מ"ל', 'מל', 'ליטר', 'ל\'',
  'כפות', 'כף', 'כפיות', 'כפית',
  'כוסות', 'כוס',
  'יחידות', 'יח\'?', 'יח\'', 'יח',
  'חבילות', 'חבילה', 'חב\'',
  'שקיות', 'שקית',
  'קופסאות', 'קופסה',
  'צרורות', 'צרור',
  'ראשים', 'ראש',
  'שיני', 'שן',
  'קורט',
];

const UNIT_RE_SOURCE = UNIT_PATTERNS.join('|');

// כמות בתחילת שורה: מספר שלם / עשרוני / שבר (1/2) / מספר+שבר (1 1/2).
// תומך בגרש/מרכאות בתוך היחידה. דוגמאות: "3", "1/2", "1 1/2", "0.5".
const QUANTITY_RE = /^\s*(\d+(?:[.,]\d+)?(?:\s+\d+\/\d+)?|\d+\/\d+)\s*/;

// שורה שמתחילה בכמות ואחריה (אופציונלית) יחידה ואז שם רכיב.
const LINE_RE = new RegExp(
  `^\\s*(\\d+(?:[.,]\\d+)?(?:\\s+\\d+\\/\\d+)?|\\d+\\/\\d+)\\s*(${UNIT_RE_SOURCE})?\\.?\\s+(.*)$`
);

// המרת מחרוזת כמות (כולל שברים) למספר עשרוני.
export function parseQuantity(raw) {
  if (raw == null) return null;
  const str = String(raw).trim().replace(',', '.');
  if (!str) return null;

  // מספר + שבר: "1 1/2"
  const mixed = str.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) {
    const [, whole, n, d] = mixed;
    const denom = Number(d);
    if (denom === 0) return null;
    return Number(whole) + Number(n) / denom;
  }

  // שבר בלבד: "1/2"
  const frac = str.match(/^(\d+)\/(\d+)$/);
  if (frac) {
    const denom = Number(frac[2]);
    if (denom === 0) return null;
    return Number(frac[1]) / denom;
  }

  const n = Number(str);
  return Number.isFinite(n) ? n : null;
}

// זיהוי אם שורה היא כותרת "אופן ההכנה". מחזיר את הטקסט שאחרי הנקודתיים (אם יש).
function matchInstructionHeading(line) {
  const trimmed = line.replace(/[:：]\s*$/, '').trim();
  for (const heading of INSTRUCTION_HEADINGS) {
    if (trimmed === heading) return { after: '' };
    // כותרת עם תוכן באותה שורה: "אופן ההכנה: חובה לשטוף..."
    const withColon = new RegExp(`^${heading}\\s*[:：]\\s*(.*)$`);
    const m = line.match(withColon);
    if (m) return { after: m[1].trim() };
  }
  return null;
}

// פירוק שורת רכיב בודדת ל-{ quantity_for_recipe, unit, ingredient_name }.
// מחזיר null אם השורה לא נראית כמו רכיב (לא מתחילה בכמות).
export function parseIngredientLine(line) {
  const text = line.trim();
  if (!text) return null;

  const m = text.match(LINE_RE);
  if (!m) return null;

  const quantity = parseQuantity(m[1]);
  if (quantity == null) return null;

  const unit = (m[2] || '').replace(/\.$/, '').trim();
  const name = (m[3] || '').trim();
  if (!name) return null;

  return {
    quantity_for_recipe: quantity,
    unit,
    ingredient_name: name,
  };
}

// האם השורה נראית כמו רכיב (מתחילה בכמות)?
function looksLikeIngredient(line) {
  return QUANTITY_RE.test(line);
}

// הפרסר הראשי. מקבל טקסט מלא ומחזיר:
//   { portions, lines: [{ ingredient_name, quantity_for_recipe, unit, notes }], instructions }
// portions ברירת מחדל 1 (מתכון בודד). ניתן לגלות מהטקסט אם כתוב "מספיק ל־X מנות".
export function parseRecipe(text) {
  const rawLines = String(text || '').split(/\r?\n/);

  const lines = [];
  const instructionParts = [];
  let inInstructions = false;
  let portions = 1;
  let portionsDetected = false;

  for (const raw of rawLines) {
    const line = raw.trim();
    if (!line) continue;

    // זיהוי כותרת "אופן ההכנה" → מכאן והלאה הכל הוראות.
    const heading = matchInstructionHeading(line);
    if (heading) {
      inInstructions = true;
      if (heading.after) instructionParts.push(heading.after);
      continue;
    }

    // ניסיון לזהות "מספיק ל־X מנות" / "ל-X מנות" בכל מקום.
    if (!portionsDetected) {
      const p = line.match(/(?:מספיק\s+ל|ל[־-]?)\s*(\d+)\s*מנות/);
      if (p) {
        const n = Number(p[1]);
        if (Number.isFinite(n) && n > 0) {
          portions = n;
          portionsDetected = true;
          continue;
        }
      }
    }

    if (inInstructions) {
      instructionParts.push(line);
      continue;
    }

    // עדיין בחלק הרכיבים: אם השורה נראית כרכיב - מפרקים; אחרת מתחילים הוראות.
    if (looksLikeIngredient(line)) {
      const parsed = parseIngredientLine(line);
      if (parsed) {
        lines.push({ ...parsed, notes: '' });
        continue;
      }
    }

    // שורה שאינה רכיב לפני שהגענו לכותרת → נניח שזו תחילת ההוראות.
    inInstructions = true;
    instructionParts.push(line);
  }

  return {
    portions,
    lines,
    instructions: instructionParts.join('\n'),
  };
}
