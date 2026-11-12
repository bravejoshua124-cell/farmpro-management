# FarmPro Database Implementation Plan

**Status:** Implementation plan only. No SQL, application code, or remote Supabase changes were made.

**Approved scope:** Follow [farmpro-architecture-spec.md](./farmpro-architecture-spec.md). V1 excludes livestock `acquisition_type`, `purchase_cost`, and livestock acquisition-cost accounting. Do not add them to tables, forms, migrations, reports, or finance calculations.

## 1. What was inspected

- The workspace contains `docs/farmpro-architecture-spec.md` and Git metadata. There is no `src/`, package manifest, or other application source to extend.
- There is no local `supabase/` directory, `supabase/config.toml`, or `supabase/migrations/` directory. Consequently, there are no local migration files to inventory or reconcile.
- The user reports that four old migration-ledger entries remain in the retained remote Supabase project. This plan has not queried the remote project, so their versions, names, contents, and relationship to the current remote schema are not verified.
- The Supabase CLI guidance referenced below is the official CLI documentation for [migration repair](https://supabase.com/docs/reference/cli/supabase-migration-repair), [migration list](https://supabase.com/docs/reference/cli/supabase-migration-list), [database dump](https://supabase.com/docs/reference/cli/supabase-db-dump), and [database migrations](https://supabase.com/docs/guides/deployment/database-migrations). Confirm exact command options against the pinned CLI version before any future remote operation.

## 2. Implementation principles

1. Use Supabase Auth for identity; use `public` for FarmPro application tables.
2. One farm has one owner in v1. A user can own multiple farms. Do not create memberships, roles, livestock acquisition accounting, or other unapproved features.
3. Every operational row belongs to one farm. Reference other farm rows with composite `(farm_id, referenced_id)` foreign keys, not only an ID.
4. Prefer source transactions and derived views over stored balances, totals, or statuses.
5. Use PostgreSQL constraints for local row rules and triggers/functions for rules that depend on other rows, concurrency, or transaction-wide conditions.
6. Enable RLS before exposing a table to the Supabase API. RLS is the security boundary; React filters are only usability features.
7. Keep transaction history. Posted financial records have no direct client UPDATE or DELETE path in v1. Any correction/void workflow must be approved, audited, and implemented as a controlled database operation before it is exposed.
8. Use no service-role key in the browser. Do not apply or repair remote migrations without explicit authorization, a reviewed dry run, and a recovery plan.

### Common types and defaults

- Operational `id`: `uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY`.
- Operational `farm_id`: `uuid NOT NULL REFERENCES farms(id) ON DELETE RESTRICT`; also create `UNIQUE (farm_id,id)` on each operational table so same-farm composite foreign keys can reference it.
- Every farm-to-farm-row relationship uses `FOREIGN KEY (farm_id, related_id) REFERENCES related_table(farm_id,id) ON DELETE RESTRICT`.
- `created_at`: `timestamptz NOT NULL DEFAULT now()` except on `purchase_lines` and `sale_lines`. Those lines have no independent lifecycle; their parent document's `created_at` is the transaction creation timestamp.
- `updated_at`: `timestamptz NOT NULL DEFAULT now()` on editable master records only: farms, counterparties, animals, and inventory items. Maintain it with a trigger.
- Quantities: `numeric(12,3)` unless the value is a whole bird count (`integer`). Money: `numeric(12,2)` in the farm currency. Do not store calculated line totals.
- Finite values are `text` with `CHECK` constraints. Values and units are listed in the table sections below.
- “No default” means the form or authenticated workflow must supply the value; do not invent a default.

## 3. Approved tables

All columns below are required unless marked optional. `system` means the database/authenticated farm context supplies the value; `user` means an existing form workflow captures it. The table list deliberately contains no livestock acquisition type or cost.

### 3.1 Identity and farm

#### `profiles`

**Purpose:** App-facing profile for an Auth user. Do not duplicate email or password.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Auth trigger copies `auth.users.id`; no generated default |
| `display_name` | `text` nullable | No default; optional user input |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** `id` FK to `auth.users(id) ON DELETE CASCADE`. Display name must be null or trimmed non-empty. RLS restricts a user to their own row.

#### `farms`

**Purpose:** Farm identity, owner boundary, currency, and timezone.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | `gen_random_uuid()` |
| `owner_id` | `uuid` | Authenticated user; no client override |
| `name` | `text` | No default; required user input |
| `currency_code` | `text` | No default; required user input |
| `timezone` | `text` | No database default; form may suggest the valid browser IANA timezone |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | `now()`; update trigger |

**Relationships / rules:** `owner_id` FK to `auth.users(id) ON DELETE RESTRICT`; immutable after insert. Check trimmed non-empty name and three uppercase currency letters; UI validates the supported ISO 4217 list. Validate timezone against PostgreSQL's available timezone names in a trigger. Index `owner_id`. Restrictive child FKs prevent deleting a farm with operational records.

### 3.2 Master data

#### `counterparties`

**Purpose:** Reusable customer/supplier records; a party can have both roles.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `role` | `text` | No default; user selects `customer`, `supplier`, or `both` |
| `name` | `text` | No default; required user input |
| `phone` | `text` nullable | No default; optional user input |
| `email` | `text` nullable | No default; optional user input |
| `address` | `text` nullable | No default; optional user input |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | `now()`; update trigger |

**Relationships / rules:** `farm_id` FK to `farms`; unique `(farm_id,id)`. Check role and trimmed non-empty name (1–160 characters). Index `(farm_id,role,name)`. A role-validation trigger guards all references and role edits; details in Sections 5 and 6.

#### `animals`

**Purpose:** Individually identified non-poultry livestock and parentage.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `species` | `text` | No default; `pig`, `cattle`, `goat`, `sheep`, `other` |
| `tag_code` | `text` nullable | No default; optional user input |
| `name` | `text` nullable | No default; optional user input |
| `sex` | `text` nullable | No default; optional `female`, `male`, `unknown` |
| `birth_date` | `date` nullable | No default; optional user input |
| `acquired_on` | `date` | Form defaults to today; user may correct |
| `dam_id` | `uuid` nullable | No default; optional same-farm animal selection |
| `sire_id` | `uuid` nullable | No default; optional same-farm animal selection |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | `now()`; update trigger |

**Relationships / rules:** Composite self-FKs `(farm_id,dam_id)` and `(farm_id,sire_id)` to `animals(farm_id,id)`. Check species, sex, `birth_date <= acquired_on` when known, and no self-parent. A trigger rejects future acquisition dates and parentage cycles. Index `(farm_id,species)`, `(farm_id,acquired_on)`, `(farm_id,dam_id)`, `(farm_id,sire_id)`. Partial unique index `(farm_id,lower(tag_code)) WHERE tag_code IS NOT NULL`.

**Explicit exclusion:** No `acquisition_type`, `purchase_cost`, or livestock acquisition-cost accounting. Only `acquired_on` is captured.

#### `poultry_batches`

**Purpose:** Group birds managed by batch rather than individual tags.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `species` | `text` | No default; `chicken`, `duck`, `turkey`, `other` |
| `purpose` | `text` | No default; `eggs`, `meat`, `breeding`, `mixed` |
| `batch_name` | `text` nullable | No default; optional user input |
| `acquired_on` | `date` | Form defaults to today; user may correct |
| `initial_count` | `integer` | No default; required positive user input |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** `farm_id` FK to `farms`; unique `(farm_id,id)`. Check species, purpose, and `initial_count > 0`. A trigger rejects future acquisition dates. Index `(farm_id,acquired_on)`. Current count is derived, never stored.

#### `inventory_items`

**Purpose:** Define stocked inputs and saleable products with one base unit per item.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `name` | `text` | No default; required user input |
| `category` | `text` | No default; `feed`, `medicine`, `supplies`, `product`, `other` |
| `unit` | `text` | No default; `kg`, `g`, `l`, `ml`, `unit`, `bag`, `bale`, `tray`, `dozen` |
| `reorder_level` | `numeric(12,3)` nullable | No default; optional non-negative user input |
| `is_active` | `boolean` | `true`; user retires through a dedicated action |
| `created_at` | `timestamptz` | `now()` |
| `updated_at` | `timestamptz` | `now()`; update trigger |

**Relationships / rules:** `farm_id` FK to `farms`; unique `(farm_id,id)`. Check category, unit, and non-negative reorder level. Unique expression index `(farm_id,lower(name))`; lookup index `(farm_id,category,name)`. Category and unit may change only before any transaction/history reference exists. Name and reorder level remain editable. Inactive items cannot be used in new transactions; retirement requires zero stock and cannot be reversed after the item has history. Preserve historical IDs and quantities; if correcting an item, create a replacement and use documented adjustments rather than rewriting old movements.

### 3.3 Poultry, animal, and task events

#### `poultry_batch_events`

**Purpose:** Bird deaths, additions, and count corrections; bird sales are represented by sale lines.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `batch_id` | `uuid` | Required same-farm batch selection |
| `event_type` | `text` | No default; `death`, `addition`, `adjustment` |
| `quantity_change` | `integer` | No default; non-zero signed user input |
| `event_date` | `date` | Today |
| `reason` | `text` nullable | Required for adjustment; otherwise optional |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FK `(farm_id,batch_id)`; checks type, sign (`death < 0`, `addition > 0`), non-zero amount, and adjustment reason. Index `(farm_id,batch_id,event_date)`. Trigger locks the batch and checks projected count.

#### `health_records`

**Purpose:** Animal or flock checkups, illness, treatment, vaccination, and mammal death history.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `animal_id` | `uuid` nullable | Select animal or batch, exactly one |
| `batch_id` | `uuid` nullable | Select animal or batch, exactly one |
| `event_type` | `text` | No default; `checkup`, `illness`, `treatment`, `vaccination`, `death` |
| `recorded_on` | `date` | Today |
| `description` | `text` | No default; required user input |
| `medicine_item_id` | `uuid` nullable | Optional same-farm medicine item |
| `notes` | `text` nullable | No default; optional user input |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FKs to optional animal, batch, and medicine item. Check exactly one animal/batch. Trigger requires medicine category `medicine` and limits `death` to an animal. Partial unique index `(farm_id,animal_id) WHERE event_type='death'`. Index by `(farm_id,recorded_on)`, `(farm_id,animal_id,recorded_on)`, `(farm_id,batch_id,recorded_on)`, and `(farm_id,medicine_item_id)`. Death uses the animal-state lock described below. Poultry deaths use batch events instead. The health form may record which medicine was used; when the user records a quantity administered as part of a treatment, that quantity is written to one linked inventory-consumption row, not duplicated in this table.

#### `breeding_events`

**Purpose:** Record mating, pregnancy checks, and birth milestones for mammals.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `dam_id` | `uuid` | Required animal selection |
| `sire_id` | `uuid` nullable | Optional animal selection |
| `event_type` | `text` | No default; `mating`, `pregnancy_check`, `birth` |
| `event_date` | `date` | Today |
| `result` | `text` nullable | Optional; pregnancy check values `pregnant`, `not_pregnant`, `unknown` |
| `expected_due_date` | `date` nullable | Optional user input |
| `notes` | `text` nullable | Optional user input |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FKs to dam and sire. Checks event/result/date rules and different parents; trigger checks known sex and same-species pairing. Index `(farm_id,dam_id,event_date)`, `(farm_id,sire_id,event_date)`, `(farm_id,event_date)`. Offspring are animal rows linked via `dam_id`/`sire_id`; no litter-size field.

#### `tasks`

**Purpose:** Farm reminders and activities.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `title` | `text` | No default; required user input |
| `description` | `text` nullable | Optional user input |
| `due_on` | `date` nullable | Optional user input |
| `status` | `text` | `open`; completion/reopen action |
| `completed_at` | `timestamptz` nullable | Set/cleared by trigger |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** `farm_id` FK to `farms`; unique `(farm_id,id)`. Check title and `status IN ('open','done')`; require `completed_at` exactly when done. Index `(farm_id,status,due_on)`.

### 3.4 Inventory and production transactions

#### `purchases`

**Purpose:** Completed receipts of stocked inventory, not purchase orders.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `supplier_id` | `uuid` nullable | Optional supplier/both contact |
| `purchased_on` | `date` | Today |
| `reference` | `text` nullable | Optional receipt/invoice reference |
| `notes` | `text` nullable | Optional user input |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FK to optional counterparty; trigger validates supplier role. Index `(farm_id,purchased_on)`, `(farm_id,supplier_id,purchased_on)`. Deferred constraint requires at least one line at commit.

#### `purchase_lines`

**Purpose:** Record each purchased stock item, quantity received, and unit cost.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `purchase_id` | `uuid` | Parent purchase |
| `item_id` | `uuid` | Required inventory-item selection |
| `quantity` | `numeric(12,3)` | No default; positive user input |
| `unit_cost` | `numeric(12,2)` | No default; non-negative user input |

**Relationships / rules:** Composite FKs to purchase and inventory item. Index `(farm_id,purchase_id)`, `(farm_id,item_id)`. The item/quantity form a positive inventory receipt. No `created_at`: the parent purchase timestamps the receipt. Line/purchase totals are calculated.

#### `inventory_consumptions`

**Purpose:** Record stock use and optionally attribute it to an animal or poultry batch.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `item_id` | `uuid` | Required inventory-item selection |
| `quantity` | `numeric(12,3)` | No default; positive user input |
| `consumed_on` | `date` | Today |
| `health_record_id` | `uuid` nullable | Set by the combined treatment workflow; not a separate user-selected field |
| `animal_id` | `uuid` nullable | Optional same-farm animal |
| `batch_id` | `uuid` nullable | Optional same-farm batch |
| `notes` | `text` nullable | Optional user input |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FKs to item, animal, batch, and optional health record. At most one of animal/batch may be set; both may be null for farm-wide consumption. A linked row must reference a same-farm treatment record with the same medicine item and same animal/batch source; a partial unique index on `(farm_id,health_record_id)` allows at most one stock-consumption row per treatment. Index `(farm_id,item_id,consumed_on)`, `(farm_id,animal_id,consumed_on)`, `(farm_id,batch_id,consumed_on)`, and `(farm_id,health_record_id)`. A stock trigger locks the item and rejects negative projected stock.

#### `inventory_adjustments`

**Purpose:** Auditable corrections of counted stock.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `item_id` | `uuid` | Required inventory-item selection |
| `quantity_change` | `numeric(12,3)` | No default; non-zero signed user input |
| `adjusted_on` | `date` | Today |
| `reason` | `text` | No default; required non-empty user input |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FK to item. Index `(farm_id,item_id,adjusted_on)`. Stock trigger locks item and rejects any negative projected balance.

#### `production_records`

**Purpose:** Attribute output to one animal or batch and add that output to product inventory.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `item_id` | `uuid` | Required product inventory-item selection |
| `quantity` | `numeric(12,3)` | No default; positive user input |
| `recorded_on` | `date` | Today |
| `animal_id` | `uuid` nullable | Conditional source |
| `batch_id` | `uuid` nullable | Conditional source |
| `notes` | `text` nullable | Optional user input |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FKs to item, animal, and batch. Exactly one of animal/batch is required. Trigger checks product category and locks item before stock validation. Index `(farm_id,recorded_on)`, `(farm_id,item_id,recorded_on)`, `(farm_id,animal_id,recorded_on)`, `(farm_id,batch_id,recorded_on)`.

### 3.5 Sales and finance

#### `sales`

**Purpose:** Completed sales of products, individual animals, or birds from a batch.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `customer_id` | `uuid` nullable | Optional customer/both contact |
| `sold_on` | `date` | Today |
| `reference` | `text` nullable | Optional receipt/invoice reference |
| `notes` | `text` nullable | Optional user input |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FK to optional customer; role-validation trigger. Index `(farm_id,sold_on)`, `(farm_id,customer_id,sold_on)`. Deferred constraint requires at least one sale line at commit.

#### `sale_lines`

**Purpose:** Store the sold entity, quantity, and sale-time price.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `sale_id` | `uuid` | Parent sale |
| `item_id` | `uuid` nullable | Product item; mutually exclusive with animal/batch |
| `animal_id` | `uuid` nullable | Individual animal; mutually exclusive with item/batch |
| `batch_id` | `uuid` nullable | Poultry batch; mutually exclusive with item/animal |
| `quantity` | `numeric(12,3)` | No default; positive user input, 1 for animal, whole birds for batch |
| `unit_price` | `numeric(12,2)` | No default; non-negative user input |

**Relationships / rules:** Composite FKs to sale, item, animal, and batch. Check exactly one of item/animal/batch, quantity requirements, and non-negative unit price. For a batch line, require `quantity = trunc(quantity)` so poultry sales contain whole birds; item quantities may remain fractional where the base unit permits it, and an individual-animal line has quantity exactly 1. A trigger requires an item-backed sale line's item category to be `product`. Partial unique index `(farm_id,animal_id) WHERE animal_id IS NOT NULL` enforces at most one sale per individual animal. Index `(farm_id,sale_id)`, `(farm_id,item_id)`, `(farm_id,batch_id)`. No `created_at`: parent sale timestamps the lines. Total is calculated.

#### `expenses`

**Purpose:** Non-inventory operating costs. Stock purchases remain in `purchases`.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `category` | `text` | No default; `labor`, `utilities`, `veterinary`, `transport`, `maintenance`, `other` |
| `amount` | `numeric(12,2)` | No default; positive user input |
| `spent_on` | `date` | Today |
| `description` | `text` | No default; required user input |
| `supplier_id` | `uuid` nullable | Optional supplier/both contact |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FK to optional supplier; role-validation trigger. Index `(farm_id,spent_on)`, `(farm_id,category,spent_on)`, `(farm_id,supplier_id,spent_on)`.

#### `payments`

**Purpose:** Record installments received for a sale or paid for a purchase/expense.

| Column | Type | Default / source |
|---|---|---|
| `id` | `uuid` PK | Generated |
| `farm_id` | `uuid` | Selected farm context |
| `sale_id` | `uuid` nullable | Conditional payment target |
| `purchase_id` | `uuid` nullable | Conditional payment target |
| `expense_id` | `uuid` nullable | Conditional payment target |
| `amount` | `numeric(12,2)` | No default; positive user input |
| `paid_on` | `date` | Today |
| `method` | `text` nullable | Optional `cash`, `bank_transfer`, `mobile_money`, `card`, `other` |
| `reference` | `text` nullable | Optional transaction reference |
| `created_at` | `timestamptz` | `now()` |

**Relationships / rules:** Composite FKs to sale, purchase, or expense. Exactly one target must be set. Index `(farm_id,sale_id,paid_on)`, `(farm_id,purchase_id,paid_on)`, `(farm_id,expense_id,paid_on)`. Trigger locks the target, validates same-farm ownership, and rejects overpayment.

## 4. Dependency-ordered migration plan

There are no migration files today. After this plan is approved and the repository is ready, initialize Supabase locally and create reviewed, timestamped migrations in this order. The names below are stage labels, not files created by this task.

1. **Identity and farm foundation**
   - Add profile trigger/helper and `profiles`, then `farms`.
   - Add timestamp and timezone/owner protections.
   - Enable RLS and apply policies in the same migration.
2. **Master records**
   - Add `counterparties`, `animals`, `poultry_batches`, and `inventory_items`.
   - Add farm-scoped unique keys, foreign keys, checks, indexes, update triggers, and RLS.
3. **Animal, poultry, and activity history**
   - Add `poultry_batch_events`, `health_records`, `breeding_events`, and `tasks`.
   - Add source/parentage constraints, death safeguards, batch-count triggers, and RLS.
4. **Inventory transactions and production**
   - Add `purchases`, `purchase_lines`, `inventory_consumptions`, `inventory_adjustments`, and `production_records`.
   - Add deferred purchase-line validation, stock locking/validation, `record_treatment` after both health and consumption tables exist, and `inventory_balances`.
5. **Sales**
   - Add `sales` and `sale_lines`.
   - Add deferred non-empty-sale check, role checks, product stock and poultry count validation, animal sold/dead validation, partial unique animal-sale index, sale totals, and RLS.
6. **Expenses and payments**
   - Add `expenses` and `payments`.
   - Add target/balance constraints, row locks, payment-balance view, and RLS.
7. **Final reporting views and security verification**
   - Add `poultry_batch_balances`, `animal_status`, `purchase_totals`, and any remaining read-only report views.
   - Verify grants, view security-invoker behavior, and policies for every public table.

Within each stage, create referenced parent tables before children. Each migration must be safe to run on a clean local database, and RLS must be enabled before the API can expose the table. Do not generate migration SQL with `db pull` from remote as a substitute for reviewed local migrations.

## 5. Keys, constraints, indexes, and rules checklist

### Keys and same-farm constraints

- `profiles.id` is both PK and FK to `auth.users.id`.
- `farms.id` is PK; `owner_id` is an immutable FK to `auth.users.id`.
- Every other table has `id` PK, `farm_id` FK to `farms`, and unique `(farm_id,id)`.
- Every FK between farm-owned records is composite `(farm_id, referenced_id)`. This applies to contacts, parent animals, poultry batches, inventory items, documents, payments, and all optional sources.
- Use `ON DELETE RESTRICT` for operational references. Do not cascade delete farm history.
- Add supporting indexes for every composite FK and for the date/farm lookup patterns listed under each table.

### Checks and unique indexes

- Add checks for non-empty required names/descriptions, finite text choices, positive amounts/quantities, signed adjustment rules, conditional target/source XOR rules, date order, and task completion state.
- For `sale_lines`, require batch-sale quantities to be whole birds; validate that item-backed lines reference `inventory_items.category = 'product'`.
- Unique indexes: case-insensitive farm animal tag when supplied; case-insensitive farm inventory item name; one death event per individual animal; one sale line per individual animal; at most one inventory-consumption row per linked health treatment.
- Parentage cycle checks, party-role compatibility, medicine/product category matching, treatment-to-consumption consistency, timezone validity, future acquisition dates, stock availability, sale/death state, flock count, payment balance, and non-empty document lines require triggers or transaction functions, not ordinary `CHECK` constraints.
- A deferred constraint trigger requires each committed purchase and sale to have at least one line. The multi-line write function performs the complete operation atomically.
- Do not add a quantity-on-hand, poultry current-count, sale total, purchase total, payment balance, or animal status column.

## 6. RLS policy plan

Enable RLS on every exposed `public` table. Grant no application-data access to `anon`. The browser uses only the Supabase anon/publishable key; never put the service-role key in Vite or client code. RLS controls which rows an authenticated caller may access; PostgreSQL table privileges separately control which operations that role may attempt. Both layers must be correct.

For farm-owned tables, every policy checks that `farm_id` belongs to a row in `farms` with `owner_id = auth.uid()`. For UPDATE, enforce ownership in both `USING` and `WITH CHECK`, preventing a row from being moved to another farm. Composite FKs independently prevent cross-farm references.

| Table(s) | SELECT | INSERT | UPDATE | DELETE |
|---|---|---|---|---|
| `profiles` | Own `id = auth.uid()` | Auth trigger only; no client insert policy | Own row; only `display_name` can change | No client delete policy; account lifecycle remains in Auth |
| `farms` | `owner_id = auth.uid()` | Only with `owner_id = auth.uid()` | Owner only; immutable owner enforced by trigger and `WITH CHECK` | No client delete policy in v1 |
| `counterparties`, `animals`, `poultry_batches` | Owner of `farm_id` | Owner of selected farm | Owner of same farm; same-farm and role/parent rules still apply | No client delete policy in v1; preserve references and history |
| `inventory_items` | Owner of `farm_id` | Owner of selected farm | Owner of same farm; item history/category/unit/active rules still apply | No client delete policy; retire eligible items instead |
| `poultry_batch_events`, `health_records`, `breeding_events`, `inventory_consumptions`, `inventory_adjustments`, `production_records` | Owner of `farm_id` | Owner of selected farm, subject to source rules; a treatment with a medicine item must use `record_treatment` | Owner of same farm, subject to balance/state/linkage triggers; direct updates cannot create or alter a medicine-linked treatment | No direct client delete policy; use a separately approved correction workflow |
| `purchases`, `purchase_lines`, `sales`, `sale_lines`, `expenses`, `payments` | Owner of `farm_id` | `purchases`, `purchase_lines`, `sales`, `sale_lines`, and `payments`: RPC only; `expenses`: owner insert only | No direct client update policy for any posted financial record | No direct client delete policy for any posted financial record |
| `tasks` | Owner of `farm_id` | Owner of selected farm | Owner of same farm | Owner of same farm |

### Explicit table and function privileges

Start by revoking application-table and application-function privileges from `PUBLIC`, `anon`, and `authenticated`, then grant only the entries below. Keep RLS enabled; a table grant is not an ownership policy. `authenticated` receives `SELECT` on application tables and approved views, with RLS limiting returned rows to the caller's farms. Do not grant application-table privileges to `anon`. The privilege grants are table/column-level; conditional distinctions such as medicine-linked treatment inserts are enforced by the corresponding RLS `WITH CHECK` policy and database validation.

| Authenticated role privilege | Tables |
|---|---|
| `SELECT` | All application tables and approved views; always subject to RLS |
| `INSERT` | `farms`, `counterparties`, `animals`, `poultry_batches`, `inventory_items`, `poultry_batch_events`, `health_records`, `breeding_events`, `inventory_consumptions`, `inventory_adjustments`, `production_records`, `expenses`, `tasks`; subject to matching RLS and database validations |
| `UPDATE` | `farms`, `counterparties`, `animals`, `poultry_batches`, `inventory_items`, `poultry_batch_events`, `health_records`, `breeding_events`, `inventory_consumptions`, `production_records`, `tasks`; subject to matching RLS and database validations. Grant profile update only on `profiles.display_name`, not other columns. |
| `DELETE` | `tasks` only in v1 |
| No direct `INSERT`, `UPDATE`, or `DELETE` | `purchases`, `purchase_lines`, `sales`, `sale_lines`, `payments`, `expenses` for update/delete, `inventory_adjustments` for update/delete, and other tables not listed for that operation |

The `health_records` INSERT/UPDATE RLS policies must reject a direct insert or update whose new row is a treatment with `medicine_item_id` set; the UPDATE policy must also prevent direct editing of an existing such row. This conditional row rule is enforced by RLS, not by a column-specific SQL privilege. Financial headers, lines, and payments are posted when created; there is no draft state in the approved schema. Consequently, the client can read them but cannot directly update or delete them. `expenses` may be inserted as a single transaction but cannot be edited or deleted after posting. Table privileges and RLS policies must agree; do not add a permissive policy where the corresponding table privilege is intentionally absent.

Grant `EXECUTE` on only these caller-facing RPCs to `authenticated`: `create_sale`, `create_purchase`, `record_payment`, and `record_treatment`. Revoke their execution from `PUBLIC` and `anon`. Trigger-only functions, internal validation helpers, and migration helpers receive no client `EXECUTE` grant. Do not grant users direct DML on the tables written by the sale, purchase, or payment RPCs.

The RPCs that write protected tables must be narrowly scoped `SECURITY DEFINER` functions because their callers intentionally lack direct table-write privileges. Pin a safe `search_path`, schema-qualify all objects, reject a null `auth.uid()`, derive/check the owner of the requested farm, verify every supplied row belongs to that farm, and validate all business rules inside the same transaction. Do not assume RLS will filter a `SECURITY DEFINER` function: its owner may bypass RLS. RLS remains the guard for direct client table access; explicit caller/farm checks and tightly limited table/function grants guard the privileged RPC path. Prefer `SECURITY INVOKER` for functions that do not need to write tables whose client DML is revoked. The Auth profile trigger is a separate, narrowly scoped system trigger and is not callable by clients.

For views, use PostgreSQL `security_invoker` so underlying RLS applies. If the deployed Supabase Postgres version or a view feature does not support this safely, do not expose that view until an equally safe caller/farm-checking design is reviewed and tested. Never rely on default owner-privileged view behavior.

### Owner-isolation tests

Use two test users and at least two farms. Test SELECT, INSERT, UPDATE, DELETE for every table's intended policy. Verify that changing `farm_id`, supplying another farm's row ID, guessing a UUID, and querying a view cannot expose or mutate another owner's data.

## 7. Required triggers, functions, and transaction rules

### Authentication and shared helpers

- After an Auth user is created, insert `profiles(id)` with a narrowly scoped `SECURITY DEFINER` trigger. Pin a safe `search_path`, use schema-qualified objects, and grant no broader access than needed.
- A timestamp trigger updates `updated_at` on the four editable master tables.
- Validate timezone values against PostgreSQL timezone names.
- Counterparty reference-validation triggers lock the party row before checking its role. Role updates hold the same lock while checking existing sales, purchases, and expenses, preventing concurrent reference creation from invalidating the role.
- Apply the caller-facing RPC privilege and security rules in Section 6. In particular, `SECURITY DEFINER` functions must not rely on table RLS for tenant isolation.

### Inventory balance and availability

`inventory_balances` is derived from source rows, not maintained separately:

1. Build movement rows with `UNION ALL`:
   - purchase line: `+quantity`;
   - production record: `+quantity`;
   - inventory adjustment: signed `quantity_change`;
   - inventory consumption: `-quantity`;
   - product sale line: `-quantity`.
2. Aggregate by `(farm_id,item_id)`.
3. Left join the aggregate to all `inventory_items`, using zero for items with no movements.

Before any movement insert/update/delete that can reduce stock, lock the relevant inventory item row(s) in stable ID order, calculate the projected balance including the pending change, and reject negative stock. The same lock is used by item category/unit edits and active-state changes. A transaction that fails must return a visible error; do not clamp to zero or report success. Ensure purchases, production, adjustments, consumptions, and product sales all invoke the same invariant.

### Sale/purchase transactions and payment balances

- `create_sale` and `create_purchase` RPCs validate farm ownership, role/source/item rules, and non-empty lines, then insert the header and lines in one transaction. Deferred constraint triggers reject a header with no lines at commit, including writes outside the RPC.
- `record_payment` validates exactly one target, locks the target document row, calculates the current amount from lines/expense and the sum of existing payments, and rejects an overpayment. Document-line edits lock the same document row so a payment cannot race a reduction of the document total.
- No direct client INSERT/UPDATE/DELETE privilege exists for sales, sale lines, purchases, purchase lines, or payments. Only their RPCs can create those posted records; no correction/void RPC is approved yet.
- Sale totals are `SUM(quantity * unit_price)`. Purchase totals are `SUM(quantity * unit_cost)`. Expense total is its `amount`. Payment balances are each document's total less payments for that target, aggregated separately to avoid join fan-out.
- Receivables and payables are current outstanding balances, not date-range snapshots. No refund/negative-payment workflow is included.

### Treatment medicine and stock consumption

- When a treatment records medicine actually administered, the treatment workflow must capture a positive quantity in the inventory item's base unit. `record_treatment` inserts the `health_records` row and, when a medicine item and quantity are supplied, exactly one linked `inventory_consumptions` row in the same transaction.
- The quantity is stored on the inventory-consumption transaction only; do not also add a quantity movement to the health record or count health records as inventory movements. `inventory_balances` deducts the linked consumption once through its existing `inventory_consumptions` source.
- The RPC validates that the item is a same-farm `medicine`, that the linked health record is a `treatment` with the same animal/batch source and date, and that item plus positive quantity are supplied together. A partial unique index on the linked health record prevents duplicate consumption rows. The normal stock lock/check applies before commit.
- Health records that represent treatment and identify a medicine are created through `record_treatment`; direct INSERT and UPDATE policies must reject that combination. The RPC requires the medicine item and positive quantity together and creates the stock movement in the same transaction. Treatment without stock consumption may omit the medicine item and use the ordinary health-record workflow. The UI presents medicine and quantity together and submits once, avoiding a second manual consumption entry.

### Animal status and poultry concurrency

- Animal status is calculated: `dead` if a death health event exists, `sold` if a sale line exists, otherwise `active`. Do not store a status column.
- Add the partial unique sale index on `(farm_id,animal_id)` for non-null animal IDs and a partial unique death index on `(farm_id,animal_id)` for death events.
- Before inserting/updating an animal sale line or death event, lock the animal row and validate that the other terminal state does not exist. Recheck on updates. The multi-animal sale operation locks animal IDs in stable order. Normal app routes do not delete terminal events.
- Before a poultry sale or count event, lock the batch row, calculate `initial_count + all event changes - all sold-bird quantities + pending change`, and reject a negative count. Multi-batch operations lock batch IDs in stable order. Insert and validation must be in the same database transaction. A database check on each batch sale line rejects fractional bird quantities before the transaction can commit.
- A health record links exactly one animal or batch. A breeding event uses same-farm dam/sire references and links offspring through animal parent IDs.

## 8. Calculated views

All views are read-only and expose `farm_id`.

| View | Calculation |
|---|---|
| `inventory_balances` | `UNION ALL` the five movement sources above, aggregate by farm/item, then left join from every inventory item and coalesce missing totals to zero. This preserves zero-balance items. |
| `poultry_batch_balances` | Aggregate events and batch-sale quantities separately by farm/batch; left join each aggregate to every batch; compute initial count + events − sold birds. Do not join raw event and sale rows together before aggregation. |
| `animal_status` | Death event takes precedence only as a defensive display rule; database validation prevents an animal from being both dead and sold. Otherwise derive sold from a sale line, else active. |
| `sale_totals` | Aggregate sale lines by farm/sale. |
| `purchase_totals` | Aggregate purchase lines by farm/purchase. |
| `payment_balances` | Aggregate line/document totals and payments separately per target, then subtract. Balances are current, all-date values. |

Use `WITH (security_invoker = true)` for PostgreSQL views and test access with authenticated users from different farms. Verify deployed PostgreSQL support before implementation. The migration/inspection process must account for the fact that legacy Supabase migration diff engines may not preserve `security_invoker`; review generated SQL and test the actual view option before accepting a migration.

### Dashboard and finance date rules

- Sales totals use `sales.sold_on`; purchase totals use `purchases.purchased_on`; operating expenses use `expenses.spent_on`.
- Cash received and cash paid use `payments.paid_on` (sale-target payments are receipts; purchase/expense-target payments are payments).
- Receivables and payables are current outstanding balances across all dates, not period-filtered. A dashboard date filter does not change those balances.
- Do not label sales less purchases/expenses as profit. Inventory valuation/cost-of-goods-sold and the approved-excluded livestock acquisition costs are not represented.

## 9. Migration history and safe Supabase CLI workflow

### Current state and limits

- The local repo has no `supabase/config.toml` and no local migration files.
- The user reports four old remote ledger entries remain after the reset. This plan does not know their four version IDs or names and has not read the remote ledger or schema.
- Do not query or change the remote project as part of this task. Do not edit `supabase_migrations.schema_migrations` directly. Do not delete the four entries in bulk or assume they are stale solely because a reset occurred.

### Safe future reconciliation

1. **Prepare locally first.** After approval to implement, pin/install the Supabase CLI, run `supabase init` to create local configuration, and create/test the new migration set locally. Do not link to remote yet. Keep old application code out of the repo.
2. **Identify the exact remote entries.** With explicit authorization, link the intended project and use the pinned CLI's `supabase migration list` to compare local and remote versions. Record all four remote version/name pairs and the local version list in a review note. Do not infer the remote versions from old application files or guess timestamps.
3. **Inspect before repairing.** Recover/read the corresponding old migration definitions if available, then compare what each would have created with a read-only schema-only inspection of the current remote database (for example, the CLI's `db dump --remote` workflow). Also verify that expected custom policies/functions/extensions are not being overlooked. The reported reset is not proof that every effect of every migration was removed.
4. **Choose per entry, not as a batch.**
   - If a version's schema effects are confirmed absent and the entry is only stale history, document the evidence and obtain explicit owner approval to reconcile that exact version with the supported CLI `supabase migration repair --status reverted <version>` workflow.
   - If any effect remains, or the state is uncertain, do not mark it reverted. Recover its original migration file if appropriate or design a reviewed forward reconciliation. Do not create empty placeholder migrations merely to make version lists appear aligned.
   - If original migration content cannot be recovered, treat that as an open risk; do not fabricate historical SQL or reintroduce old application code.
5. **Keep a before/after record.** Save the reviewed list of versions and CLI output in the project's change record (not secrets). Check the CLI help for the pinned version and verify its target is the intended project before any `migration repair`; repair changes the migration ledger even though it does not apply schema SQL.
6. **Preview new migrations.** After the per-entry decision, run local `supabase db reset` only against the local stack and test from an empty local database. Once the remote reconciliation is approved, use `supabase db push --dry-run` to review precisely which migrations would be applied. Only a separately authorized, interactive `supabase db push --remote` should apply them.

### CLI operations to avoid for inspection

- Do not use direct SQL `DELETE`/`INSERT` against Supabase's internal migration ledger.
- Do not run `supabase db reset --remote`; it is destructive.
- Do not use `supabase db pull --remote` or `supabase pull` as a read-only inspection step. The current CLI documentation states the database pull workflow updates remote migration history.
- Do not run `db push`, `migration repair`, or remote-target commands during planning. This task has not run any CLI command against Supabase.

## 10. Tests and acceptance criteria

### Database tests

1. **Clean build:** initialize a local Supabase stack and apply all new migrations from an empty local database. Verify a second local reset is repeatable.
2. **Auth/profile:** Auth signup creates exactly one profile; users can read/update only their own profile.
3. **Farm isolation:** with two users and multiple farms, test SELECT/INSERT/UPDATE/DELETE on every table; cross-farm IDs and farm reassignment fail; anonymous access fails. Repeat through views and RPCs.
4. **Constraints:** test required fields, finite values, composite same-farm FKs, duplicate tags/item names, invalid source/target combinations, wrong counterparty role, invalid medicine/product category, fractional poultry sale quantities, invalid task completion values, and future acquisition dates.
5. **Inventory calculations:** verify receipt, production, positive/negative adjustment, consumption, and product sale signs. Verify exact totals, zero-balance items, edits/deletes if allowed, and no negative balance.
6. **Inventory concurrency:** run two simultaneous consumptions/sales whose sum exceeds available stock. At most the stock-available amount can commit; the other request receives a clear error.
7. **Poultry:** verify starting count, deaths, additions, corrections, and batch sales; confirm the view keeps zero-count batches. Concurrent count/sale requests cannot overdraw a batch.
8. **Animal status:** verify active → sold and active → dead; reject duplicate sales, duplicate death records, sale of dead animals, and death of sold animals. Race sale vs death and confirm only one transition commits.
9. **Sales and purchases:** document headers cannot commit without lines; calculated totals match line sums; all references are same-farm; stock and animal/batch changes are atomic with the document.
10. **Payments:** test partial, exact, and excessive payments for sales, purchases, and expenses; balances reconcile. Concurrent payments cannot overpay. A document-total edit cannot race a payment into an invalid balance.
11. **Item changes and party roles:** name/reorder edits work; category/unit edits fail after history exists; inactive items cannot be used and can only be retired at zero balance. Role changes that invalidate historical documents fail, including concurrent role-change/reference creation.
12. **Views:** compare every view against independently aggregated source rows for multiple farms; confirm RLS isolation and no multiplication from joins.
13. **Privileges:** verify only intended roles have table/view/function privileges; confirm direct INSERT/UPDATE/DELETE on sales, sale lines, purchases, purchase lines, and payments is denied while their authorized RPCs succeed. Verify posted expenses cannot be directly updated/deleted, `record_treatment` is executable only by `authenticated`, trigger/internal functions are not client-executable, and the frontend role has no service-role credentials.
14. **Treatment inventory:** record a treatment with medicine and quantity and verify one linked consumption movement reduces stock exactly once; reject missing/zero quantity, wrong-farm or non-medicine items, duplicate linked consumption, and insufficient stock. A treatment without a stock quantity creates no inventory movement.

### Acceptance before frontend development

- All approved tables and fields above are implemented by reviewed local migrations; no livestock acquisition-cost fields/accounting are present.
- Every operational FK uses the same-farm composite key where applicable; indexes, checks, RLS, triggers, and functions pass tests.
- All exposed tables deny anonymous access and isolate farm owners; calculated views preserve RLS. Explicit grants deny direct writes to posted sales, purchases, and payments, and the approved RPCs enforce ownership and atomic validation.
- Stock, flock counts, animal status, document totals, and payment balances reconcile under both normal and concurrent writes.
- A local empty-database build and repeat reset pass; database tests and RLS tests pass.
- The remote-ledger discrepancy has a documented per-version disposition, based on actual version IDs and verified schema state, before any remote push.
- Open decisions in Section 11 that affect frontend workflows are resolved before those workflows are implemented.

## 11. Open questions and required verification

1. **Remote history details:** What are the exact four remote migration version IDs/names, and can their original SQL be recovered? They were not visible locally and were not inspected remotely.
2. **Remote post-reset state:** Which application objects, custom functions, policies, extensions, or other changes remain on the remote database? Verify with owner-authorized read-only inspection before selecting any repair status.
3. **CLI and Postgres versions:** Which Supabase CLI version will be pinned, and which PostgreSQL version does the project use? Confirm migration command syntax and `security_invoker` view support before writing migrations.
4. **Posted-record correction/void workflow:** No audited correction or void workflow is approved. Until one is designed and approved, posted financial records cannot be directly updated or deleted by clients; no correction RPC is exposed. Any later workflow must preserve the original record and record an auditable correction rather than silently rewriting history.
5. **Remote repair authorization:** Marking even one old ledger entry reverted is a remote history mutation. The owner must approve the exact versions and evidence after review; this plan grants no such authorization.
6. **Livestock tag generation:** The approved architecture specifies an optional user-entered `tag_code` and generated database UUIDs, but does not specify system-generated, lineage-based livestock tags. Confirm whether such tags are wanted in a future scope; V1 does not generate tags from parentage or lineage unless explicitly approved.
7. **Architecture-spec sync:** The architecture spec currently describes medicine selection and inventory consumption as separate V1 actions. This plan now specifies a single atomic treatment-plus-consumption workflow when medicine and quantity are recorded; reconcile that documentation before frontend or migration implementation. This task did not modify the architecture spec.

No unresolved livestock-cost question remains: the user approved excluding `acquisition_type`, `purchase_cost`, and livestock acquisition-cost accounting from V1.
