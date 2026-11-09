-- A personal organization has exactly one member, its owner (retirePersonalOrganizationTx and
-- ensureUserInOrganizationTx rely on it). Enforced here so every writer, including the admin API
-- and self-hosted deployments, is refused a second member or a non-owner role. The organization
-- row is locked first so two concurrent inserts cannot both see it empty. Additive: the previous
-- release never adds a member to a personal organization or changes its owner's role, and only
-- inserts and updates are checked, so existing rows are untouched.
CREATE OR REPLACE FUNCTION refuse_personal_organization_extra_member() RETURNS trigger AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM organization WHERE id = NEW.organization_id AND kind = 'personal'
  ) THEN
    PERFORM 1 FROM organization WHERE id = NEW.organization_id FOR UPDATE;
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
