CREATE TABLE public.livestock_tag_counters (
  farm_id uuid NOT NULL REFERENCES public.farms(id),
  species text NOT NULL CHECK (species IN ('cow', 'pig', 'goat')),
  scope_key text NOT NULL,
  next_sequence bigint NOT NULL CHECK (next_sequence > 0),
  PRIMARY KEY (farm_id, species, scope_key)
);

CREATE TABLE public.livestock_tag_allocations (
  farm_id uuid NOT NULL REFERENCES public.farms(id),
  tag_number text NOT NULL,
  allocated_at timestamptz NOT NULL DEFAULT now(),
  consumed_at timestamptz,
  PRIMARY KEY (farm_id, tag_number)
);

ALTER TABLE public.livestock_tag_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.livestock_tag_allocations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.livestock_tag_counters FROM anon, authenticated;
REVOKE ALL ON public.livestock_tag_allocations FROM anon, authenticated;
REVOKE ALL ON public.livestock_tag_counters FROM PUBLIC;
REVOKE ALL ON public.livestock_tag_allocations FROM PUBLIC;
REVOKE INSERT ON public.livestock FROM PUBLIC, anon, authenticated;

INSERT INTO public.livestock_tag_allocations (farm_id, tag_number, consumed_at)
SELECT farm_id, tag_number, now()
FROM public.livestock
WHERE farm_id IS NOT NULL AND tag_number IS NOT NULL
ON CONFLICT (farm_id, tag_number) DO NOTHING;

WITH root_tags AS (
  SELECT farm_id, species,
         (regexp_match(tag_number, '^(?:COW|PIG|GOAT)-([0-9]{4,})$'))[1] AS suffix
  FROM public.livestock
  WHERE tag_number ~ '^(COW|PIG|GOAT)-[0-9]{4,}$'
    AND farm_id IS NOT NULL
    AND (species = 'cow' AND tag_number LIKE 'COW-%'
      OR species = 'pig' AND tag_number LIKE 'PIG-%'
      OR species = 'goat' AND tag_number LIKE 'GOAT-%')
), parsed_root_tags AS (
  SELECT farm_id, species,
         CASE
           WHEN nullif(ltrim(suffix, '0'), '') IS NULL THEN 0
           WHEN length(nullif(ltrim(suffix, '0'), '')) < 19
             OR (length(nullif(ltrim(suffix, '0'), '')) = 19
               AND nullif(ltrim(suffix, '0'), '') <= '9223372036854775807')
             THEN nullif(ltrim(suffix, '0'), '')::bigint
         END AS safe_sequence
  FROM root_tags
)
INSERT INTO public.livestock_tag_counters (farm_id, species, scope_key, next_sequence)
SELECT farm_id, species, 'root',
       CASE WHEN coalesce(max(safe_sequence), 0) = 9223372036854775807
         THEN 9223372036854775807
         ELSE coalesce(max(safe_sequence), 0) + 1
       END
FROM parsed_root_tags
GROUP BY farm_id, species
ON CONFLICT (farm_id, species, scope_key)
DO UPDATE SET next_sequence = greatest(livestock_tag_counters.next_sequence, EXCLUDED.next_sequence);

WITH dam_tags AS (
  SELECT offspring.farm_id, offspring.species,
         dam.id AS dam_id,
         substring(offspring.tag_number FROM length(dam.tag_number) + 2) AS suffix
  FROM public.livestock AS offspring
  JOIN public.livestock AS dam
    ON dam.id = offspring.dam_id
   AND dam.farm_id = offspring.farm_id
  WHERE offspring.farm_id IS NOT NULL
    AND offspring.species = dam.species
    AND left(offspring.tag_number, length(dam.tag_number) + 1) = dam.tag_number || '-'
    AND substring(offspring.tag_number FROM length(dam.tag_number) + 2) ~ '^[0-9]+$'
), parsed_dam_tags AS (
  SELECT farm_id, species, dam_id,
         CASE
           WHEN nullif(ltrim(suffix, '0'), '') IS NULL THEN 0
           WHEN length(nullif(ltrim(suffix, '0'), '')) < 19
             OR (length(nullif(ltrim(suffix, '0'), '')) = 19
               AND nullif(ltrim(suffix, '0'), '') <= '9223372036854775807')
             THEN nullif(ltrim(suffix, '0'), '')::bigint
         END AS safe_sequence
  FROM dam_tags
)
INSERT INTO public.livestock_tag_counters (farm_id, species, scope_key, next_sequence)
SELECT farm_id, species, 'dam:' || dam_id::text,
       CASE WHEN coalesce(max(safe_sequence), 0) = 9223372036854775807
         THEN 9223372036854775807
         ELSE coalesce(max(safe_sequence), 0) + 1
       END
