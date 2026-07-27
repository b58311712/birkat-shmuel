-- =============================================================================
-- מטבח החסד - מיגרציה 47: ניהול מלאי במארזים לצד יחידת הבסיס
-- =============================================================================

alter table inventory_items
  add column package_label text,
  add column package_size numeric(18,6),
  add column min_alert_packages integer;

alter table inventory_items
  add constraint chk_inventory_package_pair check (
    (package_label is null and package_size is null)
    or
    (package_label is not null and btrim(package_label) <> '' and package_size > 0)
  ),
  add constraint chk_inventory_min_alert_packages check (
    min_alert_packages is null or min_alert_packages >= 0
  ),
  add constraint chk_inventory_min_packages_requires_package check (
    min_alert_packages is null or package_size is not null
  );

comment on column inventory_items.package_label is 'שם המארז של המוצר, למשל שק/קרטון/בקבוק';
comment on column inventory_items.package_size is 'כמות יחידות הבסיס במארז אחד';
comment on column inventory_items.min_alert_packages is 'סף ההתראה במארזים שלמים; מסונכרן גם ל-min_alert_quantity לתאימות';

alter table inventory_movements
  add column package_label_snapshot text,
  add column package_size_snapshot numeric(18,6);

alter table inventory_movements
  add constraint chk_movement_package_snapshot check (
    (package_label_snapshot is null and package_size_snapshot is null)
    or
    (package_label_snapshot is not null and package_size_snapshot > 0)
  );

comment on column inventory_movements.package_label_snapshot is 'שם המארז בזמן התנועה';
comment on column inventory_movements.package_size_snapshot is 'גודל המארז ביחידות בסיס בזמן התנועה';

create or replace function snapshot_inventory_movement_package()
returns trigger
language plpgsql
as $$
begin
  if new.package_label_snapshot is null and new.package_size_snapshot is null then
    select package_label, package_size
      into new.package_label_snapshot, new.package_size_snapshot
      from inventory_items
     where id = new.inventory_item_id;
  end if;
  return new;
end;
$$;

create trigger trg_inventory_movements_package_snapshot
  before insert on inventory_movements
  for each row execute function snapshot_inventory_movement_package();

alter table purchase_order_lines
  add column package_label_snapshot text,
  add column package_size_snapshot numeric(18,6);

alter table purchase_order_lines
  add constraint chk_po_line_package_snapshot check (
    (package_label_snapshot is null and package_size_snapshot is null)
    or
    (package_label_snapshot is not null and package_size_snapshot > 0)
  );

comment on column purchase_order_lines.package_label_snapshot is 'שם המארז בזמן יצירת ההזמנה';
comment on column purchase_order_lines.package_size_snapshot is 'גודל המארז ביחידות בסיס בזמן יצירת ההזמנה';
