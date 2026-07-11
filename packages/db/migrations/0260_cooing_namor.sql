ALTER TABLE "workspace" ADD COLUMN "storage_used_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "workspace" ADD CONSTRAINT "workspace_storage_used_bytes_non_negative" CHECK ("workspace"."storage_used_bytes" >= 0) NOT VALID;--> statement-breakpoint
CREATE OR REPLACE FUNCTION "transfer_workspace_storage_on_payer_change"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	old_payer_key text;
	new_payer_key text;
	old_payer_exists boolean := true;
	affected_rows integer;
BEGIN
	old_payer_key := CASE
		WHEN OLD.organization_id IS NOT NULL THEN 'organization:' || OLD.organization_id
		ELSE 'user:' || OLD.billed_account_user_id
	END;
	new_payer_key := CASE
		WHEN NEW.organization_id IS NOT NULL THEN 'organization:' || NEW.organization_id
		ELSE 'user:' || NEW.billed_account_user_id
	END;

	IF old_payer_key = new_payer_key
		OR (OLD.storage_used_bytes = 0 AND NEW.storage_used_bytes = 0) THEN
		RETURN NEW;
	END IF;

	PERFORM pg_advisory_xact_lock(
		hashtextextended('workspace-storage-payer:' || LEAST(old_payer_key, new_payer_key), 0)
	);
	PERFORM pg_advisory_xact_lock(
		hashtextextended('workspace-storage-payer:' || GREATEST(old_payer_key, new_payer_key), 0)
	);

	IF OLD.organization_id IS NOT NULL THEN
		SELECT EXISTS(SELECT 1 FROM organization WHERE id = OLD.organization_id)
		INTO old_payer_exists;
		IF old_payer_exists THEN
			UPDATE organization
			SET storage_used_bytes = storage_used_bytes - OLD.storage_used_bytes
			WHERE id = OLD.organization_id
				AND storage_used_bytes >= OLD.storage_used_bytes;
		END IF;
	ELSE
		UPDATE user_stats
		SET storage_used_bytes = storage_used_bytes - OLD.storage_used_bytes
		WHERE user_id = OLD.billed_account_user_id
			AND storage_used_bytes >= OLD.storage_used_bytes;
	END IF;

	GET DIAGNOSTICS affected_rows = ROW_COUNT;
	IF old_payer_exists AND affected_rows <> 1 THEN
		RAISE EXCEPTION
			'Cannot transfer workspace % storage: payer % is missing or below % bytes',
			NEW.id,
			old_payer_key,
			OLD.storage_used_bytes;
	END IF;

	IF NEW.organization_id IS NOT NULL THEN
		UPDATE organization
		SET storage_used_bytes = storage_used_bytes + NEW.storage_used_bytes
		WHERE id = NEW.organization_id;
	ELSE
		UPDATE user_stats
		SET storage_used_bytes = storage_used_bytes + NEW.storage_used_bytes
		WHERE user_id = NEW.billed_account_user_id;
	END IF;

	GET DIAGNOSTICS affected_rows = ROW_COUNT;
	IF affected_rows <> 1 THEN
		RAISE EXCEPTION 'Cannot transfer workspace % storage: payer % is missing', NEW.id, new_payer_key;
	END IF;

	RETURN NEW;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workspace_storage_payer_transfer"
AFTER UPDATE OF "organization_id", "billed_account_user_id" ON "workspace"
FOR EACH ROW
WHEN (
	OLD.organization_id IS DISTINCT FROM NEW.organization_id
	OR OLD.billed_account_user_id IS DISTINCT FROM NEW.billed_account_user_id
)
EXECUTE FUNCTION "transfer_workspace_storage_on_payer_change"();--> statement-breakpoint
CREATE OR REPLACE FUNCTION "subtract_workspace_storage_on_delete"()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
	payer_key text;
	payer_exists boolean;
	affected_rows integer;
BEGIN
	IF OLD.storage_used_bytes = 0 THEN
		RETURN OLD;
	END IF;

	payer_key := CASE
		WHEN OLD.organization_id IS NOT NULL THEN 'organization:' || OLD.organization_id
		ELSE 'user:' || OLD.billed_account_user_id
	END;
	PERFORM pg_advisory_xact_lock(hashtextextended('workspace-storage-payer:' || payer_key, 0));

	IF OLD.organization_id IS NOT NULL THEN
		SELECT EXISTS(SELECT 1 FROM organization WHERE id = OLD.organization_id)
		INTO payer_exists;
		IF payer_exists THEN
			UPDATE organization
			SET storage_used_bytes = storage_used_bytes - OLD.storage_used_bytes
			WHERE id = OLD.organization_id
				AND storage_used_bytes >= OLD.storage_used_bytes;
		END IF;
	ELSE
		SELECT EXISTS(SELECT 1 FROM user_stats WHERE user_id = OLD.billed_account_user_id)
		INTO payer_exists;
		IF payer_exists THEN
			UPDATE user_stats
			SET storage_used_bytes = storage_used_bytes - OLD.storage_used_bytes
			WHERE user_id = OLD.billed_account_user_id
				AND storage_used_bytes >= OLD.storage_used_bytes;
		END IF;
	END IF;

	GET DIAGNOSTICS affected_rows = ROW_COUNT;
	IF payer_exists AND affected_rows <> 1 THEN
		RAISE EXCEPTION
			'Cannot delete workspace % storage: payer % is below % bytes',
			OLD.id,
			payer_key,
			OLD.storage_used_bytes;
	END IF;

	RETURN OLD;
END;
$$;--> statement-breakpoint
CREATE TRIGGER "workspace_storage_workspace_delete"
BEFORE DELETE ON "workspace"
FOR EACH ROW
EXECUTE FUNCTION "subtract_workspace_storage_on_delete"();