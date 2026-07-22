import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { parseRecipe } from '../lib/recipeParser.js';
import { Page } from '../components/Layout.jsx';
import { ActionIconButton } from '../components/ActionIcon.jsx';
import { DataTable } from '../components/DataTable.jsx';
import { FormDrawer, useRecordNav } from '../components/Drawer.jsx';
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

// סימוני כרטיס המאכל (צ'קבוקסים) - כל אחד גם עמודה נפרדת וניתנת לסינון בטבלת המאכלים.
const MEAL_FLAGS = [
  { key: 'has_recipe', label: 'מתכון' },
  { key: 'has_quantity', label: 'כמות' },
  { key: 'has_packaging', label: 'אריזה' },
];

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
        <ExtrasManager categories={categories} onErr={handleErr} canDelete={canDelete} />
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
  const [savingOrder, setSavingOrder] = useState(false);
  const [inventoryItems, setInventoryItems] = useState([]);
  const [units, setUnits] = useState([]);

  const activeCategories = useMemo(
    () => categories.filter((c) => c.is_active),
    [categories]
  );

  // טוענים את כל המאכלים; הסינון (חיפוש/קטגוריה/סטטוס) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.catalogMeals('').then(setList).catch(onErr);
  }, [onErr]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    api.invItems('?active=true').then((items) => setInventoryItems(items || [])).catch(onErr);
    api.invUnits('?active=true').then((u) => setUnits(u || [])).catch(() => {});
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
      setEditing((e) => (e && e.id === meal.id ? { ...e, is_active: !meal.is_active } : e));
      load();
    } catch (e) { onErr(e); }
  }

  async function deleteMeal(meal) {
    if (!confirm(`למחוק לצמיתות את ${meal.name}?`)) return;
    try {
      await api.deleteCatalogMeal(meal.id);
      setEditing(null);
      load();
      onChanged?.();
    } catch (e) { onErr(e); }
  }

  const nav = useRecordNav(setEditing, editing?.id ?? null);

  async function handleReorder(reordered) {
    const previous = list;
    const normalized = reordered.map((meal, index) => ({ ...meal, display_order: index + 1 }));
    setList(normalized);
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

  const onInventoryItemCreated = (item) =>
    setInventoryItems((items) =>
      [...items, item].sort((a, b) => (a.name || '').localeCompare(b.name || '', 'he')));

  const columns = [
    {
      key: 'name',
      label: 'מאכל',
      type: 'text',
      render: (meal) => (
        <>
          <div className="font-medium">{meal.name}</div>
          {(meal.kitchen_prep_notes || meal.kitchen_report_notes) && (
            <div className="text-xs text-brand-burgundy/50 mt-0.5">
              {meal.kitchen_prep_notes || meal.kitchen_report_notes}
            </div>
          )}
        </>
      ),
    },
    {
      key: 'category',
      label: 'קטגוריה',
      type: 'enum',
      value: (meal) => meal.category_id || '',
      options: categories.map((c) => ({ value: c.id, label: c.name })),
      render: (meal) => meal.category?.name || 'ללא קטגוריה',
    },
    {
      key: 'slots',
      label: 'זמין בסעודות',
      type: 'text',
      value: (meal) => slotNames(meal.available_slot_ids, mealSlots),
      render: (meal) => slotNames(meal.available_slot_ids, mealSlots),
    },
    {
      key: 'price',
      label: 'מחיר',
      type: 'text',
      value: (meal) => (meal.requires_extra_charge ? `תוספת ₪${fmt(meal.extra_charge_amount)}` : (meal.included_in_base ? 'כלול בבסיס' : 'לא כלול')),
      render: (meal) => (meal.requires_extra_charge ? `תוספת ₪${fmt(meal.extra_charge_amount)}` : (meal.included_in_base ? 'כלול בבסיס' : 'לא כלול')),
    },
    ...MEAL_FLAGS.map((flag) => ({
      key: flag.key,
      label: flag.label,
      type: 'boolean',
      trueLabel: 'מסומן',
      falseLabel: 'לא מסומן',
      value: (meal) => !!meal[flag.key],
      render: (meal) => (meal[flag.key] ? <span className="text-brand-gold-dark font-bold">✓</span> : ''),
    })),
    {
      key: 'is_active',
      label: 'סטטוס',
      type: 'boolean',
      trueLabel: 'פעיל',
      falseLabel: 'לא פעיל',
      render: (meal) => <Badge map={ACTIVE_STATUS} value={meal.is_active ? 'active' : 'inactive'} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ מאכל חדש</button>
        {savingOrder && <span className="text-xs text-brand-burgundy/55">שומר את סדר המאכלים...</span>}
      </div>

      <DataTable
        columns={columns}
        rows={list}
        empty="אין מאכלים להצגה."
        reorderable
        onReorder={handleReorder}
        reorderHint="אפשר לגרור שורות כדי לקבוע את הסדר בממשק ההזמנות"
        reorderDisabledHint="כדי לשנות סדר יש לנקות את הסינון"
        rowClassName={(meal) => `${!meal.is_active ? 'opacity-50' : ''} ${editing?.id === meal.id ? 'bg-brand-cream/40' : ''}`}
        onRowClick={setEditing}
        onVisibleRowsChange={nav.setVisibleRows}
      />

      <FormDrawer
        editing={editing}
        onClose={() => setEditing(null)}
        entity="מאכל"
        title={editing?.name}
        width="6xl"
        onPrev={nav.onPrev}
        onNext={nav.onNext}
        position={nav.position}
        footer={editing?.id ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => toggleActive(editing)} className="btn-ghost">{editing.is_active ? 'השבתה' : 'הפעלה'}</button>
            {canDelete && (
              <button onClick={() => deleteMeal(editing)} className="btn-ghost text-red-600 hover:bg-red-50">מחיקה</button>
            )}
          </div>
        ) : undefined}
      >
        {editing && (
          <MealForm
            initial={editing}
            categories={editing.id ? categories : activeCategories}
            mealSlots={mealSlots}
            inventoryItems={inventoryItems}
            units={units}
            onInventoryItemCreated={onInventoryItemCreated}
            onSave={save}
            onCancel={() => setEditing(null)}
            embedded
          />
        )}
      </FormDrawer>
    </div>
  );
}

