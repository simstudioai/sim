-- A personal organization bills nothing and has one member; team and Enterprise configuration
-- (SSO, SCIM, permission groups, custom blocks, data drains, whitelabeling, data retention,
-- session policy) never applies to it. Enforced here so every writer, including self-hosted
-- deployments without billing gates and the admin API, is refused.
CREATE OR REPLACE FUNCTION refuse_personal_organization_configuration() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM organization WHERE id = NEW.organization_id AND kind = 'personal'
  ) THEN
    RAISE EXCEPTION 'Personal organizations cannot hold % configuration', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS sso_provider_team_only ON sso_provider;--> statement-breakpoint
CREATE TRIGGER sso_provider_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON sso_provider
  FOR EACH ROW WHEN (NEW.organization_id IS NOT NULL)
  EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS sso_domain_team_only ON sso_domain;--> statement-breakpoint
CREATE TRIGGER sso_domain_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON sso_domain
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS scim_connection_team_only ON scim_connection;--> statement-breakpoint
CREATE TRIGGER scim_connection_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON scim_connection
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS permission_group_team_only ON permission_group;--> statement-breakpoint
CREATE TRIGGER permission_group_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON permission_group
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS custom_block_team_only ON custom_block;--> statement-breakpoint
CREATE TRIGGER custom_block_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON custom_block
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS data_drains_team_only ON data_drains;--> statement-breakpoint
CREATE TRIGGER data_drains_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON data_drains
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
CREATE OR REPLACE FUNCTION refuse_personal_organization_settings() RETURNS trigger AS $$
BEGIN
  IF NEW.kind = 'personal' AND (
    NEW.whitelabel_settings IS NOT NULL
    OR NEW.data_retention_settings IS NOT NULL
    OR NEW.session_policy_settings IS NOT NULL
    OR NEW.require_sso
  ) THEN
    RAISE EXCEPTION 'Personal organizations cannot hold team settings'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS organization_personal_settings ON organization;--> statement-breakpoint
CREATE TRIGGER organization_personal_settings
  BEFORE INSERT OR UPDATE ON organization
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_settings();