FROM parsed_dam_tags
GROUP BY farm_id, species, dam_id
ON CONFLICT (farm_id, species, scope_key)
DO UPDATE SET next_sequence = greatest(livestock_tag_counters.next_sequence, EXCLUDED.next_sequence);

CREATE OR REPLACE FUNCTION public._allocate_livestock_tag(
  p_farm_id uuid,
  p_species text,
  p_dam_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_scope_key text := CASE WHEN p_dam_id IS NULL THEN 'root' ELSE 'dam:' || p_dam_id::text END;
  v_prefix text;
  v_mother_tag text;
  v_sequence bigint;
  v_candidate text;
  v_inserted integer;
BEGIN
  v_prefix := CASE p_species WHEN 'cow' THEN 'COW' WHEN 'pig' THEN 'PIG' WHEN 'goat' THEN 'GOAT' END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unsupported livestock species' USING ERRCODE = '23514';
  END IF;

  IF p_dam_id IS NOT NULL THEN
    SELECT tag_number INTO v_mother_tag
    FROM public.livestock
    WHERE id = p_dam_id
      AND farm_id = p_farm_id
      AND species = p_species
      AND sex = 'female';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mother must be a female of the same species on the selected farm'
        USING ERRCODE = '23514';
    END IF;
  ELSE
    v_mother_tag := v_prefix;
  END IF;

  INSERT INTO public.livestock_tag_counters (farm_id, species, scope_key, next_sequence)
  VALUES (p_farm_id, p_species, v_scope_key, 1)
  ON CONFLICT (farm_id, species, scope_key) DO NOTHING;

  LOOP
    SELECT next_sequence INTO v_sequence
    FROM public.livestock_tag_counters
    WHERE farm_id = p_farm_id AND species = p_species AND scope_key = v_scope_key
    FOR UPDATE;

    IF v_sequence = 9223372036854775807 THEN
      RAISE EXCEPTION 'Livestock tag sequence is exhausted' USING ERRCODE = '22003';
    END IF;

    UPDATE public.livestock_tag_counters
    SET next_sequence = v_sequence + 1
    WHERE farm_id = p_farm_id AND species = p_species AND scope_key = v_scope_key;

    IF p_dam_id IS NULL THEN
      v_candidate := v_mother_tag || '-' || CASE
        WHEN length(v_sequence::text) > 4 THEN v_sequence::text
        ELSE lpad(v_sequence::text, 4, '0')
      END;
    ELSE
      v_candidate := v_mother_tag || '-' || CASE
        WHEN length(v_sequence::text) > 2 THEN v_sequence::text
        ELSE lpad(v_sequence::text, 2, '0')
      END;
    END IF;

    IF EXISTS (
      SELECT 1 FROM public.livestock_tag_allocations
      WHERE farm_id = p_farm_id AND tag_number = v_candidate
    ) OR EXISTS (
      SELECT 1 FROM public.livestock
      WHERE farm_id = p_farm_id AND tag_number = v_candidate
    ) THEN
      CONTINUE;
    END IF;

    INSERT INTO public.livestock_tag_allocations (farm_id, tag_number)
    VALUES (p_farm_id, v_candidate)
    ON CONFLICT (farm_id, tag_number) DO NOTHING;
    GET DIAGNOSTICS v_inserted = ROW_COUNT;
    IF v_inserted = 1 THEN
      RETURN v_candidate;
    END IF;
  END LOOP;
END;
$function$;

CREATE OR REPLACE FUNCTION public.preview_livestock_tag(
  p_farm_id uuid,
  p_species text,
  p_dam_id uuid DEFAULT NULL
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_scope_key text := CASE WHEN p_dam_id IS NULL THEN 'root' ELSE 'dam:' || p_dam_id::text END;
  v_prefix text;
  v_mother_tag text;
  v_sequence bigint;
  v_candidate text;
BEGIN
  IF auth.uid() IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.farms WHERE id = p_farm_id AND owner_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'Farm is unavailable to the authenticated user' USING ERRCODE = '42501';
  END IF;

  v_prefix := CASE p_species WHEN 'cow' THEN 'COW' WHEN 'pig' THEN 'PIG' WHEN 'goat' THEN 'GOAT' END;
  IF v_prefix IS NULL THEN
    RAISE EXCEPTION 'Unsupported livestock species' USING ERRCODE = '23514';
  END IF;
  IF p_dam_id IS NULL THEN
    v_mother_tag := v_prefix;
  ELSE
    SELECT tag_number INTO v_mother_tag
    FROM public.livestock
    WHERE id = p_dam_id AND owner_id = auth.uid() AND farm_id = p_farm_id
      AND species = p_species AND sex = 'female';
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Mother must be a female of the same species on the selected farm'
        USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT next_sequence INTO v_sequence
  FROM public.livestock_tag_counters
  WHERE farm_id = p_farm_id AND species = p_species AND scope_key = v_scope_key;
  v_sequence := coalesce(v_sequence, 1);

  LOOP
    IF v_sequence = 9223372036854775807 THEN
      RAISE EXCEPTION 'Livestock tag sequence is exhausted' USING ERRCODE = '22003';
    END IF;
    IF p_dam_id IS NULL THEN
      v_candidate := v_mother_tag || '-' || CASE
        WHEN length(v_sequence::text) > 4 THEN v_sequence::text
        ELSE lpad(v_sequence::text, 4, '0')
      END;
    ELSE
      v_candidate := v_mother_tag || '-' || CASE
        WHEN length(v_sequence::text) > 2 THEN v_sequence::text
        ELSE lpad(v_sequence::text, 2, '0')
      END;
    END IF;
    EXIT WHEN NOT EXISTS (
      SELECT 1 FROM public.livestock_tag_allocations
      WHERE farm_id = p_farm_id AND tag_number = v_candidate
    ) AND NOT EXISTS (
      SELECT 1 FROM public.livestock
      WHERE farm_id = p_farm_id AND tag_number = v_candidate
    );
    v_sequence := v_sequence + 1;
  END LOOP;

  RETURN v_candidate;
END;
$function$;

CREATE OR REPLACE FUNCTION public.create_livestock_with_tag(
  p_farm_id uuid,
  p_species text,
  p_name text,
  p_breed text,
  p_sex text,
  p_date_of_birth date,
  p_acquired_on date,
  p_acquisition_type text,
  p_purchase_cost numeric,
  p_weight_kg numeric,
  p_status text,
  p_dam_id uuid,
  p_sire_id uuid,
  p_notes text
)
RETURNS public.livestock
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_owner_id uuid := auth.uid();
  v_tag_number text;
  v_record public.livestock;
BEGIN
  IF v_owner_id IS NULL OR NOT EXISTS (
    SELECT 1 FROM public.farms WHERE id = p_farm_id AND owner_id = v_owner_id
  ) THEN
    RAISE EXCEPTION 'Farm is unavailable to the authenticated user' USING ERRCODE = '42501';
  END IF;
  IF p_species NOT IN ('cow', 'pig', 'goat') THEN
    RAISE EXCEPTION 'Unsupported livestock species' USING ERRCODE = '23514';
  END IF;
  IF p_acquisition_type = 'born_on_farm' AND p_dam_id IS NULL THEN
    RAISE EXCEPTION 'Select the mother for an animal born on the farm' USING ERRCODE = '23514';
  END IF;

  IF p_dam_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.livestock
    WHERE id = p_dam_id AND owner_id = v_owner_id AND farm_id = p_farm_id
      AND species = p_species AND sex = 'female'
  ) THEN
    RAISE EXCEPTION 'Mother must be a female of the same species on the selected farm'
      USING ERRCODE = '23514';
  END IF;
  IF p_sire_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.livestock
    WHERE id = p_sire_id AND owner_id = v_owner_id AND farm_id = p_farm_id
      AND species = p_species AND sex = 'male'
  ) THEN
    RAISE EXCEPTION 'Father must be a male of the same species on the selected farm'
      USING ERRCODE = '23514';
  END IF;

  v_tag_number := public._allocate_livestock_tag(p_farm_id, p_species, p_dam_id);
  INSERT INTO public.livestock (
    owner_id, farm_id, species, tag_number, name, breed, sex, date_of_birth,
    acquired_on, acquisition_type, purchase_cost, weight_kg, status, dam_id, sire_id, notes
  ) VALUES (
    v_owner_id, p_farm_id, p_species, v_tag_number, p_name, p_breed, p_sex,
    p_date_of_birth, p_acquired_on, p_acquisition_type, coalesce(p_purchase_cost, 0),
    p_weight_kg, coalesce(p_status, 'active'), p_dam_id, p_sire_id, p_notes
  )
  RETURNING * INTO v_record;

  RETURN v_record;
