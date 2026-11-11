-- A personal organization has exactly one member, its owner (retirePersonalOrganizationTx and
-- ensureUserInOrganizationTx rely on it). Enforced here so every writer, including the admin API
-- and self-hosted deployments, is refused a second member or a non-owner role. The organization
-- row is locked first so two concurrent inserts cannot both see it empty; FOR NO KEY UPDATE
-- conflicts with itself, so they still serialize, without waiting on the FOR KEY SHARE every
-- insert referencing the organization (a chat, a run) holds. Additive: the previous release never
-- adds a member to a personal organization or changes its owner's role, and only inserts and
-- updates are checked, so existing rows are untouched. An organization only ever turns from
-- personal into a team (convertPersonalOrganizationToTeamTx), never back: no writer sets
-- kind = 'personal' on an existing row, so a team's members are never re-checked here.
CREATE OR REPLACE FUNCTION refuse_personal_organization_extra_member() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM organization WHERE id = NEW.organization_id AND kind = 'personal'
  ) THEN
    PERFORM 1 FROM organization WHERE id = NEW.organization_id FOR NO KEY UPDATE;
    IF NEW.role <> 'owner' OR EXISTS (
      SELECT 1 FROM member WHERE organization_id = NEW.organization_id AND id <> NEW.id
    ) THEN
      RAISE EXCEPTION 'A personal organization has exactly one member, its owner'
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;--> statement-breakpoint
DROP TRIGGER IF EXISTS member_personal_organization_single_owner ON member;--> statement-breakpoint
CREATE TRIGGER member_personal_organization_single_owner
  BEFORE INSERT OR UPDATE OF organization_id, role ON member
  FOR EACH ROW EXECUTE FUNCTION refuse_personal_organization_extra_member();
