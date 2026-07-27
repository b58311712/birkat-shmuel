-- =============================================================================
-- מטבח החסד - מיגרציה 51: קישור תוספות בתשלום למלאי
-- =============================================================================
-- עד כה רק מאכלים (meals) היו מקושרים למלאי דרך recipe_lines, ולכן תוספות
-- בתשלום (שתייה, מיץ ענבים, חלות) נמכרו בלי שהמערכת תדע מה הן צורכות: הן לא
-- נכנסו לכמות הנדרשת בתיק השבת, לא הופיעו בהמלצות הרכש ולא נוכו מהמלאי.
--
-- כאן מרחיבים את recipe_lines כך שכל שורה שייכת או למאכל או לתוספת - בדיוק
-- לאחד מהשניים. המשמעות של quantity_per_portion לפי סוג הבעלים:
--   שורת מאכל  - כמות ליחידת מנה אחת
--   שורת תוספת - כמות ליחידת חיוב אחת (extras.billing_unit): בקבוק, יחידה...
-- כך כל מנגנוני ההמרה (inventory_unit_conversions), הדוחות והניכוי האטומי
-- שכבר בנויים סביב recipe_lines חלים גם על תוספות, בלי כפילות קוד או טבלה.
-- =============================================================================

alter table recipe_lines
  alter column meal_id drop not null;

alter table recipe_lines
  add column extra_id uuid references extras(id) on delete cascade;

-- בעלים אחד ויחיד לכל שורה: מאכל או תוספת, לא שניהם ולא אף אחד.
alter table recipe_lines
  add constraint chk_recipe_lines_owner
  check ((meal_id is not null) <> (extra_id is not null));

create index idx_recipe_lines_extra on recipe_lines (extra_id);

comment on table recipe_lines is
  'שורות מרכיבים: למאכל (כמות למנה אחת) או לתוספת בתשלום (כמות ליחידת חיוב אחת) (סעיף 21.3, 14.6)';
comment on column recipe_lines.extra_id is
  'התוספת שהשורה שייכת לה (חלופי ל-meal_id). כמות = ליחידת חיוב אחת של התוספת';
comment on column recipe_lines.quantity_per_portion is
  'שורת מאכל: כמות למנה אחת. שורת תוספת: כמות ליחידת חיוב אחת (extras.billing_unit)';
