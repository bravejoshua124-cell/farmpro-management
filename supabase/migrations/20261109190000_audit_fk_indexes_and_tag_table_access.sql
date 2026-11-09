-- Audit remediation: index missing foreign-key columns and make intentional
-- deny-all access on internal livestock tag allocator tables explicit.
-- These indexes are additive; no existing data or indexes are removed.

create index if not exists breeding_records_dam_livestock_id_idx on public.breeding_records (dam_livestock_id);
create index if not exists breeding_records_farm_id_idx on public.breeding_records (farm_id);
create index if not exists breeding_records_owner_id_idx on public.breeding_records (owner_id);
create index if not exists breeding_records_poultry_batch_id_idx on public.breeding_records (poultry_batch_id);
create index if not exists breeding_records_sire_livestock_id_idx on public.breeding_records (sire_livestock_id);
create index if not exists customers_farm_id_idx on public.customers (farm_id);
create index if not exists customers_owner_id_idx on public.customers (owner_id);
create index if not exists expenses_farm_id_idx on public.expenses (farm_id);
create index if not exists farm_tasks_farm_id_idx on public.farm_tasks (farm_id);
create index if not exists farms_owner_id_idx on public.farms (owner_id);
create index if not exists feed_inventory_owner_id_idx on public.feed_inventory (owner_id);
create index if not exists feed_logs_farm_id_idx on public.feed_logs (farm_id);
create index if not exists feed_logs_feed_inventory_id_idx on public.feed_logs (feed_inventory_id);
create index if not exists feed_logs_livestock_id_idx on public.feed_logs (livestock_id);
create index if not exists feed_logs_poultry_batch_id_idx on public.feed_logs (poultry_batch_id);
create index if not exists health_records_farm_id_idx on public.health_records (farm_id);
create index if not exists health_records_livestock_id_idx on public.health_records (livestock_id);
create index if not exists health_records_poultry_batch_id_idx on public.health_records (poultry_batch_id);
create index if not exists inventory_items_owner_id_idx on public.inventory_items (owner_id);
create index if not exists inventory_movements_farm_id_idx on public.inventory_movements (farm_id);
create index if not exists inventory_movements_inventory_item_id_idx on public.inventory_movements (inventory_item_id);
create index if not exists inventory_movements_owner_id_idx on public.inventory_movements (owner_id);
create index if not exists livestock_dam_id_idx on public.livestock (dam_id);
create index if not exists livestock_sire_id_idx on public.livestock (sire_id);
create index if not exists production_records_farm_id_idx on public.production_records (farm_id);
create index if not exists production_records_livestock_id_idx on public.production_records (livestock_id);
create index if not exists production_records_poultry_batch_id_idx on public.production_records (poultry_batch_id);
create index if not exists purchases_farm_id_idx on public.purchases (farm_id);
create index if not exists purchases_supplier_id_idx on public.purchases (supplier_id);
create index if not exists sale_items_livestock_id_idx on public.sale_items (livestock_id);
create index if not exists sale_items_owner_id_idx on public.sale_items (owner_id);
create index if not exists sale_items_poultry_batch_id_idx on public.sale_items (poultry_batch_id);
create index if not exists sale_items_sale_id_idx on public.sale_items (sale_id);
create index if not exists sales_customer_id_idx on public.sales (customer_id);
create index if not exists sales_farm_id_idx on public.sales (farm_id);
create index if not exists suppliers_farm_id_idx on public.suppliers (farm_id);
create index if not exists suppliers_owner_id_idx on public.suppliers (owner_id);

-- RLS with no policies already denies direct access. These explicit false policies
-- preserve that behaviour while documenting that these tables are RPC-internal.
drop policy if exists "No direct access to livestock tag allocations" on public.livestock_tag_allocations;
create policy "No direct access to livestock tag allocations"
on public.livestock_tag_allocations for all to anon, authenticated
using (false) with check (false);

drop policy if exists "No direct access to livestock tag counters" on public.livestock_tag_counters;
create policy "No direct access to livestock tag counters"
on public.livestock_tag_counters for all to anon, authenticated
using (false) with check (false);