function MealForm({ initial, categories, mealSlots, inventoryItems, units, onInventoryItemCreated, onSave, onCancel, embedded = false }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    category_id: initial.category_id || '',
    included_in_base: initial.included_in_base ?? true,
    is_secondary: initial.is_secondary || false,
    requires_extra_charge: initial.requires_extra_charge || false,
    extra_charge_amount: initial.extra_charge_amount ?? '',
    has_recipe: initial.has_recipe || false,
    has_quantity: initial.has_quantity || false,
    has_packaging: initial.has_packaging || false,
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
  // דגל "מאכל משני" רלוונטי רק כשקטגוריית המאכל במצב חלוקה אוטומטית (additive).
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
          unit_id: line.unit_id || '',
          unit: line.unit_ref?.name || line.unit || '',
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
    <form onSubmit={submit} className={embedded ? 'space-y-3' : 'card space-y-3 border-r-4 border-brand-gold'}>
      {!embedded && <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת מאכל' : 'מאכל חדש'}</h3>}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
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
          <Field label="תפקיד המאכל בחלוקה האוטומטית">
            <label className="flex items-start gap-2 text-sm p-2 border border-brand-cream-dark rounded-lg">
              <input type="checkbox" checked={f.is_secondary}
                onChange={(e) => set('is_secondary', e.target.checked)} className="mt-0.5" />
              <span>
                <span className="font-medium text-brand-burgundy">מאכל משני</span>
                <span className="block text-xs text-brand-burgundy/60">
                  מסומן = מאכל משני (מקבל את האחוז המשני). לא מסומן = מאכל עיקרי (מקבל את האחוז העיקרי).
                </span>
              </span>
            </label>
          </Field>
        )}
      </div>

      <Field label="סימונים">
        <div className="flex flex-wrap gap-4 p-2 border border-brand-cream-dark rounded-lg">
          {MEAL_FLAGS.map((flag) => (
            <label key={flag.key} className="flex items-center gap-2 text-sm">
              <input type="checkbox" checked={f[flag.key]} onChange={(e) => set(flag.key, e.target.checked)} />
              {flag.label}
            </label>
          ))}
        </div>
      </Field>

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
        units={units}
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

