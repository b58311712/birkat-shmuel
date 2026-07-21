import { useMemo, useState } from 'react';
import { splitPercentsFor } from '../lib/splitPercents.js';

const UNCATEGORIZED_ID = '__uncategorized__';

const completedTabStyle = {
  backgroundColor: '#ecfdf5',
  borderColor: '#86efac',
  color: '#052e16',
};

const activeCompletedTabStyle = {
  backgroundColor: '#15803d',
  borderColor: '#15803d',
  color: '#ffffff',
};

function categoryGroups(catalog, mealSlotId, selectedMeals = {}) {
  const categoriesById = new Map(catalog.categories.map((category) => [category.id, category]));
  const groupsById = new Map(
    catalog.categories.map((category) => [
      category.id,
      { id: category.id, category, meals: [] },
    ])
  );
  const uncategorized = { id: UNCATEGORIZED_ID, category: null, meals: [] };

  // מאכל מוצג בסעודה אם הוא זמין בה כרגע, או שהוא כבר נבחר בהזמנה זו (גם אם זמינותו
  // בקטלוג בוטלה מאז) — כדי שמאכל "יתום" מהזמנה ישנה יישאר גלוי וניתן להסרה בעריכה.
  const shownMealIds = new Set(
    catalog.meals.filter((m) => m.available_slot_ids.includes(mealSlotId)).map((m) => m.id)
  );
  for (const key of Object.keys(selectedMeals)) {
    const [slotId, mealId] = key.split(':');
    if (slotId === mealSlotId) shownMealIds.add(mealId);
  }

  for (const meal of catalog.meals) {
    if (!shownMealIds.has(meal.id)) continue;
    const unavailable = !meal.available_slot_ids.includes(mealSlotId);
    const entry = { ...meal, unavailable_in_slot: unavailable };
    if (categoriesById.has(meal.category_id)) {
      groupsById.get(meal.category_id).meals.push(entry);
    } else {
      uncategorized.meals.push(entry);
    }
  }

  const groups = [...groupsById.values()].filter((group) => group.meals.length > 0);
  if (uncategorized.meals.length > 0) groups.push(uncategorized);
  return groups;
}

// מאכל "נבחר" אם המפתח קיים במפה. הערך יכול להיות true (קטגוריה רגילה) או
// מספר מנות (קטגוריה שמחלקת) — כולל 0, שהוא בחירה תקפה שממתינה להזנת כמות.
function isSelected(selectedMeals, mealSlotId, mealId) {
  return Object.prototype.hasOwnProperty.call(selectedMeals, `${mealSlotId}:${mealId}`);
}

function selectedInGroup(group, mealSlotId, selectedMeals) {
  return group.meals.filter((meal) => isSelected(selectedMeals, mealSlotId, meal.id)).length;
}

// כמה מאכלים בקבוצה נבחרו דרך ירושה מסעודת-האב (נעולים, לא נספרים במכסה).
function countInheritedInGroup(group, mealSlotId, inheritedKeys) {
  return group.meals.filter((meal) => inheritedKeys.has(`${mealSlotId}:${meal.id}`)).length;
}

// מצב חלוקת המנות של הקטגוריה: 'none' | 'equal' | 'additive'.
// תאימות-לאחור: קטגוריה ישנה עם requires_portion_split בלבד נחשבת 'equal'.
function splitModeOf(category) {
  if (!category) return 'none';
  if (category.split_mode) return category.split_mode;
  return category.requires_portion_split ? 'equal' : 'none';
}

// בקטגוריה במצב equal: סך הכמויות שהוזנו לכל המאכלים שנבחרו בקבוצה.
function splitSumInGroup(group, mealSlotId, selectedMeals) {
  return group.meals.reduce((sum, meal) => {
    const v = selectedMeals[`${mealSlotId}:${meal.id}`];
    return typeof v === 'number' ? sum + v : sum;
  }, 0);
}

