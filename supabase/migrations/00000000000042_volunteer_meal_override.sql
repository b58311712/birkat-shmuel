-- =============================================================================
-- מטבח החסד - מיגרציה 42: שיבוץ מבשל מחליף פר-שבת למאכל (דריסה)
-- =============================================================================
-- בלשונית המתנדבים, כרטיס "בישול - פירוט מאכלים" מציג לכל מאכל שהוזמן מי מבשל אותו
-- לפי השיוך הקבוע (volunteer_meal_links). כאן מתאפשר לשבץ מחליף לשבת בודדת בלבד,
-- מתוך רשימת המתנדבים הכללית, בלי לשנות את השיוך הקבוע.
--
-- שומרים זאת באותה טבלה של דריסות המשימות (volunteer_assignments): שורת is_override
-- עם meal_id מלא ו-task_id ריק = דריסת מבשל למאכל בשבת זו. שורה אחת ל-(שבת, מאכל).

alter table volunteer_assignments
  add column meal_id uuid references meals(id) on delete cascade;

-- דריסת מבשל אחת לכל (שבת, מאכל). השירות overrideMealCook עושה delete-then-insert
-- (לא ON CONFLICT), אז אינדקס חלקי מספיק - במקביל לאינדקס הדריסה של המשימות.
create unique index uq_volunteer_assignments_meal_override
  on volunteer_assignments(shabbat_id, meal_id)
  where meal_id is not null;

comment on column volunteer_assignments.meal_id is
  'שיבוץ מבשל מחליף פר-שבת למאכל (דריסה) - task_id ריק, is_override=true';