function RecipeEditor({ loading, portions, onPortionsChange, lines, onLinesChange, instructions, onInstructionsChange, inventoryItems, units = [], onInventoryItemCreated }) {
  const [pasteText, setPasteText] = useState('');
  const [pasteOpen, setPasteOpen] = useState(false);
  const [creatingIdx, setCreatingIdx] = useState(null);

  // מיפוי שם-יחידה (טקסט) ל-unit_id, לניסיון התאמה של יחידות שהודבקו מטקסט חופשי
  const unitIdByName = useMemo(() => {
    const m = {};
    for (const u of units) m[String(u.name).trim().toLowerCase()] = u.id;
    return m;
  }, [units]);
  const matchUnitId = (name) => unitIdByName[String(name || '').trim().toLowerCase()] || '';

  // יצירה מהירה של פריט מלאי חדש משורת המתכון (שם + יחידה), וקישור השורה אליו.
  const createInventoryItem = async (idx) => {
    const line = lines[idx];
    const name = String(line.ingredient_name || '').trim();
    const unitId = line.unit_id || '';
    if (!name) return alert('יש להזין שם רכיב לפני יצירת פריט מלאי.');
    if (!unitId) return alert('יש לבחור יחידת מידה לפני יצירת פריט מלאי.');

    const existing = inventoryItems.find((it) => (it.name || '').trim() === name);
    if (existing) {
      updateLine(idx, { inventory_item_id: existing.id, unit_id: existing.unit_id || unitId, unit: existing.unit_ref?.name || existing.unit });
      return alert(`הפריט "${name}" כבר קיים במלאי — השורה קושרה אליו.`);
    }

    setCreatingIdx(idx);
    try {
      // הפריט החדש נוצר ביחידת הבסיס שנבחרה בשורת המתכון (unit_id)
      const res = await api.createInvItem({ name, unit_id: unitId });
      const item = res?.item;
      if (item) {
        onInventoryItemCreated?.(item);
        updateLine(idx, { inventory_item_id: item.id, ingredient_name: item.name, unit_id: item.unit_id, unit: item.unit_ref?.name || item.unit });
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
        unit_id: matchUnitId(l.unit), // ניסיון התאמה של היחידה שהודבקה ל-unit_id קיים
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
      { inventory_item_id: '', ingredient_name: '', quantity_for_recipe: '', unit_id: '', unit: '', notes: '' },
    ]);
  };

  const removeLine = (idx) => {
    onLinesChange(lines.filter((_, i) => i !== idx));
  };

  const chooseItem = (idx, itemId) => {
    const item = inventoryItems.find((it) => it.id === itemId);
    // בקישור לפריט מלאי — יורשים את יחידת הבסיס שלו כברירת מחדל למתכון
    updateLine(idx, {
      inventory_item_id: itemId,
      ingredient_name: item?.name || lines[idx].ingredient_name,
      unit_id: item?.unit_id || lines[idx].unit_id,
      unit: item?.unit_ref?.name || item?.unit || lines[idx].unit,
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
                      <select
                        value={line.unit_id || ''}
                        onChange={(e) => {
                          const u = units.find((x) => x.id === e.target.value);
                          updateLine(idx, { unit_id: e.target.value, unit: u?.name || '' });
                        }}
                        className={inputCls}
                      >
                        <option value="">— יחידה —</option>
                        {units.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                      </select>
                    </td>
                    <td className="p-2 text-brand-burgundy/70 whitespace-nowrap">
                      {perPortion(line.quantity_for_recipe)} {line.unit || units.find((u) => u.id === line.unit_id)?.name || ''}
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
  const [savingOrder, setSavingOrder] = useState(false);

  // טוענים את כל הקטגוריות; הסינון (חיפוש/סטטוס) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.catalogCategories('').then(setList).catch(onErr);
  }, [onErr]);

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
      setEditing((e) => (e && e.id === category.id ? { ...e, is_active: !category.is_active } : e));
      load();
      onChanged?.();
    } catch (e) { onErr(e); }
  }

  async function deleteCategory(category) {
    if (!confirm(`למחוק לצמיתות את הקטגוריה ${category.name}?`)) return;
    try {
      await api.deleteCatalogCategory(category.id);
      setEditing(null);
      load();
      onChanged?.();
    } catch (e) { onErr(e); }
  }

  const nav = useRecordNav(setEditing, editing?.id ?? null);

  async function handleReorder(reordered) {
    const previous = list;
    const normalized = reordered.map((category, index) => ({ ...category, display_order: index + 1 }));
    setList(normalized);
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

  const columns = [
    {
      key: 'name',
      label: 'קטגוריה',
      type: 'text',
      render: (category) => (
        <>
          <div className="font-medium">{category.name}</div>
          {category.internal_description && (
            <div className="text-xs text-brand-burgundy/50 mt-0.5">{category.internal_description}</div>
          )}
        </>
      ),
    },
    {
      key: 'slots',
      label: 'סעודות',
      type: 'text',
      value: (category) => slotNames(category.meal_slot_ids, mealSlots),
      render: (category) => slotNames(category.meal_slot_ids, mealSlots),
    },
    {
      key: 'rule',
      label: 'כללי בחירה',
      type: 'text',
      value: (category) => (category.recommended_min != null || category.max_allowed != null
        ? `מומלץ: ${category.recommended_min ?? '-'} | מקסימום: ${category.max_allowed ?? '-'}`
        : 'ללא כלל'),
      render: (category) => (category.recommended_min != null || category.max_allowed != null
        ? `מומלץ: ${category.recommended_min ?? '-'} | מקסימום: ${category.max_allowed ?? '-'}`
        : 'ללא כלל'),
    },
    {
      key: 'split',
      label: 'חלוקת מנות',
      type: 'text',
      value: (category) => splitSummary(category, mealSlots),
      render: (category) => splitSummary(category, mealSlots),
    },
    {
      key: 'is_active',
      label: 'סטטוס',
      type: 'boolean',
      trueLabel: 'פעילה',
      falseLabel: 'לא פעילה',
      render: (category) => <Badge map={ACTIVE_STATUS} value={category.is_active ? 'active_female' : 'inactive_female'} />,
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ קטגוריה חדשה</button>
        {savingOrder && <span className="text-xs text-brand-burgundy/55">שומר את סדר הקטגוריות...</span>}
      </div>

      <DataTable
        columns={columns}
        rows={list}
        empty="אין קטגוריות להצגה."
        reorderable
        onReorder={handleReorder}
        reorderHint="אפשר לגרור שורות כדי לקבוע את הסדר בממשק ההזמנות"
        reorderDisabledHint="כדי לשנות סדר יש לנקות את הסינון"
        rowClassName={(category) => `${!category.is_active ? 'opacity-50' : ''} ${editing?.id === category.id ? 'bg-brand-cream/40' : ''}`}
        onRowClick={setEditing}
        onVisibleRowsChange={nav.setVisibleRows}
      />

      <FormDrawer
        editing={editing}
        onClose={() => setEditing(null)}
        entity="קטגוריה"
        article="חדשה"
        title={editing?.name}
        width="xl"
        onPrev={nav.onPrev}
        onNext={nav.onNext}
        position={nav.position}
        footer={editing?.id ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => toggleActive(editing)} className="btn-ghost">{editing.is_active ? 'השבתה' : 'הפעלה'}</button>
            {canDelete && (
              <button onClick={() => deleteCategory(editing)} className="btn-ghost text-red-600 hover:bg-red-50">מחיקה</button>
            )}
          </div>
        ) : undefined}
      >
        {editing && <CategoryForm initial={editing} mealSlots={mealSlots} onSave={save} onCancel={() => setEditing(null)} embedded />}
      </FormDrawer>
    </div>
  );
}

