-- FarmPro identity and farm foundation.
-- PostgreSQL 17 / Supabase. This migration is intentionally un-applied.

-- Establish the approved default for both PostgREST's login role and the
-- effective application role. Statement guards below reject other levels.
ALTER ROLE authenticator SET default_transaction_isolation = 'read committed';
ALTER ROLE authenticated SET default_transaction_isolation = 'read committed';

CREATE SCHEMA IF NOT EXISTS private;
REVOKE ALL ON SCHEMA private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE public.profiles (
    id uuid PRIMARY KEY REFERENCES auth.users (id) ON DELETE CASCADE,
    display_name text,
    created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT profiles_display_name_trimmed_nonempty CHECK (
        display_name IS NULL OR
        (display_name = pg_catalog.btrim(display_name) AND pg_catalog.char_length(display_name) > 0)
    )
);

CREATE TABLE public.farms (
    id uuid PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
    owner_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE RESTRICT,
    name text NOT NULL,
    currency_code text NOT NULL,
    timezone text NOT NULL,
    created_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
    updated_at timestamp with time zone NOT NULL DEFAULT pg_catalog.now(),
    CONSTRAINT farms_name_trimmed_length CHECK (
        name = pg_catalog.btrim(name)
        AND pg_catalog.char_length(name) BETWEEN 1 AND 120
    ),
    CONSTRAINT farms_currency_code_format CHECK (currency_code ~ '^[A-Z]{3}$'),
    CONSTRAINT farms_timezone_trimmed_nonempty CHECK (
        timezone = pg_catalog.btrim(timezone) AND pg_catalog.char_length(timezone) > 0
    )
);

CREATE INDEX farms_owner_id_idx ON public.farms (owner_id);

-- Auth creates a profile without consulting mutable user metadata. This
-- SECURITY DEFINER trigger function is narrowly scoped to the auth.users
-- insert event and has an empty search path with qualified references.
CREATE FUNCTION private.create_profile_for_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $function$
BEGIN
    INSERT INTO public.profiles (id) VALUES (NEW.id)
    ON CONFLICT (id) DO NOTHING;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.create_profile_for_auth_user() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER on_auth_user_created_create_profile
AFTER INSERT ON auth.users
FOR EACH ROW EXECUTE FUNCTION private.create_profile_for_auth_user();

-- Derive ownership from the authenticated identity on insert. Protect
-- immutable identity/creation fields and maintain the update timestamp.
CREATE FUNCTION private.enforce_farm_owner_and_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
DECLARE
    v_user_id uuid;
BEGIN
    v_user_id := auth.uid();
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'authenticated user is required for farm writes'
            USING ERRCODE = '42501';
    END IF;

    IF TG_OP = 'INSERT' THEN
        NEW.owner_id := v_user_id;
        IF NOT EXISTS (
            SELECT 1 FROM pg_catalog.pg_timezone_names AS tz
            WHERE tz.name = NEW.timezone
        ) THEN
            RAISE EXCEPTION 'timezone must be a recognized PostgreSQL timezone'
                USING ERRCODE = '22023';
        END IF;
    ELSE
        IF NEW.id IS DISTINCT FROM OLD.id
           OR NEW.owner_id IS DISTINCT FROM OLD.owner_id
           OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
            RAISE EXCEPTION 'farm id, owner and creation time are immutable'
                USING ERRCODE = '42501';
        END IF;
        NEW.updated_at := pg_catalog.now();
        IF NEW.timezone IS DISTINCT FROM OLD.timezone
           AND NOT EXISTS (
               SELECT 1 FROM pg_catalog.pg_timezone_names AS tz
               WHERE tz.name = NEW.timezone
           ) THEN
            RAISE EXCEPTION 'timezone must be a recognized PostgreSQL timezone'
                USING ERRCODE = '22023';
        END IF;
    END IF;
    RETURN NEW;
END;
$function$;

REVOKE ALL ON FUNCTION private.enforce_farm_owner_and_fields() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER farms_enforce_owner_and_fields
BEFORE INSERT OR UPDATE ON public.farms
FOR EACH ROW EXECUTE FUNCTION private.enforce_farm_owner_and_fields();

-- READ COMMITTED is required for the approved lock-then-recalculate pattern.
-- Attach as statement guards so direct DML cannot bypass the isolation check.
CREATE FUNCTION private.require_read_committed_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = ''
AS $function$
BEGIN
    IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
        RAISE EXCEPTION 'FarmPro writes require READ COMMITTED isolation'
            USING ERRCODE = '25001';
    END IF;
    RETURN NULL;
END;
$function$;

REVOKE ALL ON FUNCTION private.require_read_committed_write() FROM PUBLIC, anon, authenticated, service_role;

CREATE TRIGGER farms_require_read_committed_dml
BEFORE INSERT OR UPDATE OR DELETE ON public.farms
FOR EACH STATEMENT EXECUTE FUNCTION private.require_read_committed_write();

CREATE TRIGGER farms_require_read_committed_truncate
BEFORE TRUNCATE ON public.farms
FOR EACH STATEMENT EXECUTE FUNCTION private.require_read_committed_write();

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.farms ENABLE ROW LEVEL SECURITY;

CREATE POLICY profiles_select_own
ON public.profiles FOR SELECT TO authenticated
USING (id = (SELECT auth.uid()));

CREATE POLICY profiles_update_own
ON public.profiles FOR UPDATE TO authenticated
USING (id = (SELECT auth.uid()))
WITH CHECK (id = (SELECT auth.uid()));

CREATE POLICY farms_select_owner
ON public.farms FOR SELECT TO authenticated
USING (owner_id = (SELECT auth.uid()));

CREATE POLICY farms_insert_owner
ON public.farms FOR INSERT TO authenticated
WITH CHECK (owner_id = (SELECT auth.uid()));

CREATE POLICY farms_update_owner
ON public.farms FOR UPDATE TO authenticated
USING (owner_id = (SELECT auth.uid()))
WITH CHECK (owner_id = (SELECT auth.uid()));

-- Kept as the owner-scoped policy required by the architecture. No DELETE
-- privilege is granted in this foundation, so the policy alone cannot delete.
CREATE POLICY farms_delete_owner
ON public.farms FOR DELETE TO authenticated
USING (owner_id = (SELECT auth.uid()));

REVOKE ALL ON TABLE public.profiles, public.farms FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.profiles, public.farms TO authenticated;
GRANT UPDATE (display_name) ON TABLE public.profiles TO authenticated;
GRANT INSERT (name, currency_code, timezone) ON TABLE public.farms TO authenticated;
GRANT UPDATE (name, currency_code, timezone) ON TABLE public.farms TO authenticated;

-- Do not install/replace pgrst.db_pre_request here: the existing project hook
-- must first be inspected and composed during deployment configuration.
-- Mutating RPCs added by later migrations must check READ COMMITTED on entry.
