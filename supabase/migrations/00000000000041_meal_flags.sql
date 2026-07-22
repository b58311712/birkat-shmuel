-- =============================================================================
-- מטבח החסד - מיגרציה 41: שלושה סימונים בכרטיס המאכל
-- =============================================================================
-- דגלי סימון חופשיים לכרטיס המאכל (צ'קבוקסים בממשק הקטלוג): מתכון, כמות, אריזה.

alter table meals
  add column if not exists has_recipe    boolean not null default false,
  add column if not exists has_quantity  boolean not null default false,
  add column if not exists has_packaging boolean not null default false;

comment on column meals.has_recipe    is 'סימון "מתכון" בכרטיס המאכל';
comment on column meals.has_quantity  is 'סימון "כמות" בכרטיס המאכל';
comment on column meals.has_packaging is 'סימון "אריזה" בכרטיס המאכל';