// תקציר חלוקת המנות לעמודה בטבלה. במצב אוטומטי מפרט את האחוזים בכל סעודה
// שהוגדרה לה דריסה (למשל: "אוטומטית 80/50 · ליל שבת 80/50, בוקר 50/50").
function splitSummary(category, mealSlots) {
  const mode = category.split_mode || (category.requires_portion_split ? 'equal' : 'none');
  if (mode === 'equal') return 'ידנית — סך המנות = מנות הסעודה';
  if (mode !== 'additive') return 'ללא';

  const base = `אוטומטית ${category.primary_percent ?? 80}/${category.secondary_percent ?? 50}`;
  const overrides = mealSlots
    .filter((slot) => {
      const o = category.slot_splits?.[slot.id];
      return o && (o.primary_percent != null || o.secondary_percent != null);
    })
    .map((slot) => {
      const o = category.slot_splits[slot.id];
      return `${slot.name} ${o.primary_percent ?? category.primary_percent ?? 80}/${o.secondary_percent ?? category.secondary_percent ?? 50}`;
    });
  return overrides.length ? `${base} · ${overrides.join(', ')}` : base;
}

// דריסות האחוזים מהשרת (NULL = ברירת מחדל) → מחרוזות לשדות הטופס.
function slotSplitsToForm(slotSplits) {
  const out = {};
  for (const [slotId, v] of Object.entries(slotSplits || {})) {
    out[slotId] = {
      primary_percent: v?.primary_percent ?? '',
      secondary_percent: v?.secondary_percent ?? '',
    };
  }
  return out;
}

// שדות הטופס → מבנה לשליחה: ריק/לא-מספר = null (ברירת מחדל של הקטגוריה),
// וסעודה שבה שני השדות ריקים אינה נשלחת כלל.
function slotSplitsToPayload(slotSplits) {
  const out = {};
  for (const [slotId, v] of Object.entries(slotSplits || {})) {
    const primary = v?.primary_percent === '' || v?.primary_percent == null ? null : Number(v.primary_percent);
    const secondary = v?.secondary_percent === '' || v?.secondary_percent == null ? null : Number(v.secondary_percent);
    if (primary == null && secondary == null) continue;
    out[slotId] = { primary_percent: primary, secondary_percent: secondary };
  }
  return out;
}

