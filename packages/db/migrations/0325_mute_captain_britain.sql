-- migration-safe: Replaces the check with a strict superset that permits enrollment links; all previously valid rows and old-version inserts remain accepted, and every token identity/secret invariant is retained.
ALTER TABLE "credential" DROP CONSTRAINT IF EXISTS "credential_personal_token_source_check";--> statement-breakpoint
ALTER TABLE "credential" ADD CONSTRAINT "credential_personal_token_source_check" CHECK ((type::text <> 'personal_token') OR (
        created_by IS NOT NULL
        AND provider_id IS NOT NULL
        AND provider_id = 'gitlab'
        AND provider_subject_id IS NOT NULL
        AND provider_tenant_id IS NOT NULL
        AND encrypted_personal_token IS NOT NULL
        AND granted_scopes IS NOT NULL
        AND cardinality(granted_scopes) > 0
        AND account_id IS NULL
        AND env_key IS NULL
        AND env_owner_user_id IS NULL
        AND authorization_app_id IS NULL
        AND encrypted_oauth_token_set IS NULL
        AND encrypted_service_account_key IS NULL
        AND unredacted = false
      )) NOT VALID;
--> statement-breakpoint
DO $$
DECLARE
  token_ids text[];
  last_id text := '';
BEGIN
  LOOP
    SELECT array_agg(id ORDER BY id), max(id) INTO token_ids, last_id
    FROM (
      SELECT id FROM credential
      WHERE type::text = 'personal_token' AND credential_group_enrollment_id IS NULL
        AND id > last_id
      ORDER BY id LIMIT 100
    ) batch;
    EXIT WHEN token_ids IS NULL;

    INSERT INTO credential_group_enrollment (
      id, credential_group_id, email, status, invitation_token_hash,
      invitation_expires_at, invited_at, created_at, updated_at
    )
    SELECT gen_random_uuid()::text, candidate.group_id, candidate.email, 'in_progress',
      encode(sha256(convert_to(gen_random_uuid()::text, 'UTF8')), 'hex'),
      now(), now(), now(), now()
    FROM (
      SELECT DISTINCT g.id AS group_id, lower(btrim(u.email)) AS email
      FROM credential c
      JOIN credential_group g ON g.workspace_id = c.workspace_id
      JOIN "user" u ON u.id = c.created_by AND u.email_verified = true
      WHERE c.id = ANY(token_ids)
    ) candidate
    ON CONFLICT (credential_group_id, email) DO NOTHING;

    UPDATE credential c SET credential_group_enrollment_id = e.id
    FROM credential_group g, credential_group_enrollment e, "user" u
    WHERE c.id = ANY(token_ids) AND c.credential_group_enrollment_id IS NULL
      AND g.workspace_id = c.workspace_id AND e.credential_group_id = g.id
      AND u.id = c.created_by AND u.email_verified = true
      AND e.email = lower(btrim(u.email));

    UPDATE credential_group_enrollment e SET status = 'in_progress', updated_at = now()
    WHERE e.status IN ('invited', 'delivery_failed') AND e.revoked_at IS NULL
      AND e.id IN (
        SELECT credential_group_enrollment_id FROM credential WHERE id = ANY(token_ids)
      );
  END LOOP;
END $$;
