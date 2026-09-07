import type { PermissionType } from '@sim/platform-authz/workspace'
import { permissionRank } from '@/lib/workspaces/access/workspace-access'

/**
 * The pure half of projection: what a user's mappings entitle them to, and how
 * that differs from what the directory granted before. No database here, so the
 * rules that decide access can be tested exhaustively without one.
 */

export type ProjectionTargetKind = 'permission_group' | 'workspace' | 'org_role'

export interface ProjectionGrant {
  targetKind: ProjectionTargetKind
  targetId: string
  permissionType?: PermissionType
}

/** One `scim_group_mapping` row the user reaches through a group they belong to. */
export interface MappingRow {
  targetKind: string
  permissionGroupId: string | null
  workspaceId: string | null
  permissionType: PermissionType | null
  role: string | null
}

export interface DefaultWorkspaceGrant {
  workspaceId: string
  permission: PermissionType
}

function grantKey(grant: ProjectionGrant): string {
  return `${grant.targetKind}:${grant.targetId}`
}

/**
 * Collapses mapping rows and connection defaults into one grant per target.
 *
 * Two groups granting the same workspace resolve to the stronger level, and a
 * connection default is treated like any other mapping so a group can raise it.
 * Rows whose target column is missing describe nothing and are dropped.
 */
export function resolveDesiredGrants(
  rows: readonly MappingRow[],
  defaults: readonly DefaultWorkspaceGrant[] = []
): ProjectionGrant[] {
  const byKey = new Map<string, ProjectionGrant>()

  const offer = (grant: ProjectionGrant) => {
    const key = grantKey(grant)
    const existing = byKey.get(key)
    if (
      !existing ||
      !existing.permissionType ||
      !grant.permissionType ||
      permissionRank(grant.permissionType) > permissionRank(existing.permissionType)
    ) {
      byKey.set(key, grant)
    }
  }

  for (const grant of defaults) {
    offer({
      targetKind: 'workspace',
      targetId: grant.workspaceId,
      permissionType: grant.permission,
    })
  }

  for (const row of rows) {
    if (row.targetKind === 'permission_group' && row.permissionGroupId) {
      offer({ targetKind: 'permission_group', targetId: row.permissionGroupId })
    } else if (row.targetKind === 'workspace' && row.workspaceId && row.permissionType) {
      offer({
        targetKind: 'workspace',
        targetId: row.workspaceId,
        permissionType: row.permissionType,
      })
    } else if (row.targetKind === 'org_role' && row.role) {
      offer({ targetKind: 'org_role', targetId: row.role })
    }
  }

  return [...byKey.values()]
}

export interface GrantApplication {
  grant: ProjectionGrant
  /** The level a previous pass set on a workspace, present when the level changes. */
  previousPermission?: PermissionType
}

export interface GrantPlan {
  /** Grants the directory made that no mapping asks for any more. */
  withdraw: ProjectionGrant[]
  /** Grants to make or re-level, in desired order. */
  apply: GrantApplication[]
}

/**
 * Diffs the desired set against what the directory previously granted.
 *
 * Only differences are returned, which is what makes a reconcile pass
 * idempotent: identical inputs plan nothing. A workspace already granted at a
 * different level is planned as an application carrying the previous level, so
 * the executor can lower as well as raise.
 */
export function planGrantChanges(
  desired: readonly ProjectionGrant[],
  current: readonly ProjectionGrant[]
): GrantPlan {
  const desiredByKey = new Map(desired.map((grant) => [grantKey(grant), grant]))
  const currentByKey = new Map(current.map((grant) => [grantKey(grant), grant]))

  const withdraw: ProjectionGrant[] = []
  for (const [key, grant] of currentByKey) {
    if (!desiredByKey.has(key)) withdraw.push(grant)
  }

  const apply: GrantApplication[] = []
  for (const [key, grant] of desiredByKey) {
    const existing = currentByKey.get(key)
    if (!existing) {
      apply.push({ grant })
      continue
    }
    const levelChanged =
      grant.permissionType !== undefined &&
      existing.permissionType !== undefined &&
      grant.permissionType !== existing.permissionType
    if (levelChanged) apply.push({ grant, previousPermission: existing.permissionType })
  }

  return { withdraw, apply }
}