END;
$function$;

CREATE OR REPLACE FUNCTION public.validate_livestock_lineage()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public
AS $function$
DECLARE
  v_has_cycle boolean;
  v_validate_lineage boolean;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.tag_number IS DISTINCT FROM OLD.tag_number THEN
      RAISE EXCEPTION 'Livestock tags cannot be changed after assignment' USING ERRCODE = '23514';
    END IF;
    IF NEW.id IS DISTINCT FROM OLD.id
      OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
      OR NEW.farm_id IS DISTINCT FROM OLD.farm_id THEN
      RAISE EXCEPTION 'Livestock identity and farm ownership cannot be changed' USING ERRCODE = '23514';
    END IF;
    v_validate_lineage := NEW.acquisition_type IS DISTINCT FROM OLD.acquisition_type
      OR NEW.dam_id IS DISTINCT FROM OLD.dam_id
      OR NEW.sire_id IS DISTINCT FROM OLD.sire_id
      OR NEW.species IS DISTINCT FROM OLD.species
      OR NEW.sex IS DISTINCT FROM OLD.sex;
  ELSE
    v_validate_lineage := true;
  END IF;

  IF v_validate_lineage THEN
    PERFORM 1 FROM public.farms WHERE id = NEW.farm_id FOR UPDATE;
  END IF;

  IF TG_OP = 'INSERT' AND auth.uid() IS NOT NULL AND (
    NEW.owner_id IS DISTINCT FROM auth.uid()
    OR NOT EXISTS (
      SELECT 1 FROM public.farms WHERE id = NEW.farm_id AND owner_id = auth.uid()
    )
  ) THEN
    RAISE EXCEPTION 'Farm is unavailable to the authenticated user' USING ERRCODE = '42501';
  END IF;

  IF v_validate_lineage THEN
    IF NEW.acquisition_type = 'born_on_farm' AND NEW.dam_id IS NULL THEN
      RAISE EXCEPTION 'Select the mother for an animal born on the farm' USING ERRCODE = '23514';
    END IF;

    IF NEW.dam_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.livestock
      WHERE id = NEW.dam_id AND id <> NEW.id AND owner_id = NEW.owner_id AND farm_id = NEW.farm_id
        AND species = NEW.species AND sex = 'female'
    ) THEN
      RAISE EXCEPTION 'Mother must be a female of the same species on the selected farm'
        USING ERRCODE = '23514';
    END IF;
    IF NEW.sire_id IS NOT NULL AND NOT EXISTS (
      SELECT 1 FROM public.livestock
      WHERE id = NEW.sire_id AND id <> NEW.id AND owner_id = NEW.owner_id AND farm_id = NEW.farm_id
        AND species = NEW.species AND sex = 'male'
    ) THEN
      RAISE EXCEPTION 'Father must be a male of the same species on the selected farm'
        USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.livestock offspring
      WHERE offspring.dam_id = NEW.id
        AND (offspring.farm_id IS DISTINCT FROM NEW.farm_id
          OR offspring.owner_id IS DISTINCT FROM NEW.owner_id
          OR offspring.species IS DISTINCT FROM NEW.species
          OR NEW.sex IS DISTINCT FROM 'female')
    ) OR EXISTS (
      SELECT 1 FROM public.livestock offspring
      WHERE offspring.sire_id = NEW.id
        AND (offspring.farm_id IS DISTINCT FROM NEW.farm_id
          OR offspring.owner_id IS DISTINCT FROM NEW.owner_id
          OR offspring.species IS DISTINCT FROM NEW.species
          OR NEW.sex IS DISTINCT FROM 'male')
    ) THEN
      RAISE EXCEPTION 'Changes would invalidate existing offspring relationships' USING ERRCODE = '23514';
    END IF;

    WITH RECURSIVE ancestors(id) AS (
      SELECT parent_id
      FROM (VALUES (NEW.dam_id), (NEW.sire_id)) AS parents(parent_id)
      WHERE parent_id IS NOT NULL
      UNION
      SELECT parent_id
      FROM ancestors AS ancestor
      JOIN public.livestock AS parent ON parent.id = ancestor.id
      CROSS JOIN LATERAL (VALUES (parent.dam_id), (parent.sire_id)) AS parents(parent_id)
      WHERE parent_id IS NOT NULL
    )
    SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO v_has_cycle;
    IF v_has_cycle THEN
      RAISE EXCEPTION 'Parent relationship would create a circular lineage' USING ERRCODE = '23514';
    END IF;
  END IF;

  IF TG_OP = 'INSERT' THEN
    UPDATE public.livestock_tag_allocations
    SET consumed_at = now()
    WHERE farm_id = NEW.farm_id AND tag_number = NEW.tag_number
      AND consumed_at IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM public.livestock
        WHERE farm_id = NEW.farm_id AND tag_number = NEW.tag_number
      );
    IF NOT FOUND THEN
      RAISE EXCEPTION 'New livestock tags must be uniquely allocated by the database function'
        USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER livestock_validate_lineage
BEFORE INSERT OR UPDATE
ON public.livestock
FOR EACH ROW EXECUTE FUNCTION public.validate_livestock_lineage();

REVOKE ALL ON FUNCTION public._allocate_livestock_tag(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.validate_livestock_lineage() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.preview_livestock_tag(uuid, text, uuid) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.create_livestock_with_tag(uuid, text, text, text, text, date, date, text, numeric, numeric, text, uuid, uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.preview_livestock_tag(uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_livestock_with_tag(uuid, text, text, text, text, date, date, text, numeric, numeric, text, uuid, uuid, text) TO authenticated;
