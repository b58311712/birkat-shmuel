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

function selectedInGroup(group, mealSlotId, selectedMeals) {
  return group.meals.filter((meal) => selectedMeals[`${mealSlotId}:${meal.id}`]).length;
}

function isGroupComplete(group, selectedCount) {
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

export function MealCategoryPicker({ catalog, mealSlotId, selectedMeals, onToggleMeal }) {
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
  const activeComplete = isGroupComplete(activeGroup, activeSelectedCount);
  const maxAllowed = activeGroup.category?.max_allowed;
  const reachedLimit = maxAllowed != null && activeSelectedCount >= maxAllowed;

  return (
    <div className={`rounded-lg border bg-white overflow-hidden ${
      activeComplete ? 'border-green-300' : 'border-brand-cream-dark'
    }`}>
      <div className="flex gap-1.5 overflow-x-auto p-2 bg-brand-cream/35 border-b border-brand-cream-dark">
        {groups.map((group) => {
          const selectedCount = selectedInGroup(group, mealSlotId, selectedMeals);
          const isActive = group.id === activeGroup.id;
          const complete = isGroupComplete(group, selectedCount);
          const completedStyle = complete ? (isActive ? activeCompletedTabStyle : completedTabStyle) : undefined;

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
                className={`rounded-full px-2 py-0.5 text-xs ${
                  complete
                    ? ''
                    : isActive
                      ? 'bg-white/20 text-white'
                      : 'bg-brand-cream text-brand-burgundy/70'
                }`}
                style={complete ? {
                  backgroundColor: isActive ? 'rgba(255,255,255,0.2)' : '#dcfce7',
                  color: isActive ? '#ffffff' : '#14532d',
                } : undefined}
              >
                {shortLimitText(group.category, selectedCount)}
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-1.5 px-2 pb-2 pt-2">
        {activeGroup.meals.map((meal) => {
          const key = `${mealSlotId}:${meal.id}`;
          const selected = Boolean(selectedMeals[key]);
          const disabled = reachedLimit && !selected;

          return (
            <button
              key={key}
              type="button"
              onClick={() => onToggleMeal(mealSlotId, meal.id)}
              disabled={disabled}
              className={`relative min-h-10 rounded-lg border px-2.5 py-2 text-right text-sm leading-tight transition-colors ${
                selected
                  ? 'bg-brand-burgundy text-brand-cream border-brand-burgundy shadow-card'
                  : disabled
                    ? 'bg-brand-cream/40 text-brand-burgundy/35 border-brand-cream-dark cursor-not-allowed'
                    : 'bg-white text-brand-burgundy border-brand-cream-dark hover:border-brand-gold hover:bg-brand-cream/30'
              }`}
            >
              <span className="block font-medium">{meal.name}</span>
              {meal.requires_extra_charge && (
                <span className="block text-xs opacity-70 mt-0.5">+ {meal.extra_charge_amount}</span>
              )}
            </button>
          );
        })}
      </div>
    </div>
  );
}