function CategoryForm({ initial, mealSlots, onSave, onCancel, embedded = false }) {
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
    inherit_from_slot_id: initial.inherit_from_slot_id || '',
    extra_allowed: initial.extra_allowed ?? '',
    meal_slot_ids: initial.meal_slot_ids || [],
    // דריסת אחוזי החלוקה פר-סעודה: { [slotId]: { primary_percent, secondary_percent } }.
    // שדה ריק = "לפי ברירת המחדל" (האחוז הכללי של הקטגוריה למטה).
    slot_splits: slotSplitsToForm(initial.slot_splits),
  });

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleSlot = (id) => {
    set('meal_slot_ids', f.meal_slot_ids.includes(id)
      ? f.meal_slot_ids.filter((x) => x !== id)
      : [...f.meal_slot_ids, id]);
  };
  const setSlotSplit = (slotId, field, value) => {
    setF((s) => ({
      ...s,
      slot_splits: { ...s.slot_splits, [slotId]: { ...(s.slot_splits[slotId] || {}), [field]: value } },
    }));
  };

  function submit(e) {
    e.preventDefault();
    if (!f.name.trim()) return alert('חובה להזין שם קטגוריה.');
    if (f.split_mode === 'additive') {
      for (const [v, label] of [[f.primary_percent, 'אחוז המאכל העיקרי'], [f.secondary_percent, 'אחוז המאכל המשני']]) {
        if (v === '' || Number(v) < 1 || Number(v) > 100) return alert(`${label} חייב להיות בין 1 ל-100.`);
      }
      // דריסות פר-סעודה: שדה שמולא חייב להיות אחוז תקין (שדה ריק = ברירת מחדל).
      for (const [slotId, v] of Object.entries(f.slot_splits)) {
        const slotName = mealSlots.find((s) => s.id === slotId)?.name || 'סעודה';
        for (const [raw, label] of [[v?.primary_percent, 'עיקרי'], [v?.secondary_percent, 'משני']]) {
          if (raw === '' || raw == null) continue;
          if (!Number.isFinite(Number(raw)) || Number(raw) < 1 || Number(raw) > 100) {
            return alert(`האחוז ה${label} של ${slotName} חייב להיות בין 1 ל-100 (או ריק לברירת מחדל).`);
          }
        }
      }
    }
    if (f.inherit_from_slot_id && (f.extra_allowed === '' || Number(f.extra_allowed) < 0)) {
      return alert('כשמוגדרת ירושה מסעודה, יש להזין כמה מאכלים מותר להוסיף (0 ומעלה).');
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
      // דריסות פר-סעודה נשמרות רק כשהקטגוריה במצב חלוקה אוטומטית.
      slot_splits: f.split_mode === 'additive' ? slotSplitsToPayload(f.slot_splits) : {},
      inherit_from_slot_id: f.inherit_from_slot_id || null,
      extra_allowed: f.inherit_from_slot_id ? Number(f.extra_allowed) || 0 : null,
    });
  }

  return (
    <form onSubmit={submit} className={embedded ? 'space-y-3' : 'card space-y-3 border-r-4 border-brand-gold'}>
      {!embedded && <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}</h3>}
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
          <option value="additive">חלוקה אוטומטית לפי אחוזים</option>
        </select>
        {f.split_mode === 'additive' && (
          <div className="mt-2 space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <Field label="ברירת מחדל — אחוז למאכל העיקרי">
                <input type="number" min="1" max="100" value={f.primary_percent}
                  onChange={(e) => set('primary_percent', e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <Field label="ברירת מחדל — אחוז (תוספת) למאכל המשני">
                <input type="number" min="1" max="100" value={f.secondary_percent}
                  onChange={(e) => set('secondary_percent', e.target.value)} className={inputCls} dir="ltr" />
              </Field>
              <p className="col-span-2 text-xs text-brand-burgundy/60">
                מאכל יחיד מקבל 100% מהמנות. משנבחר גם מאכל משני — העיקרי מקבל את האחוז העיקרי והמשני תוספת של האחוז המשני
                (למשל 100 מנות ← 80 + 50 = 130). לא ניתן לבחור שני מאכלים עיקריים.
              </p>
            </div>
            <SlotSplitMatrix
              mealSlots={mealSlots}
              slotSplits={f.slot_splits}
              defaults={{ primary: f.primary_percent, secondary: f.secondary_percent }}
              onChange={setSlotSplit}
            />
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
      <Field label="ירושת מאכלים מסעודה (למשל סלטים: בבוקר מקבלים את בחירת הלילה)">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <select
            value={f.inherit_from_slot_id}
            onChange={(e) => set('inherit_from_slot_id', e.target.value)}
            className={inputCls}
          >
            <option value="">ללא ירושה — כל סעודה נבחרת בנפרד</option>
            {mealSlots
              .filter((s) => f.meal_slot_ids.includes(s.id))
              .map((s) => (
                <option key={s.id} value={s.id}>יורש מ: {s.name}</option>
              ))}
          </select>
          {f.inherit_from_slot_id && (
            <Field label="כמה מותר להוסיף בסעודה היורשת">
              <input type="number" min="0" value={f.extra_allowed}
                onChange={(e) => set('extra_allowed', e.target.value)} className={inputCls} dir="ltr" placeholder="0" />
            </Field>
          )}
        </div>
        {f.inherit_from_slot_id && (
          <p className="mt-1 text-xs text-brand-burgundy/60">
            בסעודות האחרות של קטגוריה זו, המאכלים שנבחרו בסעודת-האב יסומנו אוטומטית (נעולים),
            והלקוח יוכל להוסיף עד המספר שהוגדר. בסעודת-האב עצמה חל כלל "מקסימום מותר" הרגיל.
          </p>
        )}
      </Field>
      <div className="flex gap-2">
        <button type="submit" className="btn-primary">שמירה</button>
        <button type="button" onClick={onCancel} className="btn-ghost">ביטול</button>
      </div>
    </form>
  );
}

// מטריצת אחוזי החלוקה פר-סעודה (מצב additive בלבד).
// כל שורה = סעודה, ובה אחוז עיקרי ואחוז משני. שדה ריק נופל לברירת המחדל של
// הקטגוריה, כך שאפשר לקבוע למשל: ליל שבת 80%+50% ובוקר 50%+50%.
function SlotSplitMatrix({ mealSlots, slotSplits, defaults, onChange }) {
  const defPrimary = Number(defaults.primary) || 80;
  const defSecondary = Number(defaults.secondary) || 50;
  const cellCls = 'w-full border border-brand-cream-dark rounded-lg p-1.5 text-center outline-none focus:border-brand-gold';

  if (!mealSlots.length) {
    return <p className="text-sm text-brand-burgundy/50">אין סעודות פעילות להגדרת חלוקה.</p>;
  }

  return (
    <div className="rounded-lg border border-brand-cream-dark p-3">
      <p className="text-sm font-medium text-brand-burgundy mb-1">חלוקה שונה לכל סעודה</p>
      <p className="text-xs text-brand-burgundy/60 mb-2">
        אפשר לקבוע לכל סעודה אחוזים משלה. שדה שנשאר ריק מקבל את ברירת המחדל שלמעלה
        ({defPrimary}% עיקרי / {defSecondary}% משני).
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-brand-burgundy/70">
              <th className="text-right font-medium pb-1">סעודה</th>
              <th className="font-medium pb-1 w-28">% עיקרי</th>
              <th className="font-medium pb-1 w-28">% משני</th>
              <th className="text-right font-medium pb-1 w-40">התוצאה ל-100 מנות</th>
            </tr>
          </thead>
          <tbody>
            {mealSlots.map((slot) => {
              const row = slotSplits[slot.id] || {};
              const primary = row.primary_percent === '' || row.primary_percent == null
                ? defPrimary : Number(row.primary_percent);
              const secondary = row.secondary_percent === '' || row.secondary_percent == null
                ? defSecondary : Number(row.secondary_percent);
              const valid = primary >= 1 && primary <= 100 && secondary >= 1 && secondary <= 100;

              return (
                <tr key={slot.id}>
                  <td className="py-1 pl-2 font-medium text-brand-burgundy">{slot.name}</td>
                  <td className="py-1 px-1">
                    <input
                      type="number" min="1" max="100" dir="ltr" className={cellCls}
                      placeholder={String(defPrimary)}
                      value={row.primary_percent ?? ''}
                      onChange={(e) => onChange(slot.id, 'primary_percent', e.target.value)}
                    />
                  </td>
                  <td className="py-1 px-1">
                    <input
                      type="number" min="1" max="100" dir="ltr" className={cellCls}
                      placeholder={String(defSecondary)}
                      value={row.secondary_percent ?? ''}
                      onChange={(e) => onChange(slot.id, 'secondary_percent', e.target.value)}
                    />
                  </td>
                  <td className="py-1 pr-2 text-xs text-brand-burgundy/60">
                    {valid
                      ? `${Math.ceil(primary)} + ${Math.ceil(secondary)} = ${Math.ceil(primary) + Math.ceil(secondary)} מנות`
                      : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ExtrasManager({ categories, onErr, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
  const [savingOrder, setSavingOrder] = useState(false);
  const [meals, setMeals] = useState([]);

  // טוענים את כל התוספות; הסינון (חיפוש/סטטוס) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.catalogExtras('').then(setList).catch(onErr);
  }, [onErr]);

  useEffect(() => { load(); }, [load]);

  // מאכלים פעילים לבחירת ההתניה ("התוספת תוצג רק אם הוזמן מאכל מסוים").
  useEffect(() => {
    api.catalogMeals('?active=true').then((rows) => setMeals(rows || [])).catch(onErr);
  }, [onErr]);

  const mealNameById = useMemo(
    () => Object.fromEntries(meals.map((m) => [m.id, m.name])),
    [meals]
  );
  const columns = useMemo(() => extraColumns(mealNameById), [mealNameById]);

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
      setEditing((e) => (e && e.id === extra.id ? { ...e, is_active: !extra.is_active } : e));
      load();
    } catch (e) { onErr(e); }
  }

  async function deleteExtra(extra) {
    if (!confirm(`למחוק לצמיתות את התוספת ${extra.name}?`)) return;
    try {
      await api.deleteCatalogExtra(extra.id);
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  const nav = useRecordNav(setEditing, editing?.id ?? null);

  async function handleReorder(reordered) {
    const previous = list;
    const normalized = reordered.map((extra, index) => ({ ...extra, display_order: index + 1 }));
    setList(normalized);
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

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-burgundy/60">
        תוספות שהלקוח יכול לבחור מעבר למחיר המנה (שתייה, חלות, מיץ ענבים וכו׳). לכל תוספת מחיר ליחידה, יחידת חיוב
        ונוסחת כמות מוצעת שתוצג ללקוח בהזמנה. ניתן להתנות תוספת במאכלים מסוימים - אז היא תוצג בהזמנה
        רק כשנבחר לפחות אחד מהם.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ תוספת חדשה</button>
        {savingOrder && <span className="text-xs text-brand-burgundy/55">שומר את סדר התוספות...</span>}
      </div>

      <DataTable
        columns={columns}
        rows={list}
        empty="אין תוספות להצגה."
        reorderable
        onReorder={handleReorder}
        reorderHint="אפשר לגרור שורות כדי לקבוע את סדר התוספות"
        reorderDisabledHint="כדי לשנות סדר יש לנקות את הסינון"
        rowClassName={(extra) => `${!extra.is_active ? 'opacity-50' : ''} ${editing?.id === extra.id ? 'bg-brand-cream/40' : ''}`}
        onRowClick={setEditing}
        onVisibleRowsChange={nav.setVisibleRows}
      />

      <FormDrawer
        editing={editing}
        onClose={() => setEditing(null)}
        entity="תוספת"
        article="חדשה"
        title={editing?.name}
        width="lg"
        onPrev={nav.onPrev}
        onNext={nav.onNext}
        position={nav.position}
        footer={editing?.id ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => toggleActive(editing)} className="btn-ghost">{editing.is_active ? 'השבתה' : 'הפעלה'}</button>
            {canDelete && (
              <button onClick={() => deleteExtra(editing)} className="btn-ghost text-red-600 hover:bg-red-50">מחיקה</button>
            )}
          </div>
        ) : undefined}
      >
        {editing && <ExtraForm initial={editing} meals={meals} categories={categories} onSave={save} onCancel={() => setEditing(null)} embedded />}
      </FormDrawer>
    </div>
  );
}

// תלוי בשמות המאכלים (לעמודת ההתניה), ולכן פונקציה ולא קבוע.
const extraColumns = (mealNameById = {}) => [
  {
    key: 'name',
    label: 'תוספת',
    type: 'text',
    render: (extra) => (
      <>
        <div className="font-medium">{extra.name}</div>
        {extra.customer_note && (
          <div className="text-xs text-brand-burgundy/50 mt-0.5">{extra.customer_note}</div>
        )}
      </>
    ),
  },
  { key: 'unit_price', label: 'מחיר ליחידה', type: 'number', render: (extra) => `₪${fmt(extra.unit_price)}` },
  { key: 'billing_unit', label: 'יחידת חיוב', type: 'text' },
  {
    key: 'suggestion',
    label: 'כמות מוצעת',
    type: 'text',
    value: (extra) => (extra.suggestion_basis
      ? `${suggestionBasisLabel(extra.suggestion_basis)} (יחס ${fmt(extra.suggestion_ratio)})`
      : 'ללא'),
    render: (extra) => (extra.suggestion_basis
      ? `${suggestionBasisLabel(extra.suggestion_basis)} (יחס ${fmt(extra.suggestion_ratio)})`
      : 'ללא'),
  },
  {
    key: 'required_meals',
    label: 'מותנית במאכל',
    type: 'text',
    value: (extra) => requiredMealsLabel(extra.required_meal_ids, mealNameById),
    render: (extra) => {
      const ids = extra.required_meal_ids || [];
      if (!ids.length) return <span className="text-brand-burgundy/40">ללא התניה</span>;
      return (
        <span className="text-xs">
          רק אם הוזמן: {requiredMealsLabel(ids, mealNameById)}
        </span>
      );
    },
  },
  {
    key: 'is_active',
    label: 'סטטוס',
    type: 'boolean',
    trueLabel: 'פעילה',
    falseLabel: 'לא פעילה',
    render: (extra) => <Badge map={ACTIVE_STATUS} value={extra.is_active ? 'active_female' : 'inactive_female'} />,
  },
];

function requiredMealsLabel(ids = [], mealNameById = {}) {
  if (!ids.length) return 'ללא התניה';
  return ids.map((id) => mealNameById[id] || 'מאכל שהוסר').join(', ');
}

function ExtraForm({ initial, meals = [], categories = [], onSave, onCancel, embedded = false }) {
  const [f, setF] = useState({
    id: initial.id,
    name: initial.name || '',
    unit_price: initial.unit_price ?? '',
    billing_unit: initial.billing_unit || '',
    suggestion_basis: initial.suggestion_basis || '',
    suggestion_ratio: initial.suggestion_ratio ?? '',
    customer_note: initial.customer_note || '',
    display_order: initial.display_order ?? 0,
    required_meal_ids: initial.required_meal_ids || [],
  });

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));

  function toggleRequiredMeal(mealId) {
    setF((s) => ({
      ...s,
      required_meal_ids: s.required_meal_ids.includes(mealId)
        ? s.required_meal_ids.filter((id) => id !== mealId)
        : [...s.required_meal_ids, mealId],
    }));
  }

  // המאכלים לבחירה מקובצים לפי קטגוריה, כדי שיהיה קל לאתר "כל הדגים" וכדומה.
  const mealsByCategory = useMemo(() => {
    const groups = new Map();
    for (const meal of meals) {
      const name = categories.find((c) => c.id === meal.category_id)?.name || 'ללא קטגוריה';
      if (!groups.has(name)) groups.set(name, []);
      groups.get(name).push(meal);
    }
    return [...groups.entries()];
  }, [meals, categories]);

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
      required_meal_ids: f.required_meal_ids,
    });
  }

  return (
    <form onSubmit={submit} className={embedded ? 'space-y-3' : 'card space-y-3 border-r-4 border-brand-gold'}>
      {!embedded && <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת תוספת' : 'תוספת חדשה'}</h3>}
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

      <div>
        <span className="text-sm text-brand-burgundy/70 block mb-1">מותנית בהזמנת מאכל</span>
        <p className="text-xs text-brand-burgundy/55 mb-2">
          {f.required_meal_ids.length === 0
            ? 'לא נבחר מאכל - התוספת תוצג בכל הזמנה.'
            : 'התוספת תוצג ללקוח רק אם נבחר לפחות אחד מהמאכלים המסומנים (בכל סעודה שהיא).'}
        </p>
        {mealsByCategory.length === 0 ? (
          <p className="text-sm text-brand-burgundy/50">אין מאכלים פעילים.</p>
        ) : (
          <div className="space-y-3 max-h-72 overflow-y-auto border border-brand-cream-dark rounded-lg p-3">
            {mealsByCategory.map(([categoryName, categoryMeals]) => (
              <div key={categoryName}>
                <div className="text-xs font-bold text-brand-gold-dark mb-1">{categoryName}</div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                  {categoryMeals.map((meal) => (
                    <label key={meal.id} className="flex items-center gap-2 rounded-lg border border-brand-cream-dark p-2 text-sm">
                      <input
                        type="checkbox"
                        checked={f.required_meal_ids.includes(meal.id)}
                        onChange={() => toggleRequiredMeal(meal.id)}
                      />
                      <span>{meal.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

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

  // טוענים את כל המסלולים; הסינון (חיפוש/סטטוס) נעשה בזיכרון ב-DataTable.
  const load = useCallback(() => {
    api.catalogPriceTracks('').then(setList).catch(onErr);
  }, [onErr]);

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
      setEditing((e) => (e && e.id === track.id ? { ...e, is_active: !track.is_active } : e));
      load();
    } catch (e) { onErr(e); }
  }

  async function deleteTrack(track) {
    if (!confirm(`למחוק לצמיתות את המסלול ${track.name}?`)) return;
    try {
      await api.deleteCatalogPriceTrack(track.id);
      setEditing(null);
      load();
    } catch (e) { onErr(e); }
  }

  const nav = useRecordNav(setEditing, editing?.id ?? null);

  if (!list) return <p>טוען...</p>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-brand-burgundy/60">
        מחיר הבסיס נקבע לפי <b>צירוף הסעודות המדויק</b> שהלקוח בוחר. כל מסלול משויך לקבוצת סעודות
        ולו מחיר <b>למנה אחת</b>, והמערכת מכפילה אותו בסך המנות. הזמנה שצירוף הסעודות שלה זהה בדיוק למסלול —
        תתומחר לפיו. אין להגדיר שני מסלולים לאותו צירוף, וצירוף ללא מסלול ייחסם בהזמנה.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <button onClick={() => setEditing({})} className="btn-primary">+ מסלול מחיר חדש</button>
      </div>

      <DataTable
        columns={[
          {
            key: 'name',
            label: 'מסלול',
            type: 'text',
            render: (track) => (
              <>
                <div className="font-medium">{track.name}</div>
                {track.condition_note && (
                  <div className="text-xs text-brand-burgundy/50 mt-0.5">{track.condition_note}</div>
                )}
              </>
            ),
          },
          {
            key: 'slots',
            label: 'צירוף סעודות',
            type: 'text',
            value: (track) => slotNames(track.meal_slot_ids, mealSlots),
            render: (track) => slotNames(track.meal_slot_ids, mealSlots),
          },
          { key: 'price_per_portion', label: 'מחיר למנה', type: 'number', className: 'font-medium', render: (track) => `₪${fmt(track.price_per_portion)}` },
          { key: 'effective_from', label: 'תחולה מ־', type: 'date', render: (track) => track.effective_from || '—' },
          {
            key: 'is_active',
            label: 'סטטוס',
            type: 'boolean',
            trueLabel: 'פעיל',
            falseLabel: 'לא פעיל',
            render: (track) => <Badge map={ACTIVE_STATUS} value={track.is_active ? 'active' : 'inactive'} />,
          },
        ]}
        rows={list}
        empty="אין מסלולי מחיר להצגה."
        rowClassName={(track) => `${!track.is_active ? 'opacity-50' : ''} ${editing?.id === track.id ? 'bg-brand-cream/40' : ''}`}
        onRowClick={setEditing}
        onVisibleRowsChange={nav.setVisibleRows}
      />

      <FormDrawer
        editing={editing}
        onClose={() => setEditing(null)}
        entity="מסלול מחיר"
        title={editing?.name}
        width="lg"
        onPrev={nav.onPrev}
        onNext={nav.onNext}
        position={nav.position}
        footer={editing?.id ? (
          <div className="flex flex-wrap gap-2">
            <button onClick={() => toggleActive(editing)} className="btn-ghost">{editing.is_active ? 'השבתה' : 'הפעלה'}</button>
            {canDelete && (
              <button onClick={() => deleteTrack(editing)} className="btn-ghost text-red-600 hover:bg-red-50">מחיקה</button>
            )}
          </div>
        ) : undefined}
      >
        {editing && <PriceTrackForm initial={editing} mealSlots={mealSlots} onSave={save} onCancel={() => setEditing(null)} embedded />}
      </FormDrawer>
    </div>
  );
}

function PriceTrackForm({ initial, mealSlots, onSave, onCancel, embedded = false }) {
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
    <form onSubmit={submit} className={embedded ? 'space-y-3' : 'card space-y-3 border-r-4 border-brand-gold'}>
      {!embedded && <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת מסלול מחיר' : 'מסלול מחיר חדש'}</h3>}
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
