-- =============================================================================
-- Matbach Hachesed -- migration 14: admin notification inbox
-- =============================================================================

create table admin_notifications (
  id             uuid primary key default gen_random_uuid(),
  notification_type text not null check (notification_type in ('new_order', 'new_registration')),
  entity_table   text not null check (entity_table in ('orders', 'customer_registration_requests')),
  entity_id      uuid not null,
  title          text not null,
  body           text,
  link_path      text not null,
  is_read        boolean not null default false,
  read_at        timestamptz,
  created_at     timestamptz not null default now()
);

create index idx_admin_notifications_unread
  on admin_notifications (is_read, created_at desc);

create index idx_admin_notifications_entity
  on admin_notifications (entity_table, entity_id);

comment on table admin_notifications is 'Unread admin notification items linked to new orders and customer registration requests';
