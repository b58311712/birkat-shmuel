-- Direct-to-event procurement: items that are ordered for one Shabbat and never enter stock.

alter table inventory_items
  add column procurement_type text not null default 'stock';

alter table inventory_items
  add constraint chk_inventory_items_procurement_type
  check (procurement_type in ('stock', 'direct_event'));

alter table inventory_items
  add constraint chk_direct_event_has_no_stock
  check (
    procurement_type <> 'direct_event'
    or (
      quantity_on_hand = 0
      and min_alert_quantity is null
      and min_alert_packages is null
    )
  );

comment on column inventory_items.procurement_type is
  'stock = managed inventory; direct_event = ordered for a specific Shabbat and not added to stock';

alter table purchase_orders
  add column shabbat_id uuid references shabbatot(id),
  add column is_direct_event_generated boolean not null default false;

create index idx_purchase_orders_shabbat on purchase_orders (shabbat_id);
create unique index uq_purchase_orders_direct_event_draft
  on purchase_orders (shabbat_id, supplier_id)
  where is_direct_event_generated and status = 'draft';

comment on column purchase_orders.shabbat_id is 'Shabbat/event this purchase order supplies';
comment on column purchase_orders.is_direct_event_generated is
  'Draft created from the direct-event requirements report and safe to synchronize';

alter table purchase_order_lines
  add column procurement_type_snapshot text not null default 'stock';

alter table purchase_order_lines
  add constraint chk_purchase_order_lines_procurement_type
  check (procurement_type_snapshot in ('stock', 'direct_event'));

comment on column purchase_order_lines.procurement_type_snapshot is
  'Procurement behavior captured when the order line was created';
