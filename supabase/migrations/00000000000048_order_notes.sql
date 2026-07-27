-- General notes supplied with an order and visible to both the customer and admins.
alter table orders
  add column notes text;

comment on column orders.notes is 'General order notes supplied by the customer or updated by an admin';
