import { useMemo, useState } from 'react';

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

function categoryGroups(catalog, mealSlotId) {
  const categoriesById = new Map(catalog.categories.map((category) => [category.id, category]));
  const groupsById = new Map(
    catalog.categories.map((category) => [
      category.id,
      { id: category.id, category, meals: [] },
    ])
  );
  const uncategorized = { id: UNCATEGORIZED_ID, category: null, meals: [] };

  for (const meal of catalog.meals.filter((m) => m.available_slot_ids.includes(mealSlotId))) {
    if (categoriesById.has(meal.category_id)) {
      groupsById.get(meal.category_id).meals.push(meal);
    } else {
      uncategorized.meals.push(meal);
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

function isGroupComplete(group, mealSlotId, selectedMeals, slotPortions) {
  const selectedCount = selectedInGroup(group, mealSlotId, selectedMeals);
  const mode = splitModeOf(group.category);
  // additive מושלם כשנבחר לפחות דג אחד ולא נבחר יותר מדג מרכזי אחד.
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

function shortLimitText(category, selectedCount) {
  if (category?.max_allowed != null) return `${selectedCount}/${category.max_allowed}`;
  return String(selectedCount);
}

function fullLimitText(category, selectedCount) {
  if (category?.max_allowed != null) return `נבחרו ${selectedCount} מתוך ${category.max_allowed}`;
  return `${selectedCount} נבחרו, ללא מגבלה`;
}

export function MealCategoryPicker({ catalog, mealSlotId, slotPortions = 0, selectedMeals, onToggleMeal, onSetMealPortions, allowOverMax = false }) {
  const groups = useMemo(() => categoryGroups(catalog, mealSlotId), [catalog, mealSlotId]);
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
  const activeComplete = isGroupComplete(activeGroup, mealSlotId, selectedMeals, slotPortions);
  const maxAllowed = activeGroup.category?.max_allowed;
  const atOrOverMax = maxAllowed != null && activeSelectedCount >= maxAllowed;
  // בזרימת המנהל (allowOverMax) לא חוסמים את המקסימום — רק מתריעים על החריגה.
  const reachedLimit = atOrOverMax && !allowOverMax;
  const overMax = allowOverMax && maxAllowed != null && activeSelectedCount > maxAllowed;
  const splitMode = splitModeOf(activeGroup.category);
  const isEqualSplit = splitMode === 'equal';
  const isAdditive = splitMode === 'additive';
  const splitSum = isEqualSplit ? splitSumInGroup(activeGroup, mealSlotId, selectedMeals) : 0;
  // additive: כשכבר נבחר דג מרכזי, אי-אפשר לבחור דג מרכזי נוסף (רק דג משני/זול).
  const primarySelected = isAdditive ? primarySelectedInGroup(activeGroup, mealSlotId, selectedMeals) : 0;
  const primaryPct = Number(activeGroup.category?.primary_percent ?? 80);
  const secondaryPct = Number(activeGroup.category?.secondary_percent ?? 50);

  return (
    <div className={`rounded-lg border bg-white overflow-hidden ${
      activeComplete ? 'border-green-300' : 'border-brand-cream-dark'
    }`}>
      <div className="flex gap-1.5 overflow-x-auto p-2 bg-brand-cream/35 border-b border-brand-cream-dark">
        {groups.map((group) => {
          const selectedCount = selectedInGroup(group, mealSlotId, selectedMeals);
          const isActive = group.id === activeGroup.id;
          const complete = isGroupComplete(group, mealSlotId, selectedMeals, slotPortions);
          const completedStyle = complete ? (isActive ? activeCompletedTabStyle : completedTabStyle) : undefined;
          const groupOverMax = allowOverMax
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
                {groupOverMax && '⚠ '}{shortLimitText(group.category, selectedCount)}
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
          {fullLimitText(activeGroup.category, activeSelectedCount)}
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

      {/* additive: הסבר החלוקה האוטומטית (דג עיקרי + תוספת דג משני) */}
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
          // additive: אי-אפשר לבחור דג מרכזי נוסף כשכבר נבחר אחד.
          const blockedPrimary = isAdditive && !selected && !meal.is_secondary && primarySelected >= 1;
          const disabled = (reachedLimit && !selected) || blockedPrimary;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggleMeal(mealSlotId, meal.id)}
              disabled={disabled}
              title={blockedPrimary ? 'ניתן לבחור רק דג עיקרי אחד' : undefined}
              className={`relative min-h-10 rounded-lg border px-2.5 py-2 text-right text-sm leading-tight transition-colors ${
                selected
                  ? 'bg-brand-burgundy text-brand-cream border-brand-burgundy shadow-card'
                  : disabled
                    ? 'bg-brand-cream/40 text-brand-burgundy/35 border-brand-cream-dark cursor-not-allowed'
                    : 'bg-white text-brand-burgundy border-brand-cream-dark hover:border-brand-gold hover:bg-brand-cream/30'
              }`}
            >
              <span className="block font-medium">{meal.name}</span>
              {/* additive: תיוג דג משני/זול כדי שהלקוח יבין את החלוקה */}
              {isAdditive && meal.is_secondary && (
                <span className="block text-xs opacity-70 mt-0.5">דג נוסף (זול)</span>
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
  // דג יחיד מקבל 100% מהמנות; משנבחר דג נוסף, החלוקה לפי האחוזים.
  if (count < 2) {
    return (
      <div className="mx-3 mt-1 mb-1 rounded-lg bg-brand-cream/50 px-3 py-1.5 text-sm font-medium text-brand-burgundy/70">
        {`דג יחיד — יקבל את כל ${slotPortions} המנות. אפשר להוסיף דג נוסף (זול) לקבלת תוספת מנות.`}
      </div>
    );
  }
  const primary = Math.ceil((slotPortions * primaryPct) / 100);
  const secondary = Math.ceil((slotPortions * secondaryPct) / 100);
  return (
    <div className="mx-3 mt-1 mb-1 rounded-lg bg-brand-gold/20 px-3 py-1.5 text-sm font-medium text-brand-burgundy-dark">
      {`חלוקה אוטומטית: דג עיקרי ${primary} מנות (${primaryPct}%) · דג נוסף ${secondary} מנות (${secondaryPct}%) — סה"כ ${primary + secondary}`}
    </div>
  );
}