// בקטגוריה במצב additive: כמה מאכלים מרכזיים (לא-משניים) נבחרו — לכל היותר אחד.
function primarySelectedInGroup(group, mealSlotId, selectedMeals) {
  return group.meals.filter(
    (meal) => !meal.is_secondary && isSelected(selectedMeals, mealSlotId, meal.id)
  ).length;
}

// מידע ירושה של קבוצה בסעודה הנוכחית, או null אם אינה סעודה יורשת.
// { extraAllowed, inheritedCount, manualCount } — extraAllowed הוא מכסת התוספת.
function inheritStateOfGroup(group, mealSlotId, selectedMeals, inheritByCategory, inheritedKeys) {
  const info = group.category ? inheritByCategory[group.category.id] : undefined;
  if (!info || info.parentSlotId === mealSlotId) return null;
  const inheritedCount = countInheritedInGroup(group, mealSlotId, inheritedKeys);
  const manualCount = selectedInGroup(group, mealSlotId, selectedMeals) - inheritedCount;
  return { extraAllowed: info.extraAllowed, inheritedCount, manualCount };
}

function isGroupComplete(group, mealSlotId, selectedMeals, slotPortions, inherit) {
  const selectedCount = selectedInGroup(group, mealSlotId, selectedMeals);
  // סעודה יורשת: מושלמת כשיש ירושה כלשהי ומכסת התוספת נוצלה במלואה.
  if (inherit) {
    if (inherit.inheritedCount === 0) return false;
    return inherit.extraAllowed == null || inherit.manualCount >= inherit.extraAllowed;
  }
  const mode = splitModeOf(group.category);
  // additive מושלם כשנבחר לפחות מאכל אחד ולא נבחר יותר ממאכל עיקרי אחד.
  if (mode === 'additive') {
    if (selectedCount === 0) return false;
    return primarySelectedInGroup(group, mealSlotId, selectedMeals) <= 1;
  }
  // equal מושלם רק כשסך הכמויות שווה למנות הסעודה.
  if (mode === 'equal') {
    if (selectedCount === 0) return false;
    return splitSumInGroup(group, mealSlotId, selectedMeals) === slotPortions;
  }
  return group.category?.max_allowed != null && selectedCount >= group.category.max_allowed;
}

function shortLimitText(category, selectedCount, inherit) {
  if (inherit) {
    return inherit.extraAllowed != null
      ? `${inherit.inheritedCount}+${inherit.manualCount}/${inherit.extraAllowed}`
      : `${inherit.inheritedCount}+${inherit.manualCount}`;
  }
  if (category?.max_allowed != null) return `${selectedCount}/${category.max_allowed}`;
  return String(selectedCount);
}

function fullLimitText(category, selectedCount) {
  if (category?.max_allowed != null) return `נבחרו ${selectedCount} מתוך ${category.max_allowed}`;
  return `${selectedCount} נבחרו, ללא מגבלה`;
}

