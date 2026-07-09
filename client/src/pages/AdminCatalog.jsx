import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { parseRecipe } from '../lib/recipeParser.js';
import { Page } from '../components/Layout.jsx';

const inputCls = 'w-full border border-brand-cream-dark rounded-lg p-2 focus:border-brand-gold outline-none';

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
    </Page>
  );
}

function MealsManager({ categories, mealSlots, onErr, onChanged, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
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
      const { recipe_portions, recipe_lines, ...mealPayload } = form;
      const result = form.id
        ? await api.updateCatalogMeal(form.id, mealPayload)
        : await api.createCatalogMeal(mealPayload);
      const mealId = form.id || result?.meal?.id;
      if (mealId) {
        await api.setCatalogMealRecipe(mealId, {
          recipe_portions,
          lines: recipe_lines,
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
      </div>

      {editing && (
        <MealForm
          initial={editing}
          categories={editing.id ? categories : activeCategories}
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
              <th className="p-3 text-right">סדר</th>
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
              <tr key={meal.id} className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!meal.is_active ? 'opacity-50' : ''}`}>
                <td className="p-3 text-sm text-brand-burgundy/50">{meal.display_order}</td>
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
                <td className="p-3 text-sm">{meal.is_active ? 'פעיל' : 'לא פעיל'}</td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <button onClick={() => setEditing(meal)} className="text-brand-burgundy hover:underline ml-3">עריכה</button>
                  <button onClick={() => toggleActive(meal)} className="text-brand-burgundy/60 hover:underline">
                    {meal.is_active ? 'השבתה' : 'הפעלה'}
                  </button>
                  {canDelete && (
                    <button onClick={() => deleteMeal(meal)} className="text-red-600 hover:underline mr-3">
                      מחיקה
                    </button>
                  )}
                </td>
              </tr>
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

  const set = (k, v) => setF((s) => ({ ...s, [k]: v }));
  const toggleSlot = (id) => {
    set('available_slot_ids', f.available_slot_ids.includes(id)
      ? f.available_slot_ids.filter((x) => x !== id)
      : [...f.available_slot_ids, id]);
  };

  useEffect(() => {
    let alive = true;
    if (!initial.id) {
      setRecipeLoading(false);
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
        <Field label="סדר תצוגה">
          <input type="number" value={f.display_order} onChange={(e) => set('display_order', e.target.value)} className={inputCls} dir="ltr" />
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
                      <button type="button" onClick={() => removeLine(idx)} className="btn-ghost px-2 py-1">מחיקה</button>
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

function CategoriesManager({ mealSlots, onErr, onChanged, canDelete }) {
  const [list, setList] = useState(null);
  const [editing, setEditing] = useState(null);
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
      else await api.createCatalogCategory(form);
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
      </div>

      {editing && (
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
              <th className="p-3 text-right">סדר</th>
              <th className="p-3 text-right">קטגוריה</th>
              <th className="p-3 text-right">סעודות</th>
              <th className="p-3 text-right">כללי בחירה</th>
              <th className="p-3 text-right">סטטוס</th>
              <th className="p-3 text-right"></th>
            </tr>
          </thead>
          <tbody>
            {list.map((category) => (
              <tr key={category.id} className={`border-b border-brand-cream-dark hover:bg-brand-cream/30 ${!category.is_active ? 'opacity-50' : ''}`}>
                <td className="p-3 text-sm text-brand-burgundy/50">{category.display_order}</td>
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
                <td className="p-3 text-sm">{category.is_active ? 'פעילה' : 'לא פעילה'}</td>
                <td className="p-3 text-sm whitespace-nowrap">
                  <button onClick={() => setEditing(category)} className="text-brand-burgundy hover:underline ml-3">עריכה</button>
                  <button onClick={() => toggleActive(category)} className="text-brand-burgundy/60 hover:underline">
                    {category.is_active ? 'השבתה' : 'הפעלה'}
                  </button>
                  {canDelete && (
                    <button onClick={() => deleteCategory(category)} className="text-red-600 hover:underline mr-3">
                      מחיקה
                    </button>
                  )}
                </td>
              </tr>
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
    onSave({
      ...f,
      name: f.name.trim(),
      display_order: Number(f.display_order) || 0,
      recommended_min: f.recommended_min === '' ? null : Number(f.recommended_min),
      max_allowed: f.max_allowed === '' ? null : Number(f.max_allowed),
    });
  }

  return (
    <form onSubmit={submit} className="card space-y-3 border-r-4 border-brand-gold">
      <h3 className="font-bold text-brand-burgundy">{f.id ? 'עריכת קטגוריה' : 'קטגוריה חדשה'}</h3>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <Field label="שם קטגוריה *">
          <input value={f.name} onChange={(e) => set('name', e.target.value)} className={inputCls} />
        </Field>
        <Field label="סדר תצוגה">
          <input type="number" value={f.display_order} onChange={(e) => set('display_order', e.target.value)} className={inputCls} dir="ltr" />
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
