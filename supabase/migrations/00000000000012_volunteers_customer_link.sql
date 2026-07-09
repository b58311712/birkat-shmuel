-- =============================================================================
-- Matbach Hachesed - migration 12: link volunteers to existing customers
-- =============================================================================

alter table volunteers
  add column customer_id uuid references customers(id);

-- Link existing volunteers to customers by normalized phone when possible.
with matches as (
  select
    v.id as volunteer_id,
    c.id as customer_id,
    c.full_name,
    c.phone,
    c.email,
    row_number() over (partition by c.id order by v.created_at, v.id) as rn
  from volunteers v
  join customers c
    on regexp_replace(v.phone, '\D', '', 'g') = c.phone_normalized
  where v.customer_id is null
    and v.phone is not null
)
update volunteers v
set customer_id = m.customer_id,
    full_name = m.full_name,
    phone = m.phone,
    email = m.email
from matches m
where v.id = m.volunteer_id
  and m.rn = 1;

create unique index uq_volunteers_customer_id
  on volunteers (customer_id)
  where customer_id is not null;

create index idx_volunteers_customer_id on volunteers (customer_id);

create or replace function sync_volunteer_customer_contact()
returns trigger as $$
begin
  if new.customer_id is not null then
    select c.full_name, c.phone, c.email
      into new.full_name, new.phone, new.email
    from customers c
    where c.id = new.customer_id;
  end if;

  return new;
end;
$$ language plpgsql;

create trigger trg_volunteers_sync_customer_contact
  before insert or update of customer_id, full_name, phone, email on volunteers
  for each row execute function sync_volunteer_customer_contact();

create or replace function propagate_customer_contact_to_volunteers()
returns trigger as $$
begin
  update volunteers
  set full_name = new.full_name,
      phone = new.phone,
      email = new.email
  where customer_id = new.id;

  return new;
end;
$$ language plpgsql;

create trigger trg_customers_sync_linked_volunteers
  after update of full_name, phone, email on customers
  for each row execute function propagate_customer_contact_to_volunteers();

comment on column volunteers.customer_id is
  'Optional link to customers(id). When set, the volunteer contact details are synced from the customer.';