export function MealCategoryPicker({ catalog, mealSlotId, slotPortions = 0, selectedMeals, onToggleMeal, onSetMealPortions, allowOverMax = false, inheritByCategory = {}, inheritedKeys = new Set() }) {
  const groups = useMemo(
    () => categoryGroups(catalog, mealSlotId, selectedMeals),
    [catalog, mealSlotId, selectedMeals]
  );
  const [activeGroupId, setActiveGroupId] = useState('');

  if (groups.length === 0) {
    return <p className="text-sm text-brand-burgundy/50">אין מאכלים זמינים לסעודה זו.</p>;
  }

  const firstGroupWithSelection = groups.find((group) => selectedInGroup(group, mealSlotId, selectedMeals) > 0);
  const activeGroup =
    groups.find((group) => group.id === activeGroupId) ||
    firstGroupWithSelection ||
    groups[0];
  const activeSelectedCount = selectedInGroup(activeGroup, mealSlotId, selectedMeals);
  // ירושה: בקטגוריה יורשת (וכשהסעודה הנוכחית איננה סעודת-האב), חלק מהבחירות
  // הן ירושות ונעולות. המכסה (extra_allowed) חלה רק על התוספות הידניות.
  const activeInherit = inheritStateOfGroup(activeGroup, mealSlotId, selectedMeals, inheritByCategory, inheritedKeys);
  const isInheritingSlot = !!activeInherit;
  const inheritedCount = activeInherit?.inheritedCount ?? 0;
  const manualCount = activeInherit?.manualCount ?? activeSelectedCount;
  const activeComplete = isGroupComplete(activeGroup, mealSlotId, selectedMeals, slotPortions, activeInherit);
  const maxAllowed = isInheritingSlot ? activeInherit.extraAllowed : activeGroup.category?.max_allowed;
  // בסעודה יורשת סופרים רק תוספות ידניות מול extra_allowed.
  const limitCount = isInheritingSlot ? manualCount : activeSelectedCount;
  const atOrOverMax = maxAllowed != null && limitCount >= maxAllowed;
  // בזרימת המנהל (allowOverMax) לא חוסמים את המקסימום — רק מתריעים על החריגה.
  const reachedLimit = atOrOverMax && !allowOverMax;
  const overMax = allowOverMax && maxAllowed != null && limitCount > maxAllowed;
  const splitMode = splitModeOf(activeGroup.category);
  const isEqualSplit = splitMode === 'equal';
  const isAdditive = splitMode === 'additive';
  const splitSum = isEqualSplit ? splitSumInGroup(activeGroup, mealSlotId, selectedMeals) : 0;
  // additive: כשכבר נבחר מאכל עיקרי, אי-אפשר לבחור עיקרי נוסף (רק מאכל משני).
  const primarySelected = isAdditive ? primarySelectedInGroup(activeGroup, mealSlotId, selectedMeals) : 0;
  // האחוזים תלויי-סעודה: לכל סעודה אפשר לקבוע חלוקה משלה (ברירת מחדל = של הקטגוריה).
  const { primary: primaryPct, secondary: secondaryPct } = splitPercentsFor(activeGroup.category, mealSlotId);

  return (
    <div className={`rounded-lg border bg-white overflow-hidden ${
      activeComplete ? 'border-green-300' : 'border-brand-cream-dark'
    }`}>
      <div className="flex gap-1.5 overflow-x-auto p-2 bg-brand-cream/35 border-b border-brand-cream-dark">
        {groups.map((group) => {
          const selectedCount = selectedInGroup(group, mealSlotId, selectedMeals);
          const groupInherit = inheritStateOfGroup(group, mealSlotId, selectedMeals, inheritByCategory, inheritedKeys);
          const isActive = group.id === activeGroup.id;
          const complete = isGroupComplete(group, mealSlotId, selectedMeals, slotPortions, groupInherit);
          const completedStyle = complete ? (isActive ? activeCompletedTabStyle : completedTabStyle) : undefined;
          const groupOverMax = allowOverMax
            && !groupInherit
            && group.category?.max_allowed != null
            && selectedCount > group.category.max_allowed;

          return (
            <button
              key={group.id}
              type="button"
              onClick={() => setActiveGroupId(group.id)}
              style={completedStyle}
              className={`shrink-0 flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ${
                isActive
                  ? complete
                    ? ''
                    : 'bg-brand-burgundy text-brand-cream border-brand-burgundy'
                  : complete
                    ? ''
                    : 'bg-white text-brand-burgundy border-brand-cream-dark hover:border-brand-gold'
              }`}
            >
              {complete && (
                <span className="text-xs leading-none" style={{ color: isActive ? '#ffffff' : '#166534' }}>
                  ✓
                </span>
              )}
              <span style={complete ? { color: isActive ? '#ffffff' : '#052e16' } : undefined}>
                {group.category?.name || 'ללא קטגוריה'}
              </span>
              <span
                title={groupOverMax ? 'חריגה ממקסימום הקטגוריה' : undefined}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  complete || groupOverMax
                    ? ''
                    : isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-brand-cream text-brand-burgundy/70'
                }`}
                style={
                  groupOverMax
                    ? { backgroundColor: '#fef3c7', color: '#92400e' }
                    : complete
                      ? {
                          backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : '#dcfce7',
                          color: isActive ? '#ffffff' : '#14532d',
                        }
                      : undefined
                }
              >
                {groupOverMax && '⚠ '}{shortLimitText(group.category, selectedCount, groupInherit)}
              </span>
            </button>
          );
        })}
      </div>

      <div className={`flex flex-wrap items-center justify-between gap-2 px-3 py-2 ${
        activeComplete ? 'bg-green-50' : ''
      }`}>
        <div className="flex items-center gap-2">
          <h4 className="font-bold text-brand-burgundy">{activeGroup.category?.name || 'ללא קטגוריה'}</h4>
          {activeComplete && (
            <span className="rounded-full bg-green-100 px-2 py-0.5 text-xs font-bold text-green-800">
              הושלם
            </span>
          )}
        </div>
        <span className={`text-xs font-medium ${activeComplete ? 'text-green-800' : 'text-brand-burgundy/60'}`}>
          {isInheritingSlot
            ? `מהלילה: ${inheritedCount}${maxAllowed != null ? ` · נוספים: ${manualCount}/${maxAllowed}` : ` · נוספים: ${manualCount}`}`
            : fullLimitText(activeGroup.category, activeSelectedCount)}
        </span>
      </div>

      {/* חריגה ממקסימום הקטגוריה — מותרת בזרימת המנהל, מוצגת כהתראה */}
      {overMax && (
        <div className="mx-3 mt-1 mb-1 rounded-lg border border-amber-300 bg-amber-50 px-3 py-1.5 text-sm font-medium text-amber-800">
          חריגה ממקסימום הקטגוריה: נבחרו {activeSelectedCount} מתוך {maxAllowed} המותרים. הבחירה תישמר כחריג.
        </div>
      )}

      {/* equal: סרגל התאמה בין סך הכמויות למנות הסעודה */}
      {isEqualSplit && activeSelectedCount > 0 && (
        <SplitPortionsBar sum={splitSum} target={slotPortions} count={activeSelectedCount} />
      )}

      {/* additive: הסבר החלוקה האוטומטית (מאכל עיקרי + תוספת מאכל משני) */}
      {isAdditive && activeSelectedCount > 0 && (
        <AdditiveSplitBar
          slotPortions={slotPortions}
          count={activeSelectedCount}
          primaryPct={primaryPct}
          secondaryPct={secondaryPct}
        />
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 px-2 pb-2 pt-2">
        {activeGroup.meals.map((meal) => {
          const key = `${mealSlotId}:${meal.id}`;
          const value = selectedMeals[key];
          const selected = Object.prototype.hasOwnProperty.call(selectedMeals, key);
          // מאכל שכבר אינו זמין בסעודה בקטלוג, אך נבחר בהזמנה זו — "יתום". מוצג רק
          // כשהוא נבחר, כדי שיהיה גלוי וניתן להסרה; לא ניתן לבחור מחדש לאחר הסרה.
          if (meal.unavailable_in_slot && !selected) return null;
          // מאכל ירוש מהלילה: נבחר ונעול — לא ניתן לבטלו כאן.
          const inherited = value === 'inherited';
          // additive: אי-אפשר לבחור מאכל עיקרי נוסף כשכבר נבחר אחד.
          const blockedPrimary = isAdditive && !selected && !meal.is_secondary && primarySelected >= 1;
          const disabled = inherited || (reachedLimit && !selected) || blockedPrimary;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggleMeal(mealSlotId, meal.id)}
              disabled={disabled}
              title={inherited ? 'נבחר בליל שבת — משוכפל אוטומטית' : blockedPrimary ? 'ניתן לבחור רק מאכל עיקרי אחד' : undefined}
              className={`relative min-h-10 rounded-lg border px-2.5 py-2 text-right text-sm leading-tight transition-colors ${
                inherited
                  ? 'bg-brand-burgundy/70 text-brand-cream border-brand-burgundy/70 cursor-not-allowed'
                  : selected
                    ? 'bg-brand-burgundy text-brand-cream border-brand-burgundy shadow-card'
                    : disabled
                      ? 'bg-brand-cream/40 text-brand-burgundy/35 border-brand-cream-dark cursor-not-allowed'
                      : 'bg-white text-brand-burgundy border-brand-cream-dark hover:border-brand-gold hover:bg-brand-cream/30'
              }`}
            >
              <span className="block font-medium">{meal.name}</span>
              {/* מאכל יתום — כבר אינו זמין בסעודה בקטלוג. לחיצה מסירה אותו מההזמנה. */}
              {meal.unavailable_in_slot && (
                <span className="block text-xs opacity-80 mt-0.5">⚠ הוסר מהקטלוג — לחצי להסרה</span>
              )}
              {/* ירושה: תיוג "מהלילה" כדי שהלקוח יבין שהמאכל הגיע מבחירת ליל שבת */}
              {inherited && (
                <span className="block text-xs opacity-80 mt-0.5">🔒 מהלילה</span>
              )}
              {/* additive: תיוג המאכל המשני כדי שהלקוח יבין את החלוקה */}
              {isAdditive && meal.is_secondary && (
                <span className="block text-xs opacity-70 mt-0.5">מאכל משני</span>
              )}
              {meal.requires_extra_charge && (
                <span className="block text-xs opacity-70 mt-0.5">+ {meal.extra_charge_amount}</span>
              )}
              {/* equal בלבד ונבחרו 2+ מאכלים — שדה כמות ידני למאכל */}
              {isEqualSplit && selected && activeSelectedCount > 1 && (
                <input
                  type="number"
                  min="0"
                  dir="ltr"
                  value={typeof value === 'number' ? value : ''}
                  placeholder="מנות"
                  onClick={(e) => e.stopPropagation()}
                  onChange={(e) => {
                    const n = e.target.value === '' ? 0 : Number(e.target.value);
                    onSetMealPortions(mealSlotId, meal.id, n);
                  }}
                  className="mt-1.5 w-full rounded border border-white/40 bg-white/90 px-1.5 py-1 text-center text-sm text-brand-burgundy"
                />
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function SplitPortionsBar({ sum, target, count }) {
  const match = sum === target;
  const single = count === 1;
  return (
    <div className={`mx-3 mt-1 mb-1 rounded-lg px-3 py-1.5 text-sm font-medium ${
      single
        ? 'bg-brand-cream/50 text-brand-burgundy/70'
        : match
          ? 'bg-green-50 text-green-800'
          : 'bg-amber-50 text-amber-800'
    }`}>
      {single
        ? `סוג יחיד — יקבל את כל ${target} המנות`
        : match
          ? `סך הכמויות: ${sum} / ${target} — תואם ✓`
          : `סך הכמויות: ${sum} / ${target} — חובה שיהיה שווה למספר המנות`}
    </div>
  );
}

// מציג את החלוקה האוטומטית במצב additive (עיגול כלפי מעלה, זהה לשרת).
function AdditiveSplitBar({ slotPortions, count, primaryPct, secondaryPct }) {
  // מאכל יחיד מקבל 100% מהמנות; משנבחר מאכל משני, החלוקה לפי האחוזים.
  if (count < 2) {
    return (
      <div className="mx-3 mt-1 mb-1 rounded-lg bg-brand-cream/50 px-3 py-1.5 text-sm font-medium text-brand-burgundy/70">
        {`מאכל יחיד — יקבל את כל ${slotPortions} המנות. אפשר להוסיף מאכל משני לקבלת תוספת מנות.`}
      </div>
    );
  }
  const primary = Math.ceil((slotPortions * primaryPct) / 100);
  const secondary = Math.ceil((slotPortions * secondaryPct) / 100);
  return (
    <div className="mx-3 mt-1 mb-1 rounded-lg bg-brand-gold/20 px-3 py-1.5 text-sm font-medium text-brand-burgundy-dark">
      {`חלוקה אוטומטית: מאכל עיקרי ${primary} מנות (${primaryPct}%) · מאכל משני ${secondary} מנות (${secondaryPct}%) — סה"כ ${primary + secondary}`}
    </div>
  );
}
