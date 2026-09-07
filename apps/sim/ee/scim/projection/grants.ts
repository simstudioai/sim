import type { PermissionType } from '@sim/platform-authz/workspace'
import { permissionRank } from '@/lib/workspaces/access/workspace-access'

/**
 * The pure half of projection: what a user's mappings entitle them to, and how
 * that differs from what the directory granted before. No database here, so the
 * rules that decide access can be tested exhaustively without one.
 */

export type ProjectionTargetKind = 'permission_group' | 'workspace' | 'org_role'

/**
 * How the directory came to hold a grant: it created the access, or it found the
 * person already holding it by hand and adopted the record so the mapping is
 * satisfied without re-applying it every pass.
 */
export type ProjectionGrantOrigin = 'directory' | 'adopted'

export interface ProjectionGrant {
  targetKind: ProjectionTargetKind
  targetId: string
  permissionType?: PermissionType
  /** Present on grants read back from provenance; a desired grant has no origin yet. */
  origin?: ProjectionGrantOrigin
}

/** One `scim_group_mapping` row the user reaches through a group they belong to. */
export interface MappingRow {
  targetKind: string
  permissionGroupId: string | null
  workspaceId: string | null
  permissionType: PermissionType | null
  role: string | null
}

function grantKey(grant: ProjectionGrant): string {
  return `${grant.targetKind}:${grant.targetId}`
}

/**
 * Collapses mapping rows into one grant per target.
 *
 * Two groups granting the same workspace resolve to the stronger level. Rows
 * whose target column is missing describe nothing and are dropped.
 */
export function resolveDesiredGrants(rows: readonly MappingRow[]): ProjectionGrant[] {
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
