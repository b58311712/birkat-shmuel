import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { parseRecipe } from '../lib/recipeParser.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { DragHandle } from '../components/DragHandle.jsx';
import { ACTIVE_STATUS, Badge } from '../lib/status.jsx';

const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

// בסיסי נוסחת הכמות המוצעת לתוספת (סעיף 14.4). חייבים להתאים לערכים בשרת ובחישוב המחיר.
const SUGGESTION_BASES = [
  ['', 'ללא כמות מוצעת (ברירת מחדל 1)'],
  ['per_portion', 'לפי מספר המנות'],
  ['per_portion_per_slot', 'לפי מנות × סעודות'],
  ['fixed_per_order', 'כמות קבועה להזמנה'],
];
const suggestionBasisLabel = (basis) =>
  SUGGESTION_BASES.find(([v]) => v === (basis || ''))?.[1] || basis;

export default function AdminCatalog({ onAuthError, currentAdmin }) {
  const [view, setView] = useState('meals');
  const [mealSlots, setMealSlots] = useState([]);
  const [categories, setCategories] = useState([]);
  const canDelete = currentAdmin?.role === 'developer';

  const handleErr = useCallback((e) => {
    if (e.name === 'AdminAuthError') onAuthError?.();
    else alert(e.message);
  }, [onAuthError]);

  const loadRefs = useCallback(() => {
    Promise.all([
      api.catalogMealSlots('?active=true'),
      api.catalogCategories(''),
    ])
      .then(([slots, cats]) => {
        setMealSlots(slots || []);
        setCategories(cats || []);
      })
      .catch(handleErr);
  }, [handleErr]);

  useEffect(() => { loadRefs(); }, [loadRefs]);

  return (
    <Page title="ניהול מאכלים וקטגוריות" subtitle="קטלוג דינמי להזמנות, לפי סעודות, קטגוריות וכללי בחירה">
      <div className="flex gap-1 mb-5 border-b border-brand-cream-dark">
        {[
          ['meals', 'מאכלים'],
          ['categories', 'קטגוריות'],
          ['extras', 'תוספות בתשלום'],
          ['price-tracks', 'מחיר בסיס'],
        ].map(([key, label]) => (
          <button
            key={key}
            onClick={() => setView(key)}
            className={`px-4 py-2 font-medium border-b-2 -mb-px transition-colors ${
              view === key ? 'border-brand-gold text-brand-burgundy' : 'border-transparent text-brand-burgundy/50 hover:text-brand-burgundy'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {view === 'meals' && (
        <MealsManager
          categories={categories}
          mealSlots={mealSlots}
          onErr={handleErr}
          onChanged={loadRefs}
          canDelete={canDelete}
        />
      )}
      {view === 'categories' && (
        <CategoriesManager
          mealSlots={mealSlots}
          onErr={handleErr}
          onChanged={loadRefs}
          canDelete={canDelete}
        />
      )}
      {view === 'extras' && (
        <ExtrasManager onErr={handleErr} canDelete={canDelete} />
      )}
      {view === 'price-tracks' && (
        <PriceTracksManager mealSlots={mealSlots} onErr={handleErr} canDelete={canDelete} />
      )}
    </Page>
  );
}

function MealsManager({ categories, mealSlots, onErr, onChanged, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draggedMealId, setDraggedMealId] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [filter, setFilter] = useState({ active: 'true', category_id: '', search: '' });

  const activeCategories = useMemo(
    () => categories.filter((c) => c.is_active),
    [categories]
  );

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter.active) params.set('active', filter.active);
    if (filter.category_id) params.set('category_id', filter.category_id);
    if (filter.search.trim()) params.set('search', filter.search.trim());
    const q = params.toString();
    api.catalogMeals(q ? `?${q}` : '').then(setList).catch(onErr);
  }, [filter, onErr]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.invItems('?active=true').then((items) => setInventoryItems(items || [])).catch(onErr);
  }, [onErr]);

  async function save(form) {
    try {
      const { recipe_portions, recipe_lines, packing_rules, ...mealPayload } = form;
      const result = form.id
        ? await api.updateCatalogMeal(form.id, mealPayload)
        : await api.createCatalogMeal(mealPayload);
      const mealId = form.id || result?.meal?.id;
      if (mealId) {
        await api.setCatalogMealRecipe(mealId, {
          recipe_portions,
          lines: recipe_lines,
        });
        await api.setCatalogMealPacking(mealId, {
          rules: packing_rules,
        });
      }
      setEditing(null);
      load();
      onChanged?.();
    } catch (e) { onErr(e); }
  }

  async function toggleActive(meal) {
    try {
      await api.updateCatalogMeal(meal.id, { is_active: !meal.is_active });
      load();
    } catch (e) { onErr(e); }
  }

  async function deleteMeal(meal) {
    if (!confirm(`למחוק לצמיתות את ${meal.name}?`)) return;
    try {
      await api.deleteCatalogMeal(meal.id);
      load();
      onChanged?.();
    } catch (e) { onErr(e); }
  }

  const canReorder = filter.active === 'true' && !filter.category_id && !filter.search.trim();

  async function moveMeal(targetMealId) {
    if (!canReorder || savingOrder || !draggedMealId || draggedMealId === targetMealId) return;
    const previous = list;
    const fromIndex = previous.findIndex((meal) => meal.id === draggedMealId);
    const toIndex = previous.findIndex((meal) => meal.id === targetMealId);
    if (fromIndex < 0 || toIndex < 0) return;

    const reordered = [...previous];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const normalized = reordered.map((meal, index) => ({ ...meal, display_order: index + 1 }));

    setList(normalized);
    setDraggedMealId(null);
    setSavingOrder(true);
    try {
      await Promise.all(normalized.map((meal) =>
        api.updateCatalogMeal(meal.id, { display_order: meal.display_order })));
    } catch (e) {
      setList(previous);
      onErr(e);
    } finally {
      setSavingOrder(false);
    }
  }

  if (!list) return <p>טוען...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ מאכל חדש</button>
        <Field label="חיפוש">
          <input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            className={inputCls}
            placeholder="שם מאכל או הערה"
          />
        </Field>
        <Field label="קטגוריה">
          <select
            value={filter.category_id}
            onChange={(e) => setFilter((f) => ({ ...f, category_id: e.target.value }))}
            className={inputCls}
          >
            <option value="">הכל</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="סטטוס">
          <select
            value={filter.active}
            onChange={(e) => setFilter((f) => ({ ...f, active: e.target.value }))}
            className={inputCls}
          >
            <option value="true">פעילים</option>
            <option value="false">לא פעילים</option>
            <option value="">הכל</option>
          </select>
        </Field>
        <span className="pb-2 text-xs text-brand-burgundy/55">
          {savingOrder
            ? 'שומר את סדר המאכלים...'
            : canReorder
              ? 'אפשר לגרור שורות כדי לקבוע את הסדר בממשק ההזמנות'
              : 'כדי לשנות סדר יש לנקות חיפוש ומסננים ולהציג מאכלים פעילים'}
        </span>
      </div>

      {/* מאכל חדש נפתח מעל הטבלה (אין לו שורה מתאימה); עריכת מאכל קיים נפתחת
          צמוד לשורה הנערכת כשורת-טבלה מורחבת (ראה בגוף ה-tbody למטה). */}
      {editing && !editing.id && (
        <MealForm
          initial={editing}
          categories={activeCategories}
          mealSlots={mealSlots}
          inventoryItems={inventoryItems}
          onInventoryItemCreated={(item) =>
            setInventoryItems((items) =>
              [...items, item].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he')))}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right w-16">סדר</th>
              <th className="p-3 text-right">מאכל</th>
              <th className="p-3 text-right">קטגוריה</th>
              <th className="p-3 text-right">זמין בסעודות</th>
              <th className="p-3 text-right">מחיר</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((meal) => (
              <Fragment key={meal.id}>
                <tr
                  draggable={canReorder && !savingOrder && editing?.id !== meal.id}
                  onDragStart={(e) => {
                    setDraggedMealId(meal.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', meal.id);
                  }}
                  onDragOver={(e) => {
                    if (canReorder && draggedMealId && draggedMealId !== meal.id) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    moveMeal(meal.id);
                  }}
                  onDragEnd={() => setDraggedMealId(null)}
                  className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${canReorder ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedMealId === meal.id ? 'opacity-40' : ''} ${!meal.is_active ? 'opacity-50' : ''} ${editing?.id === meal.id ? 'bg-brand-cream/40' : ''}`}
                >
                  <td className="p-3 text-brand-burgundy/45" title="גרירה לשינוי סדר">
                    <DragHandle label={`גרירת ${meal.name}`} />
                  </td>
                  <td className="p-3">
                    <div className="font-medium">{meal.name}</div>
                    {(meal.kitchen_prep_notes || meal.kitchen_report_notes) && (
                      <div className="text-xs text-brand-burgundy/50 mt-0.5">
                        {meal.kitchen_prep_notes || meal.kitchen_report_notes}
                      </div>
                    )}
                  </td>
                  <td className="p-3 text-sm">{meal.category?.name || 'ללא קטגוריה'}</td>
                  <td className="p-3 text-sm">{slotNames(meal.available_slot_ids, mealSlots)}</td>
                  <td className="p-3 text-sm">
                    {meal.requires_extra_charge ? `תוספת ₪${fmt(meal.extra_charge_amount)}` : (meal.included_in_base ? 'כלול בבסיס' : 'לא כלול')}
                  </td>
                  <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={meal.is_active ? 'active' : 'inactive'} /></td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                    <ActionIconButton
                      icon={editing?.id === meal.id ? 'cancel' : 'edit'}
                      label={editing?.id === meal.id ? 'סגירה' : 'עריכה'}
                      onClick={() => setEditing(editing?.id === meal.id ? null : meal)}
                    />
                    <ActionIconButton
                      icon={meal.is_active ? 'deactivate' : 'activate'}
                      label={meal.is_active ? 'השבתה' : 'הפעלה'}
                      tone="muted"
                      onClick={() => toggleActive(meal)}
                    />
                    {canDelete && (
                      <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteMeal(meal)} />
                    )}
                    </div>
                  </td>
                </tr>
                {editing?.id === meal.id && (
                  <tr>
                    <td colSpan={7} className="p-3 bg-brand-cream/20">
                      <MealForm
                        initial={editing}
                        categories={categories}
                        mealSlots={mealSlots}
                        inventoryItems={inventoryItems}
                        onInventoryItemCreated={(item) =>
                          setInventoryItems((items) =>
                            [...items, item].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he')))}
                        onSave={save}
                        onCancel={() => setEditing(null)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-brand-burgundy/50">אין מאכלים להצגה.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function MealForm({ initial, categories, mealSlots, inventoryItems, onInventoryItemCreated, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    category_id: initial.category_id || '',
    included_in_base: initial.included_in_base ?? true,
    is_secondary: initial.is_secondary || false,
    requires_extra_charge: initial.requires_extra_charge || false,
    extra_charge_amount: initial.extra_charge_amount ?? '',
    kitchen_prep_notes: initial.kitchen_prep_notes || '',
    kitchen_report_notes: initial.kitchen_report_notes || '',
    preparation_instructions: initial.preparation_instructions || '',
    display_order: initial.display_order ?? 0,
    available_slot_ids: initial.available_slot_ids || [],
  });
  const [recipePortions, setRecipePortions] = useState(1);
  const [recipeLines, setRecipeLines] = useState([]);
  const [recipeLoading, setRecipeLoading] = useState(!!initial.id);
  const [packingRules, setPackingRules] = useState([]);
  const [packingLoading, setPackingLoading] = useState(!!initial.id);

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleSlot = (id) => {
    set('available_slot_ids', f.available_slot_ids.includes(id)
      ? f.available_slot_ids.filter((x) => x !== id)
      : [...f.available_slot_ids, id]);
  };
  // דגל דג משני רלוונטי רק כשקטגוריית המאכל במצב חלוקה אוטומטית (additive).
  const selectedCategory = categories.find((c) => c.id === f.category_id);
  const selectedCategoryIsAdditive = (selectedCategory?.split_mode
    || (selectedCategory?.requires_portion_split ? 'equal' : 'none')) === 'additive';

  useEffect(() => {
    let alive = true;
    if (!initial.id) {
      setRecipeLoading(false);
      setPackingLoading(false);
      return () => { alive = false; };
    }

    setRecipeLoading(true);
    api.catalogMealRecipe(initial.id)
      .then((recipe) => {
        if (!alive) return;
        // השרת מחזיר { recipe_portions, lines } כאשר lines כוללות quantity_for_recipe
        // כבר משוחזרת למתכון השלם (כמות-למנה × מספר-המנות-המקורי).
        const lines = recipe?.lines || [];
        setRecipePortions(recipe?.recipe_portions || 1);
        setRecipeLines(lines.map((line) => ({
          id: line.id,
          inventory_item_id: line.inventory_item_id || '',
          ingredient_name: line.ingredient_name || '',
          quantity_for_recipe: line.quantity_for_recipe ?? line.quantity_per_portion ?? '',
          unit: line.unit || '',
          notes: line.notes || '',
        })));
      })
      .catch((e) => alert(e.message))
      .finally(() => { if (alive) setRecipeLoading(false); });

    setPackingLoading(true);
    api.catalogMealPacking(initial.id)
      .then((packing) => {
        if (!alive) return;
        const rules = packing?.rules || [];
        setPackingRules(rules.map((r) => ({
          id: r.id,
          packaging_item_id: r.packaging_item_id || '',
          packaging_label: r.packaging_label || '',
          portions_per_package: r.portions_per_package ?? '',
          notes: r.notes || '',
        })));
      })
      .catch((e) => alert(e.message))
      .finally(() => { if (alive) setPackingLoading(false); });

    return () => { alive = false; };
  }, [initial.id]);

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם מאכל.');
    if (!f.category_id) return alert('חובה לבחור קטגוריה.');
    if (f.requires_extra_charge && f.extra_charge_amount === '') return alert('יש להזין מחיר תוספת.');
    const portions = Number(recipePortions);
    if (!Number.isFinite(portions) || portions <= 0) return alert('מספר המנות במתכון חייב להיות גדול מאפס.');
    onSave({
      ...f,
      name: f.name.trim(),
      display_order: Number(f.display_order) || 0,
      extra_charge_amount: f.requires_extra_charge ? Number(f.extra_charge_amount) : null,
      recipe_portions: portions,
      recipe_lines: recipeLines,
      packing_rules: packingRules,
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת מאכל' : 'מאכל חדש'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם מאכל *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="קטגוריה *">
          <select value={f.category_id} onChange={(e) => set('category_id', e.target.value)} className={inputCls}>
            <option value="">בחר קטגוריה</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>
        <Field label="מחיר">
          <div className="flex flex-wrap gap-3 p-2 border border-brand-cream-dark rounded-lg">
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.included_in_base} onChange={(e) => set('included_in_base', e.target.checked)} />
              כלול במחיר הבסיס
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f.requires_extra_charge} onChange={(e) => set('requires_extra_charge', e.target.checked)} />
              דורש תוספת מחיר
            </label>
          </div>
        </Field>
        {f.requires_extra_charge && (
          <Field label="סכום תוספת (₪)">
            <input
              type="number"
              step="0.01"
              min="0"
              value={f.extra_charge_amount}
              onChange={(e) => set('extra_charge_amount', e.target.value)}
              className={inputCls}
              dir="ltr"
            />
          </Field>
        )}
        {selectedCategoryIsAdditive && (
          <Field label="סוג הדג בחלוקה האוטומטית">
            <label className="flex items-start gap-2 text-sm p-2 border border-brand-cream-dark rounded-lg">
              <input type="checkbox" checked={f.is_secondary}
                onChange={(e) => set('is_secondary', e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium text-brand-burgundy">דג משני / זול</span>
                <span className="block text-xs text-brand-burgundy/60">
                  מסומן = דג נוסף זול (מקבל את אחוז התוספת). לא מסומן = דג עיקרי/יקר (מקבל את האחוז העיקרי).
                </span>
              </span>
            </label>
          </Field>
        )}
      </div>

      <Field label="זמין בסעודות">
        <CheckboxGrid
          options={mealSlots}
          selected={f.available_slot_ids}
          onToggle={toggleSlot}
          emptyText="אין סעודות פעילות."
        />
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="הערות הכנה פנימיות">
          <textarea value={f.kitchen_prep_notes} onChange={(e) => set('kitchen_prep_notes', e.target.value)} className={inputCls} rows={2} />
        </Field>
        <Field label="הערות לדוח מטבח">
          <textarea value={f.kitchen_report_notes} onChange={(e) => set('kitchen_report_notes', e.target.value)} className={inputCls} rows={2} />
        </Field>
      </div>

      <RecipeEditor
        loading={recipeLoading}
        portions={recipePortions}
        onPortionsChange={setRecipePortions}
        lines={recipeLines}
        onLinesChange={setRecipeLines}
        instructions={f.preparation_instructions}
        onInstructionsChange={(v) => set('preparation_instructions', v)}
        inventoryItems={inventoryItems}
        onInventoryItemCreated={onInventoryItemCreated}
      />

      <PackingEditor
        loading={packingLoading}
        rules={packingRules}
        onRulesChange={setPackingRules}
        inventoryItems={inventoryItems}
        onInventoryItemCreated={onInventoryItemCreated}
      />

      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

function RecipeEditor({ loading, portions, onPortionsChange, lines, onLinesChange, instructions, onInstructionsChange, inventoryItems, onInventoryItemCreated }) {
  const [pasteText, setPasteText] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [creatingIdx, setCreatingIdx] = useState(null);

  // יצירה מהירה של פריט מלאי חדש משורת המתכון (שם + יחידה), וקישור השורה אליו.
  const createInventoryItem = async (idx) => {
    const line = lines[idx];
    const name = String(line.ingredient_name || '').trim();
    const unit = String(line.unit || '').trim();
    if (!name) return alert('יש להזין שם רכיב לפני יצירת פריט מלאי.');
    if (!unit) return alert('יש להזין יחידת מידה לפני יצירת פריט מלאי.');

    const existing = inventoryItems.find((it) => (it.name || '').trim() === name);
    if (existing) {
      updateLine(idx, { inventory_item_id: existing.id, unit: existing.unit || unit });
      return alert(`הפריט "${name}" כבר קיים במלאי — השורה קושרה אליו.`);
    }

    setCreatingIdx(idx);
    try {
      const res = await api.createInvItem({ name, unit });
      const item = res?.item;
      if (item) {
        onInventoryItemCreated?.(item);
        updateLine(idx, { inventory_item_id: item.id, ingredient_name: item.name, unit: item.unit });
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setCreatingIdx(null);
    }
  };

  // ניסיון להתאים כל רכיב שנותח לפריט מלאי קיים לפי שם (התאמה מדויקת, מנוקה).
  const matchInventoryId = (name) => {
    const clean = String(name || '').trim();
    if (!clean) return '';
    const hit = inventoryItems.find((it) => (it.name || '').trim() === clean);
    return hit?.id || '';
  };

  const applyPaste = ({ replace }) => {
    const parsed = parseRecipe(pasteText);
    if (!parsed.lines.length && !parsed.instructions.trim()) {
      return alert('לא זוהו רכיבים או אופן הכנה בטקסט שהודבק. ודאי שכל רכיב בשורה נפרדת ומתחיל בכמות.');
    }

    const newLines = parsed.lines.map((l) => {
      const inventory_item_id = matchInventoryId(l.ingredient_name);
      return {
        inventory_item_id,
        ingredient_name: l.ingredient_name,
        quantity_for_recipe: l.quantity_for_recipe,
        unit: l.unit,
        notes: l.notes || '',
      };
    });

    onLinesChange(replace ? newLines : [...lines, ...newLines]);
    if (parsed.portions && parsed.portions !== 1) onPortionsChange(parsed.portions);
    if (parsed.instructions.trim()) {
      const prev = String(instructions || '').trim();
      onInstructionsChange(replace || !prev ? parsed.instructions : `${prev}\n${parsed.instructions}`);
    }
    setPasteText('');
    setPasteOpen(false);
  };

  const updateLine = (idx, patch) => {
    onLinesChange(lines.map((line, i) => (i === idx ? { ...line, ...patch } : line)));
  };

  const addLine = () => {
    onLinesChange([
      ...lines,
      { inventory_item_id: '', ingredient_name: '', quantity_for_recipe: '', unit: '', notes: '' },
    ]);
  };

  const removeLine = (idx) => {
    onLinesChange(lines.filter((_, i) => i !== idx));
  };

  const chooseItem = (idx, itemId) => {
    const item = inventoryItems.find((it) => it.id === itemId);
    updateLine(idx, {
      inventory_item_id: itemId,
      ingredient_name: item?.name || lines[idx].ingredient_name,
      unit: item?.unit || lines[idx].unit,
    });
  };

  const perPortion = (quantity) => {
    const total = Number(quantity);
    const count = Number(portions);
    if (!Number.isFinite(total) || !Number.isFinite(count) || count <= 0) return '';
    return fmt(total / count);
  };

  return (
    <section className="border border-brand-cream-dark rounded-lg p-3 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="font-bold text-brand-burgundy">מתכון וחישוב כמויות</h4>
          <p className="text-xs text-brand-burgundy/50 mt-1">
            הזיני את הכמויות למתכון כולו, והמערכת תשמור את הכמות המחושבת למנה אחת.
          </p>
        </div>
        <div className="flex items-end">
          <button
            type="button"
            onClick={() => setPasteOpen((v) => !v)}
            className="btn-ghost text-sm"
          >
            {pasteOpen ? 'סגירת הדבקה' : '📋 הדבקת מתכון'}
          </button>
        </div>
        <Field label="המתכון מספיק ל־מנות">
          <input
            type="number"
            min="1"
            step="1"
            value={portions}
            onChange={(e) => onPortionsChange(e.target.value)}
            className={`${inputCls} w-32`}
            dir="ltr"
          />
        </Field>
      </div>

      {pasteOpen && (
        <div className="border border-brand-gold/40 bg-brand-cream/40 rounded-lg p-3 space-y-2">
          <p className="text-xs text-brand-burgundy/60">
            הדביקי כאן את המתכון כפי שהוא (כל רכיב בשורה נפרדת המתחילה בכמות, ולאחריהם כותרת "אופן ההכנה").
            המערכת תפרק אוטומטית לרכיבים, כמויות ואופן הכנה. רכיבים בשמות מדויקים יקושרו לפריטי מלאי.
          </p>
          <textarea
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            className={inputCls}
            rows={8}
            placeholder={'3 ק"ג מלפפון רגיל\n1/2 ק"ג בצל לבן\n...\n\nאופן ההכנה:\nחובה לשטוף היטב...'}
          />
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => applyPaste({ replace: true })}
              disabled={!pasteText.trim()}
              className="btn-primary text-sm disabled:opacity-40"
            >
              נתחי והחליפי מתכון
            </button>
            <button
              type="button"
              onClick={() => applyPaste({ replace: false })}
              disabled={!pasteText.trim()}
              className="btn-ghost text-sm disabled:opacity-40"
            >
              הוספה לרכיבים הקיימים
            </button>
          </div>
        </div>
      )}

      {loading ? (
        <p className="text-sm text-brand-burgundy/50">טוען מתכון...</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-brand-burgundy/70">
                <tr className="border-b border-brand-cream-dark">
                  <th className="p-2 text-right min-w-44">פריט מלאי</th>
                  <th className="p-2 text-right min-w-40">שם רכיב *</th>
                  <th className="p-2 text-right min-w-28">כמות למתכון *</th>
                  <th className="p-2 text-right min-w-24">יחידה *</th>
                  <th className="p-2 text-right min-w-24">למנה אחת</th>
                  <th className="p-2 text-right min-w-36">הערה</th>
                  <th className="p-2 text-right w-16"></th>
                </tr>
              </thead>
              <tbody>
                {lines.map((line, idx) => (
                  <tr key={line.id || idx} className="border-b border-brand-cream-dark/70 align-top">
                    <td className="p-2">
                      <select
                        value={line.inventory_item_id}
                        onChange={(e) => chooseItem(idx, e.target.value)}
                        className={inputCls}
                      >
                        <option value="">ללא קישור</option>
                        {inventoryItems.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                      {!line.inventory_item_id && line.ingredient_name?.trim() && (
                        <button
                          type="button"
                          onClick={() => createInventoryItem(idx)}
                          disabled={creatingIdx === idx}
                          className="text-xs text-brand-burgundy hover:underline mt-1 disabled:opacity-50"
                        >
                          {creatingIdx === idx ? 'יוצר...' : '➕ צור פריט מלאי חדש'}
                        </button>
                      )}
                    </td>
                    <td className="p-2">
                      <input
                        value={line.ingredient_name}
                        onChange={(e) => updateLine(idx, { ingredient_name: e.target.value })}
                        className={inputCls}
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={line.quantity_for_recipe}
                        onChange={(e) => updateLine(idx, { quantity_for_recipe: e.target.value })}
                        className={inputCls}
                        dir="ltr"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={line.unit}
                        onChange={(e) => updateLine(idx, { unit: e.target.value })}
                        className={inputCls}
                      />
                    </td>
                    <td className="p-2 text-brand-burgundy/70 whitespace-nowrap">
                      {perPortion(line.quantity_for_recipe)} {line.unit}
                    </td>
                    <td className="p-2">
                      <input
                        value={line.notes}
                        onChange={(e) => updateLine(idx, { notes: e.target.value })}
                        className={inputCls}
                      />
                    </td>
                    <td className="p-2">
                      <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => removeLine(idx)} />
                    </td>
                  </tr>
                ))}
                {lines.length === 0 && (
                  <tr>
                    <td colSpan={7} className="p-3 text-center text-brand-burgundy/50">
                      אין רכיבים במתכון.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <button type="button" onClick={addLine} className="btn-ghost">+ רכיב</button>
        </>
      )}

      <Field label="אופן ההכנה">
        <textarea
          value={instructions || ''}
          onChange={(e) => onInstructionsChange(e.target.value)}
          className={inputCls}
          rows={6}
          placeholder="הוראות ההכנה שלב-אחר-שלב..."
        />
      </Field>
    </section>
  );
}

// עורך כללי אריזה למאכל (סעיף 22): לכל שורה — אריזה (מפריטי המלאי המסומנים "אריזה")
// וכמה מנות נכנסות באריזה אחת. תיק השבת גוזר מזה כמה אריזות צריך לפי מספר המנות.
function PackingEditor({ loading, rules, onRulesChange, inventoryItems, onInventoryItemCreated }) {
  const [creatingIdx, setCreatingIdx] = useState(null);
  const packagingItems = useMemo(
    () => (inventoryItems || []).filter((it) => it.is_packaging),
    [inventoryItems],
  );

  const updateRule = (idx, patch) => {
    onRulesChange(rules.map((rule, i) => (i === idx ? { ...rule, ...patch } : rule)));
  };

  const addRule = () => {
    onRulesChange([
      ...rules,
      { packaging_item_id: '', packaging_label: '', portions_per_package: '', notes: '' },
    ]);
  };

  const removeRule = (idx) => {
    onRulesChange(rules.filter((_, i) => i !== idx));
  };

  // בחירת פריט אריזה משלימה אוטומטית את תיאור האריזה משם הפריט (אם עוד ריק).
  const chooseItem = (idx, itemId) => {
    const item = packagingItems.find((it) => it.id === itemId);
    updateRule(idx, {
      packaging_item_id: itemId,
      packaging_label: rules[idx].packaging_label?.trim() ? rules[idx].packaging_label : (item?.name || ''),
    });
  };

  // יצירה מהירה של פריט אריזה חדש במלאי מתוך שורת האריזה (שם = תיאור האריזה,
  // מסומן is_packaging), וקישור השורה אליו — בלי לצאת למסך המלאי.
  const createPackagingItem = async (idx) => {
    const name = String(rules[idx].packaging_label || '').trim();
    if (!name) return alert('יש להזין תיאור אריזה לפני יצירת פריט מלאי.');

    // אם כבר קיים פריט מלאי בשם הזה — קושרים אליו במקום ליצור כפילות.
    const existing = (inventoryItems || []).find((it) => (it.name || '').trim() === name);
    if (existing) {
      updateRule(idx, { packaging_item_id: existing.id });
      return alert(`הפריט "${name}" כבר קיים במלאי — השורה קושרה אליו.`);
    }

    setCreatingIdx(idx);
    try {
      const res = await api.createInvItem({ name, unit: 'יחידה', is_packaging: true });
      const item = res?.item;
      if (item) {
        onInventoryItemCreated?.(item);
        updateRule(idx, { packaging_item_id: item.id });
      }
    } catch (e) {
      alert(e.message);
    } finally {
      setCreatingIdx(null);
    }
  };

  return (
    <section className="border border-brand-cream-dark rounded-lg p-3 space-y-3">
      <div>
        <h4 className="font-bold text-brand-burgundy">אריזה</h4>
        <p className="text-xs text-brand-burgundy/50 mt-1">
          לכל סוג אריזה — כמה מנות נכנסות באריזה אחת. בתיק השבת המערכת תחשב כמה אריזות צריך לפי מספר המנות.
          האריזות נבחרות מפריטי המלאי המסומנים כ"אריזה".
        </p>
      </div>

      {loading ? (
        <p className="text-sm text-brand-burgundy/50">טוען אריזות...</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-brand-burgundy/70">
                <tr className="border-b border-brand-cream-dark">
                  <th className="p-2 text-right min-w-44">אריזה (פריט מלאי)</th>
                  <th className="p-2 text-right min-w-40">תיאור אריזה *</th>
                  <th className="p-2 text-right min-w-32">מנות באריזה *</th>
                  <th className="p-2 text-right min-w-36">הערה</th>
                  <th className="p-2 text-right w-16"></th>
                </tr>
              </thead>
              <tbody>
                {rules.map((rule, idx) => (
                  <tr key={rule.id || idx} className="border-b border-brand-cream-dark/70 align-top">
                    <td className="p-2">
                      <select
                        value={rule.packaging_item_id}
                        onChange={(e) => chooseItem(idx, e.target.value)}
                        className={inputCls}
                      >
                        <option value="">ללא קישור למלאי</option>
                        {packagingItems.map((item) => (
                          <option key={item.id} value={item.id}>{item.name}</option>
                        ))}
                      </select>
                      {!rule.packaging_item_id && rule.packaging_label?.trim() && (
                        <button
                          type="button"
                          onClick={() => createPackagingItem(idx)}
                          disabled={creatingIdx === idx}
                          className="text-xs text-brand-burgundy hover:underline mt-1 disabled:opacity-50"
                        >
                          {creatingIdx === idx ? 'יוצר...' : '➕ צור פריט אריזה במלאי'}
                        </button>
                      )}
                    </td>
                    <td className="p-2">
                      <input
                        value={rule.packaging_label}
                        onChange={(e) => updateRule(idx, { packaging_label: e.target.value })}
                        className={inputCls}
                        placeholder='קופסה 4 ליטר'
                      />
                    </td>
                    <td className="p-2">
                      <input
                        type="number"
                        min="0"
                        step="0.0001"
                        value={rule.portions_per_package}
                        onChange={(e) => updateRule(idx, { portions_per_package: e.target.value })}
                        className={inputCls}
                        dir="ltr"
                      />
                    </td>
                    <td className="p-2">
                      <input
                        value={rule.notes}
                        onChange={(e) => updateRule(idx, { notes: e.target.value })}
                        className={inputCls}
                      />
                    </td>
                    <td className="p-2">
                      <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => removeRule(idx)} />
                    </td>
                  </tr>
                ))}
                {rules.length === 0 && (
                  <tr>
                    <td colSpan={5} className="p-3 text-center text-brand-burgundy/50">
                      לא הוגדרו אריזות למאכל.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {packagingItems.length === 0 && (
            <p className="text-xs text-brand-burgundy/50">
              אין עדיין פריטי מלאי המסומנים כ"אריזה". הזיני תיאור אריזה בשורה,
              ולחצי "➕ צור פריט אריזה במלאי" כדי להוסיף אותו למלאי ולקשר — או השאירי ללא קישור למלאי.
            </p>
          )}
          <button type="button" onClick={addRule} className="btn-ghost">+ אריזה</button>
        </>
      )}
    </section>
  );
}

function CategoriesManager({ mealSlots, onErr, onChanged, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draggedCategoryId, setDraggedCategoryId] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [filter, setFilter] = useState({ active: 'true', search: '' });

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter.active) params.set('active', filter.active);
    if (filter.search.trim()) params.set('search', filter.search.trim());
    const q = params.toString();
    api.catalogCategories(q ? `?${q}` : '').then(setList).catch(onErr);
  }, [filter, onErr]);

  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateCatalogCategory(form.id, form);
      else {
        const lastOrder = Math.max(0, ...(list || []).map((category) => Number(category.display_order) || 0));
        await api.createCatalogCategory({ ...form, display_order: lastOrder + 1 });
      }
      setEditing(null);
      load();
      onChanged?.();
    } catch (e) { onErr(e); }
  }

  async function toggleActive(category) {
    try {
      await api.updateCatalogCategory(category.id, { is_active: !category.is_active });
      load();
      onChanged?.();
    } catch (e) { onErr(e); }
  }

  async function deleteCategory(category) {
    if (!confirm(`למחוק לצמיתות את הקטגוריה ${category.name}?`)) return;
    try {
      await api.deleteCatalogCategory(category.id);
      load();
      onChanged?.();
    } catch (e) { onErr(e); }
  }

  const canReorder = filter.active === 'true' && !filter.search.trim();

  async function moveCategory(targetCategoryId) {
    if (!canReorder || savingOrder || !draggedCategoryId || draggedCategoryId === targetCategoryId) return;
    const previous = list;
    const fromIndex = previous.findIndex((category) => category.id === draggedCategoryId);
    const toIndex = previous.findIndex((category) => category.id === targetCategoryId);
    if (fromIndex < 0 || toIndex < 0) return;

    const reordered = [...previous];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const normalized = reordered.map((category, index) => ({ ...category, display_order: index + 1 }));

    setList(normalized);
    setDraggedCategoryId(null);
    setSavingOrder(true);
    try {
      await Promise.all(normalized.map((category) =>
        api.updateCatalogCategory(category.id, { display_order: category.display_order })));
      onChanged?.();
    } catch (e) {
      setList(previous);
      onErr(e);
    } finally {
      setSavingOrder(false);
    }
  }

  if (!list) return <p>טוען...</p>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ קטגוריה חדשה</button>
        <Field label="חיפוש">
          <input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            className={inputCls}
            placeholder="שם או תיאור פנימי"
          />
        </Field>
        <Field label="סטטוס">
          <select
            value={filter.active}
            onChange={(e) => setFilter((f) => ({ ...f, active: e.target.value }))}
            className={inputCls}
          >
            <option value="true">פעילות</option>
            <option value="false">לא פעילות</option>
            <option value="">הכל</option>
          </select>
        </Field>
        <span className="pb-2 text-xs text-brand-burgundy/55">
          {savingOrder
            ? 'שומר את סדר הקטגוריות...'
            : canReorder
              ? 'אפשר לגרור שורות כדי לקבוע את הסדר בממשק ההזמנות'
              : 'כדי לשנות סדר יש לנקות את החיפוש ולהציג קטגוריות פעילות'}
        </span>
      </div>

      {editing && !editing.id && (
        <CategoryForm
          initial={editing}
          mealSlots={mealSlots}
          onSave={save}
          onCancel={() => setEditing(null)}
        />
      )}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right w-16">סדר</th>
              <th className="p-3 text-right">קטגוריה</th>
              <th className="p-3 text-right">סעודות</th>
              <th className="p-3 text-right">כללי בחירה</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((category) => (
              <Fragment key={category.id}>
              <tr
                draggable={canReorder && !savingOrder && editing?.id !== category.id}
                onDragStart={(e) => {
                  setDraggedCategoryId(category.id);
                  e.dataTransfer.effectAllowed = 'move';
                  e.dataTransfer.setData('text/plain', category.id);
                }}
                onDragOver={(e) => {
                  if (canReorder && draggedCategoryId && draggedCategoryId !== category.id) {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  moveCategory(category.id);
                }}
                onDragEnd={() => setDraggedCategoryId(null)}
                className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${canReorder ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedCategoryId === category.id ? 'opacity-40' : ''} ${!category.is_active ? 'opacity-50' : ''}`}
              >
                <td className="p-3 text-brand-burgundy/45" title="גרירה לשינוי סדר">
                  <DragHandle label={`גרירת ${category.name}`} />
                </td>
                <td className="p-3">
                  <div className="font-medium">{category.name}</div>
                  {category.internal_description && (
                    <div className="text-xs text-brand-burgundy/50 mt-0.5">{category.internal_description}</div>
                  )}
                </td>
                <td className="p-3 text-sm">{slotNames(category.meal_slot_ids, mealSlots)}</td>
                <td className="p-3 text-sm">
                  {category.recommended_min != null || category.max_allowed != null
                    ? `מומלץ: ${category.recommended_min ?? '-'} | מקסימום: ${category.max_allowed ?? '-'}`
                    : 'ללא כלל'}
                </td>
                <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={category.is_active ? 'active_female' : 'inactive_female'} /></td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <div className="flex flex-wrap gap-1">
                  <ActionIconButton icon={editing?.id === category.id ? 'cancel' : 'edit'} label={editing?.id === category.id ? 'סגירה' : 'עריכה'} onClick={() => setEditing(editing?.id === category.id ? null : category)} />
                  <ActionIconButton
                    icon={category.is_active ? 'deactivate' : 'activate'}
                    label={category.is_active ? 'השבתה' : 'הפעלה'}
                    tone="muted"
                    onClick={() => toggleActive(category)}
                  />
                  {canDelete && (
                    <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteCategory(category)} />
                  )}
                  </div>
                </td>
              </tr>
              {editing?.id === category.id && (
                <tr className="border-b border-brand-cream-dark bg-brand-cream/20">
                  <td colSpan={6} className="p-3 sm:p-4">
                    <CategoryForm initial={editing} mealSlots={mealSlots} onSave={save} onCancel={() => setEditing(null)} />
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-brand-burgundy/50">אין קטגוריות להצגה.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CategoryForm({ initial, mealSlots, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    internal_description: initial.internal_description || '',
    display_order: initial.display_order ?? 0,
    recommended_min: initial.recommended_min ?? '',
    max_allowed: initial.max_allowed ?? '',
    // תאימות-לאחור: קטגוריה ישנה עם requires_portion_split בלבד נחשבת 'equal'.
    split_mode: initial.split_mode || (initial.requires_portion_split ? 'equal' : 'none'),
    primary_percent: initial.primary_percent ?? 80,
    secondary_percent: initial.secondary_percent ?? 50,
    meal_slot_ids: initial.meal_slot_ids || [],
  });

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleSlot = (id) => {
    set('meal_slot_ids', f.meal_slot_ids.includes(id)
      ? f.meal_slot_ids.filter((x) => x !== id)
      : [...f.meal_slot_ids, id]);
  };

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם קטגוריה.');
    if (f.split_mode === 'additive') {
      for (const [v, label] of [[f.primary_percent, 'אחוז הדג העיקרי'], [f.secondary_percent, 'אחוז הדג המשני']]) {
        if (v === '' || Number(v) < 1 || Number(v) > 100) return alert(`${label} חייב להיות בין 1 ל-100.`);
      }
    }
    onSave({
      ...f,
      name: f.name.trim(),
      display_order: Number(f.display_order) || 0,
      recommended_min: f.recommended_min === '' ? null : Number(f.recommended_min),
      max_allowed: f.max_allowed === '' ? null : Number(f.max_allowed),
      split_mode: f.split_mode,
      primary_percent: Number(f.primary_percent) || 80,
      secondary_percent: Number(f.secondary_percent) || 50,
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם קטגוריה *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="מינימום מומלץ">
          <input type="number" min="0" value={f.recommended_min} onChange={(e) => set('recommended_min', e.target.value)} className={inputCls} dir="ltr" placeholder="ללא" />
        </Field>
        <Field label="מקסימום מותר">
          <input type="number" min="0" value={f.max_allowed} onChange={(e) => set('max_allowed', e.target.value)} className={inputCls} dir="ltr" placeholder="ללא" />
        </Field>
      </div>
      <Field label="תיאור פנימי">
        <textarea value={f.internal_description} onChange={(e) => set('internal_description', e.target.value)} className={inputCls} rows={2} />
      </Field>
      <Field label="חלוקת מנות בין המאכלים">
        <select value={f.split_mode} onChange={(e) => set('split_mode', e.target.value)} className={inputCls}>
          <option value="none">ללא — כל מאכל שנבחר מקבל את כל מנות הסעודה</option>
          <option value="equal">חלוקה ידנית — הלקוח מזין כמות לכל מאכל, סך = מנות הסעודה (למשל מנה עיקרית)</option>
          <option value="additive">חלוקה אוטומטית — דג עיקרי + תוספת דג משני זול (דגים)</option>
        </select>
        {f.split_mode === 'additive' && (
          <div className="mt-2 grid grid-cols-2 gap-3">
            <Field label="אחוז לדג העיקרי (יקר)">
              <input type="number" min="1" max="100" value={f.primary_percent}
                onChange={(e) => set('primary_percent', e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <Field label="אחוז (תוספת) לדג המשני (זול)">
              <input type="number" min="1" max="100" value={f.secondary_percent}
                onChange={(e) => set('secondary_percent', e.target.value)} className={inputCls} dir="ltr" />
            </Field>
            <p className="col-span-2 text-xs text-brand-burgundy/60">
              דג יחיד מקבל 100% מהמנות. משנבחר גם דג משני — היקר מקבל את אחוז הדג העיקרי והזול תוספת של אחוז הדג המשני
              (למשל 100 מנות ← 80 + 50 = 130). לא ניתן לבחור שני דגים עיקריים.
            </p>
          </div>
        )}
      </Field>
      <Field label="קטגוריה רלוונטית לסעודות">
        <CheckboxGrid
          options={mealSlots}
          selected={f.meal_slot_ids}
          onToggle={toggleSlot}
          emptyText="אין סעודות פעילות."
        />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

function ExtrasManager({ onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [draggedExtraId, setDraggedExtraId] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [filter, setFilter] = useState({ active: 'true', search: '' });

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter.active) params.set('active', filter.active);
    if (filter.search.trim()) params.set('search', filter.search.trim());
    const q = params.toString();
    api.catalogExtras(q ? `?${q}` : '').then(setList).catch(onErr);
  }, [filter, onErr]);

  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateCatalogExtra(form.id, form);
      else {
        const lastOrder = Math.max(0, ...(list || []).map((extra) => Number(extra.display_order) || 0));
        await api.createCatalogExtra({ ...form, display_order: lastOrder + 1 });
      }
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function toggleActive(extra) {
    try {
      await api.updateCatalogExtra(extra.id, { is_active: !extra.is_active });
      load();
    } catch (e) { onErr(e); }
  }

  async function deleteExtra(extra) {
    if (!confirm(`למחוק לצמיתות את התוספת ${extra.name}?`)) return;
    try {
      await api.deleteCatalogExtra(extra.id);
      load();
    } catch (e) { onErr(e); }
  }

  const canReorder = filter.active === 'true' && !filter.search.trim();

  async function moveExtra(targetExtraId) {
    if (!canReorder || savingOrder || !draggedExtraId || draggedExtraId === targetExtraId) return;
    const previous = list;
    const fromIndex = previous.findIndex((extra) => extra.id === draggedExtraId);
    const toIndex = previous.findIndex((extra) => extra.id === targetExtraId);
    if (fromIndex < 0 || toIndex < 0) return;

    const reordered = [...previous];
    const [moved] = reordered.splice(fromIndex, 1);
    reordered.splice(toIndex, 0, moved);
    const normalized = reordered.map((extra, index) => ({ ...extra, display_order: index + 1 }));

    setList(normalized);
    setDraggedExtraId(null);
    setSavingOrder(true);
    try {
      await Promise.all(normalized.map((extra) =>
        api.updateCatalogExtra(extra.id, { display_order: extra.display_order })));
    } catch (e) {
      setList(previous);
      onErr(e);
    } finally {
      setSavingOrder(false);
    }
  }

  if (!list) return <p>טוען...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-burgundy/60">
        תוספות שהלקוח יכול לבחור מעבר למחיר המנה (שתייה, חלות, מיץ ענבים וכו׳). לכל תוספת מחיר ליחידה, יחידת חיוב
        ונוסחת כמות מוצעת שתוצג ללקוח בהזמנה.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ תוספת חדשה</button>
        <Field label="חיפוש">
          <input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            className={inputCls}
            placeholder="שם תוספת, יחידה או הערה"
          />
        </Field>
        <Field label="סטטוס">
          <select
            value={filter.active}
            onChange={(e) => setFilter((f) => ({ ...f, active: e.target.value }))}
            className={inputCls}
          >
            <option value="true">פעילות</option>
            <option value="false">לא פעילות</option>
            <option value="">הכל</option>
          </select>
        </Field>
        <span className="pb-2 text-xs text-brand-burgundy/55">
          {savingOrder
            ? 'שומר את סדר התוספות...'
            : canReorder
              ? 'אפשר לגרור שורות כדי לקבוע את סדר התוספות'
              : 'כדי לשנות סדר יש לנקות את החיפוש ולהציג תוספות פעילות'}
        </span>
      </div>

      {editing && !editing.id && (
        <ExtraForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
      )}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right">סדר</th>
              <th className="p-3 text-right">תוספת</th>
              <th className="p-3 text-right">מחיר ליחידה</th>
              <th className="p-3 text-right">יחידת חיוב</th>
              <th className="p-3 text-right">כמות מוצעת</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((extra) => (
              <Fragment key={extra.id}>
                <tr
                  draggable={canReorder && !savingOrder && editing?.id !== extra.id}
                  onDragStart={(e) => {
                    setDraggedExtraId(extra.id);
                    e.dataTransfer.effectAllowed = 'move';
                    e.dataTransfer.setData('text/plain', extra.id);
                  }}
                  onDragOver={(e) => {
                    if (canReorder && draggedExtraId && draggedExtraId !== extra.id) {
                      e.preventDefault();
                      e.dataTransfer.dropEffect = 'move';
                    }
                  }}
                  onDrop={(e) => { e.preventDefault(); moveExtra(extra.id); }}
                  onDragEnd={() => setDraggedExtraId(null)}
                  className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${canReorder ? 'cursor-grab active:cursor-grabbing' : ''} ${draggedExtraId === extra.id ? 'opacity-40' : ''} ${!extra.is_active ? 'opacity-50' : ''} ${editing?.id === extra.id ? 'bg-brand-cream/40' : ''}`}
                >
                  <td className="p-3"><DragHandle label={`גרירת ${extra.name}`} /></td>
                  <td className="p-3">
                    <div className="font-medium">{extra.name}</div>
                    {extra.customer_note && (
                      <div className="text-xs text-brand-burgundy/50 mt-0.5">{extra.customer_note}</div>
                    )}
                  </td>
                  <td className="p-3 text-sm">₪{fmt(extra.unit_price)}</td>
                  <td className="p-3 text-sm">{extra.billing_unit}</td>
                  <td className="p-3 text-sm">
                    {extra.suggestion_basis
                      ? `${suggestionBasisLabel(extra.suggestion_basis)} (יחס ${fmt(extra.suggestion_ratio)})`
                      : 'ללא'}
                  </td>
                  <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={extra.is_active ? 'active_female' : 'inactive_female'} /></td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                    <ActionIconButton
                      icon={editing?.id === extra.id ? 'cancel' : 'edit'}
                      label={editing?.id === extra.id ? 'סגירה' : 'עריכה'}
                      onClick={() => setEditing(editing?.id === extra.id ? null : extra)}
                    />
                    <ActionIconButton
                      icon={extra.is_active ? 'deactivate' : 'activate'}
                      label={extra.is_active ? 'השבתה' : 'הפעלה'}
                      tone="muted"
                      onClick={() => toggleActive(extra)}
                    />
                    {canDelete && (
                      <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteExtra(extra)} />
                    )}
                    </div>
                  </td>
                </tr>
                {editing?.id === extra.id && (
                  <tr>
                    <td colSpan={7} className="p-3 bg-brand-cream/20">
                      <ExtraForm initial={editing} onSave={save} onCancel={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={7} className="p-6 text-center text-brand-burgundy/50">אין תוספות להצגה.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExtraForm({ initial, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    unit_price: initial.unit_price ?? '',
    billing_unit: initial.billing_unit || '',
    suggestion_basis: initial.suggestion_basis || '',
    suggestion_ratio: initial.suggestion_ratio ?? '',
    customer_note: initial.customer_note || '',
    display_order: initial.display_order ?? 0,
  });

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם תוספת.');
    if (f.unit_price === '' || Number(f.unit_price) < 0) return alert('יש להזין מחיר ליחידה תקין.');
    if (!f.billing_unit.trim()) return alert('יש להזין יחידת חיוב.');
    if (f.suggestion_basis && (f.suggestion_ratio === '' || Number(f.suggestion_ratio) <= 0)) {
      return alert('כשנבחר בסיס לכמות מוצעת יש להזין יחס גדול מאפס.');
    }
    onSave({
      ...f,
      name: f.name.trim(),
      unit_price: Number(f.unit_price),
      billing_unit: f.billing_unit.trim(),
      suggestion_basis: f.suggestion_basis || null,
      suggestion_ratio: f.suggestion_basis ? Number(f.suggestion_ratio) : null,
      customer_note: f.customer_note.trim() || null,
      display_order: Number(f.display_order) || 0,
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת תוספת' : 'תוספת חדשה'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם תוספת *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} placeholder="שתייה, חלות, מיץ ענבים..." />
        </Field>
        <Field label="מחיר ליחידה (₪) *">
          <input type="number" step="0.01" min="0" value={f.unit_price} onChange={(e) => set('unit_price', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="יחידת חיוב *">
          <input value={f.billing_unit} onChange={(e) => set('billing_unit', e.target.value)} className={inputCls} placeholder="בקבוק, יחידה, ק״ג..." />
        </Field>
        <Field label="בסיס כמות מוצעת">
          <select value={f.suggestion_basis} onChange={(e) => set('suggestion_basis', e.target.value)} className={inputCls}>
            {SUGGESTION_BASES.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
          </select>
        </Field>
        {f.suggestion_basis && (
          <Field label="יחס לכמות מוצעת *">
            <input
              type="number"
              step="0.0001"
              min="0"
              value={f.suggestion_ratio}
              onChange={(e) => set('suggestion_ratio', e.target.value)}
              className={inputCls}
              dir="ltr"
              placeholder="לדוגמה 0.05 = יחידה לכל 20 מנות"
            />
          </Field>
        )}
      </div>
      <Field label="הערה ללקוח">
        <input value={f.customer_note} onChange={(e) => set('customer_note', e.target.value)} className={inputCls} placeholder="טקסט קצר שיוצג ללקוח ליד התוספת" />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

function PriceTracksManager({ mealSlots, onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [filter, setFilter] = useState({ active: 'true', search: '' });

  const load = useCallback(() => {
    const params = new URLSearchParams();
    if (filter.active) params.set('active', filter.active);
    if (filter.search.trim()) params.set('search', filter.search.trim());
    const q = params.toString();
    api.catalogPriceTracks(q ? `?${q}` : '').then(setList).catch(onErr);
  }, [filter, onErr]);

  useEffect(() => { load(); }, [load]);

  async function save(form) {
    try {
      if (form.id) await api.updateCatalogPriceTrack(form.id, form);
      else await api.createCatalogPriceTrack(form);
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  async function toggleActive(track) {
    try {
      await api.updateCatalogPriceTrack(track.id, { is_active: !track.is_active });
      load();
    } catch (e) { onErr(e); }
  }

  async function deleteTrack(track) {
    if (!confirm(`למחוק לצמיתות את המסלול ${track.name}?`)) return;
    try {
      await api.deleteCatalogPriceTrack(track.id);
      load();
    } catch (e) { onErr(e); }
  }

  if (!list) return <p>טוען...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-burgundy/60">
        מחיר הבסיס נקבע לפי <b>צירוף הסעודות המדויק</b> שהלקוח בוחר. כל מסלול משויך לקבוצת סעודות
        ולו מחיר <b>למנה אחת</b>, והמערכת מכפילה אותו בסך המנות. הזמנה שצירוף הסעודות שלה זהה בדיוק למסלול —
        תתומחר לפיו. אין להגדיר שני מסלולים לאותו צירוף, וצירוף ללא מסלול ייחסם בהזמנה.
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ מסלול מחיר חדש</button>
        <Field label="חיפוש">
          <input
            value={filter.search}
            onChange={(e) => setFilter((f) => ({ ...f, search: e.target.value }))}
            className={inputCls}
            placeholder="שם מסלול או תנאי"
          />
        </Field>
        <Field label="סטטוס">
          <select
            value={filter.active}
            onChange={(e) => setFilter((f) => ({ ...f, active: e.target.value }))}
            className={inputCls}
          >
            <option value="true">פעילים</option>
            <option value="false">לא פעילים</option>
            <option value="">הכל</option>
          </select>
        </Field>
      </div>

      {editing && !editing.id && (
        <PriceTrackForm initial={editing} mealSlots={mealSlots} onSave={save} onCancel={() => setEditing(null)} />
      )}

      <div className="overflow-x-auto">
        <table className="w-full bg-white rounded-2xl shadow-card overflow-hidden">
          <thead className="bg-brand-burgundy text-brand-cream text-sm">
            <tr>
              <th className="p-3 text-right">מסלול</th>
              <th className="p-3 text-right">צירוף סעודות</th>
              <th className="p-3 text-right">מחיר למנה</th>
              <th className="p-3 text-right">תחולה מ־</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((track) => (
              <Fragment key={track.id}>
                <tr className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!track.is_active ? 'opacity-50' : ''} ${editing?.id === track.id ? 'bg-brand-cream/40' : ''}`}>
                  <td className="p-3">
                    <div className="font-medium">{track.name}</div>
                    {track.condition_note && (
                      <div className="text-xs text-brand-burgundy/50 mt-0.5">{track.condition_note}</div>
                    )}
                  </td>
                  <td className="p-3 text-sm">{slotNames(track.meal_slot_ids, mealSlots)}</td>
                  <td className="p-3 text-sm font-medium">₪{fmt(track.price_per_portion)}</td>
                  <td className="p-3 text-sm">{track.effective_from || '—'}</td>
                  <td className="p-3 text-sm"><Badge map={ACTIVE_STATUS} value={track.is_active ? 'active' : 'inactive'} /></td>
                  <td className="p-3 text-sm whitespace-nowrap">
                    <div className="flex flex-wrap gap-1">
                    <ActionIconButton
                      icon={editing?.id === track.id ? 'cancel' : 'edit'}
                      label={editing?.id === track.id ? 'סגירה' : 'עריכה'}
                      onClick={() => setEditing(editing?.id === track.id ? null : track)}
                    />
                    <ActionIconButton
                      icon={track.is_active ? 'deactivate' : 'activate'}
                      label={track.is_active ? 'השבתה' : 'הפעלה'}
                      tone="muted"
                      onClick={() => toggleActive(track)}
                    />
                    {canDelete && (
                      <ActionIconButton icon="delete" label="מחיקה" tone="danger" onClick={() => deleteTrack(track)} />
                    )}
                    </div>
                  </td>
                </tr>
                {editing?.id === track.id && (
                  <tr>
                    <td colSpan={6} className="p-3 bg-brand-cream/20">
                      <PriceTrackForm initial={editing} mealSlots={mealSlots} onSave={save} onCancel={() => setEditing(null)} />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {list.length === 0 && (
              <tr><td colSpan={6} className="p-6 text-center text-brand-burgundy/50">אין מסלולי מחיר להצגה.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function PriceTrackForm({ initial, mealSlots, onSave, onCancel }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    price_per_portion: initial.price_per_portion ?? '',
    condition_note: initial.condition_note || '',
    effective_from: initial.effective_from || '',
    meal_slot_ids: initial.meal_slot_ids || [],
  });

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleSlot = (id) => {
    set('meal_slot_ids', f.meal_slot_ids.includes(id)
      ? f.meal_slot_ids.filter((x) => x !== id)
      : [...f.meal_slot_ids, id]);
  };

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם מסלול.');
    if (f.price_per_portion === '' || Number(f.price_per_portion) < 0) return alert('יש להזין מחיר למנה תקין.');
    if (f.meal_slot_ids.length === 0) return alert('יש לבחור לפחות סעודה אחת לצירוף המסלול.');
    onSave({
      ...f,
      name: f.name.trim(),
      price_per_portion: Number(f.price_per_portion),
      condition_note: f.condition_note.trim() || null,
      effective_from: f.effective_from || null,
      meal_slot_ids: f.meal_slot_ids,
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת מסלול מחיר' : 'מסלול מחיר חדש'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם מסלול *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} placeholder="ליל שבת בלבד, ליל שבת + שחרית..." />
        </Field>
        <Field label="מחיר למנה (₪) *">
          <input type="number" step="0.01" min="0" value={f.price_per_portion} onChange={(e) => set('price_per_portion', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
        <Field label="בתוקף מתאריך">
          <input type="date" value={f.effective_from} onChange={(e) => set('effective_from', e.target.value)} className={inputCls} dir="ltr" />
        </Field>
      </div>
      <Field label="צירוף הסעודות שהמסלול חל עליו *">
        <CheckboxGrid
          options={mealSlots}
          selected={f.meal_slot_ids}
          onToggle={toggleSlot}
          emptyText="אין סעודות פעילות."
        />
        <span className="text-xs text-brand-burgundy/50 block mt-1">
          המחיר יחול על הזמנה שבחרה בדיוק את הסעודות המסומנות כאן — לא פחות ולא יותר.
        </span>
      </Field>
      <Field label="תנאי מסלול (הערה)">
        <input value={f.condition_note} onChange={(e) => set('condition_note', e.target.value)} className={inputCls} placeholder="טקסט תיאורי של תנאי המסלול" />
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

function CheckboxGrid({ options, selected, onToggle, emptyText }) {
  if (!options.length) return <p className="text-sm text-brand-burgundy/50">{emptyText}</p>;

  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
      {options.map((option) => (
        <label key={option.id} className="flex items-center gap-2 rounded-lg border border-brand-cream-dark p-2 text-sm">
          <input
            type="checkbox"
            checked={selected.includes(option.id)}
            onChange={() => onToggle(option.id)}
          />
          <span>{option.name}</span>
        </label>
      ))}
    </div>
  );
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="text-sm text-brand-burgundy/70 block mb-1">{label}</span>
      {children}
    </label>
  );
}

function slotNames(ids = [], slots = []) {
  if (!ids.length) return 'לא הוגדר';
  const names = ids
    .map((id) => slots.find((slot) => slot.id === id)?.name)
    .filter(Boolean);
  return names.length ? names.join(', ') : 'לא הוגדר';
}

function fmt(n) {
  const num = Number(n);
  if (!Number.isFinite(num)) return n ?? '';
  return String(Number(num.toFixed(2)));
}
