-- הזמנות: שם אולם נפרד ושדות חובה עבור אולם ואמצעי תשלום.
-- NOT VALID משמר הזמנות היסטוריות חסרות, אך אוכף את הכללים על כל יצירה/עדכון חדש.

alter table orders
  add column venue_name text;

alter table orders
  add constraint orders_venue_name_required
    check (venue_name is not null and btrim(venue_name) <> '') not valid,
  add constraint orders_venue_address_required
    check (venue_address is not null and btrim(venue_address) <> '') not valid,
  add constraint orders_payment_method_required
    check (preferred_payment_method is not null) not valid;

comment on column orders.venue_name is 'שם האולם (חובה בהזמנות חדשות ומעודכנות)';
