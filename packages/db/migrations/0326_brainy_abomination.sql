-- migration-safe: Relaxes only the nonempty scope requirement for scopeless OAuth providers. All previously valid credentials and old-version inserts remain accepted; required identity and token metadata are unchanged, and canonical provider policy still validates scope sufficiency before use.
ALTER TABLE "credential" DROP CONSTRAINT IF EXISTS "credential_managed_oauth_source_check";--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_managed_oauth_source_check" CHECK ((type::text <> 'managed_oauth') OR (
        account_id IS NULL
        AND provider_id IS NOT NULL
        AND authorization_app_id IS NOT NULL
        AND provider_subject_id IS NOT NULL
        AND managed_oauth_status IS NOT NULL
        AND granted_scopes IS NOT NULL
        AND encrypted_oauth_token_set IS NOT NULL
        AND granted_at IS NOT NULL
      )) NOT VALID;
