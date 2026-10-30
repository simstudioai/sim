-- Better Auth 1.7 refuses two SAML configurations that 1.6 signed users in with:
--
-- 1. No IdP metadata and no `idpMetadata.entityID`. 1.6 fell back to the config's `issuer`, which
--    in Sim is the IdP entity ID the admin entered; 1.7 requires it spelled out. Writing that same
--    value as `entityID` keeps the IdP authority identical under both versions. A legacy bare-string
--    `idpMetadata` was never read by either version (they read `idpMetadata.metadata`), so it is
--    replaced by the same object.
-- 2. `wantAssertionsSigned: true` whose SP metadata does not ask for signed assertions; Sim generated
--    `WantAssertionsSigned="false"` for every provider. 1.7 refuses that mismatch, and when the
--    metadata does ask, it requires a signature on the Assertion itself. 1.6 (samlify) accepted any
--    valid IdP signature, on the Response or the Assertion, whatever the flag said. Clearing the flag
--    keeps exactly that policy, so IdPs that sign only the Response keep signing users in; an admin
--    can opt into signed assertions from SSO settings.
--
-- Idempotent: a row is rewritten only when one of the two conditions still holds. The table holds
-- one row per configured provider, so a single pass is bounded. Rows whose JSON cannot be parsed
-- are left for the application to reject as before.
DO $$
DECLARE
  provider record;
  config jsonb;
  updated jsonb;
  idp jsonb;
BEGIN
  FOR provider IN
    SELECT "id", "issuer", "saml_config" FROM "sso_provider" WHERE "saml_config" IS NOT NULL FOR UPDATE
  LOOP
    BEGIN
      config := provider."saml_config"::jsonb;
    EXCEPTION WHEN others THEN
      CONTINUE;
    END;
    IF jsonb_typeof(config) <> 'object' THEN
      CONTINUE;
    END IF;
    updated := config;

    idp := CASE
      WHEN jsonb_typeof(config->'idpMetadata') = 'object' THEN config->'idpMetadata'
      ELSE '{}'::jsonb
    END;
    IF coalesce(idp->>'metadata', '') = '' AND coalesce(idp->>'entityID', '') = '' THEN
      updated := jsonb_set(
        updated,
        '{idpMetadata}',
        (idp - 'metadata' - 'entityID')
          || jsonb_build_object('entityID', coalesce(nullif(config->>'issuer', ''), provider."issuer"))
      );
    END IF;

    IF config->'wantAssertionsSigned' = 'true'::jsonb
      AND coalesce(config #>> '{spMetadata,metadata}', '') !~ '\sWantAssertionsSigned=(["''])(true|1)\1' THEN
      updated := jsonb_set(updated, '{wantAssertionsSigned}', 'false'::jsonb);
    END IF;

    IF updated <> config THEN
      UPDATE "sso_provider" SET "saml_config" = updated::text WHERE "id" = provider."id";
    END IF;
  END LOOP;
END $$;
