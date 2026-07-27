-- Post-Shabbat customer feedback.

create table order_feedback (
  id                  uuid primary key default gen_random_uuid(),
  order_id            uuid not null unique references orders(id) on delete cascade,
  token_hash          text unique,
  status              text not null default 'pending'
                        check (status in ('pending', 'sending', 'sent', 'failed', 'completed')),
  send_attempts       integer not null default 0,
  last_send_error     text,
  sent_at             timestamptz,
  token_expires_at    timestamptz,
  overall_rating      smallint check (overall_rating between 1 and 5),
  food_rating         smallint check (food_rating between 1 and 5),
  quantity_rating     smallint check (quantity_rating between 1 and 5),
  delivery_rating     smallint check (delivery_rating between 1 and 5),
  comment             text,
  completed_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index idx_order_feedback_status on order_feedback(status);
create index idx_order_feedback_completed on order_feedback(completed_at desc);
create index idx_order_feedback_token_hash on order_feedback(token_hash);

create trigger trg_order_feedback_updated_at
  before update on order_feedback for each row execute function set_updated_at();

comment on table order_feedback is
  'One post-Shabbat feedback invitation and response per order; access tokens are stored as SHA-256 hashes only.';

-- Feedback notifications link either to a feedback row or to its order.
do $$
declare
  con_name text;
begin
  for con_name in
    select conname
    from pg_constraint
    where conrelid = 'admin_notifications'::regclass
      and contype = 'c'
      and (
        pg_get_constraintdef(oid) ilike '%notification_type%'
        or pg_get_constraintdef(oid) ilike '%entity_table%'
      )
  loop
    execute format('alter table admin_notifications drop constraint %I', con_name);
  end loop;
end $$;

alter table admin_notifications
  add constraint admin_notifications_notification_type_check
  check (notification_type in ('new_order', 'new_registration', 'payment_reminder', 'new_feedback', 'low_feedback')),
  add constraint admin_notifications_entity_table_check
  check (entity_table in ('orders', 'customer_registration_requests', 'order_feedback'));

insert into email_templates (code, subject, body, is_active)
values (
  'feedback_request',
  'נשמח לשמוע איך היה – מטבח החסד',
  $body$שלום {customer_name},

נשמח לשמוע איך הייתה החוויה שלך בהזמנה מספר {order_number} לשבת פרשת {parasha}.
השאלון קצר ואורך כדקה:

{feedback_url}

תודה,
מטבח החסד$body$,
  true
)
on conflict (code) do nothing;
