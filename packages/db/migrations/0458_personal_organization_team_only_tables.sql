-- Organization-scoped rows a personal organization never holds, because they could not follow its
-- owner into the team they join (retirePersonalOrganizationTx moves content, keyed state and
-- personal-only rows, then refuses the join if anything else would cascade away): BYOK keys,
-- per-member usage limits, Search integration approvals, Generic Secrets, People directory sync,
-- connected-account collection (credential groups and their resource policies), Slack Search apps
-- and installations, and permission-group memberships. Reuses 0456's trigger function, so every
-- writer, including self-hosted deployments without plan gates and the admin API, is refused.
-- Additive: the previous release never writes these rows for a personal organization's id on hosted,
-- and a refused write fails as its plan gate would.
DROP TRIGGER IF EXISTS organization_byok_keys_team_only ON organization_byok_keys;--> statement-breakpoint
CREATE TRIGGER organization_byok_keys_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON organization_byok_keys
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS organization_member_usage_limit_team_only ON organization_member_usage_limit;--> statement-breakpoint
CREATE TRIGGER organization_member_usage_limit_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON organization_member_usage_limit
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS organization_search_integration_team_only ON organization_search_integration;--> statement-breakpoint
CREATE TRIGGER organization_search_integration_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON organization_search_integration
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS organization_secret_source_team_only ON organization_secret_source;--> statement-breakpoint
CREATE TRIGGER organization_secret_source_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON organization_secret_source
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS people_directory_sync_team_only ON people_directory_sync;--> statement-breakpoint
CREATE TRIGGER people_directory_sync_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON people_directory_sync
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS people_directory_scim_change_team_only ON people_directory_scim_change;--> statement-breakpoint
CREATE TRIGGER people_directory_scim_change_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON people_directory_scim_change
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS credential_group_team_only ON credential_group;--> statement-breakpoint
CREATE TRIGGER credential_group_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON credential_group
  FOR EACH ROW WHEN (NEW.organization_id IS NOT NULL) EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS resource_policy_team_only ON resource_policy;--> statement-breakpoint
CREATE TRIGGER resource_policy_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON resource_policy
  FOR EACH ROW WHEN (NEW.organization_id IS NOT NULL) EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS slack_app_team_only ON slack_app;--> statement-breakpoint
CREATE TRIGGER slack_app_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON slack_app
  FOR EACH ROW WHEN (NEW.organization_id IS NOT NULL) EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS slack_search_installation_team_only ON slack_search_installation;--> statement-breakpoint
CREATE TRIGGER slack_search_installation_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON slack_search_installation
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS permission_group_member_team_only ON permission_group_member;--> statement-breakpoint
CREATE TRIGGER permission_group_member_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON permission_group_member
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();--> statement-breakpoint
DROP TRIGGER IF EXISTS permission_group_workspace_team_only ON permission_group_workspace;--> statement-breakpoint
CREATE TRIGGER permission_group_workspace_team_only
  BEFORE INSERT OR UPDATE OF organization_id ON permission_group_workspace
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_configuration();
