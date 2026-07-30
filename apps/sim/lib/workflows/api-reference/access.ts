import { db } from '@sim/db'
import {
  permissions,
  workflowPublication,
  workflow as workflowTable,
  workspace,
} from '@sim/db/schema'
import { getActiveWorkflowContext } from '@sim/platform-authz/workflow'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { PublicationRow, WorkflowRow } from '@/lib/workflows/api-reference/derive'
import { isOrganizationMember } from '@/lib/workspaces/permissions/utils'

/** The org a (non-archived) workspace belongs to, or null if none/archived. */
async function getWorkspaceOrganizationId(workspaceId: string): Promise<string | null> {
  const [row] = await db
    .select({ organizationId: workspace.organizationId })
    .from(workspace)
    .where(and(eq(workspace.id, workspaceId), isNull(workspace.archivedAt)))
    .limit(1)
  return row?.organizationId ?? null
}

/** A resolved, readable publication: the workflow, its settings, and owning workspace. */
export interface ReadablePublication {
  workflowRow: WorkflowRow
  publication: PublicationRow
  workspaceId: string
}

/** A readable publication plus its owning workspace's display name (for the catalog). */
export interface ReadableOrgResource extends ReadablePublication {
  workspaceName: string
}

/**
 * Whether an org-member reader may see an `allowlist`-visibility entry: true only when
 * the reader holds a workspace permission on at least one allowlisted workspace. `org`
 * visibility is always visible to org members and short-circuits before this runs.
 */
async function readerInAllowlist(userId: string, allowlist: string[] | null): Promise<boolean> {
  if (!allowlist || allowlist.length === 0) return false
  const rows = await db
    .select({ entityId: permissions.entityId })
    .from(permissions)
    .where(
      and(
        eq(permissions.userId, userId),
        eq(permissions.entityType, 'workspace'),
        inArray(permissions.entityId, allowlist)
      )
    )
    .limit(1)
  return rows.length > 0
}

/**
 * Resolves a workflow's publication for a reader, applying the full default-deny authz
 * chain, and returns `null` for EVERY denial — nonexistent/archived workflow, no
 * publication row, unpublished, reader not in the org, or allowlist miss. Callers turn
 * `null` into a 404 (never 403) so the surface never leaks whether a workflow exists.
 * Reading grants zero data access beyond the returned settings + later-derived doc.
 */
export async function resolveReadablePublication(
  workflowId: string,
  userId: string
): Promise<ReadablePublication | null> {
  const context = await getActiveWorkflowContext(workflowId)
  if (!context) return null

  const orgId = context.workspaceOrganizationId
  if (!orgId) return null
  if (!(await isOrganizationMember(userId, orgId))) return null

  const [publication] = await db
    .select()
    .from(workflowPublication)
    .where(eq(workflowPublication.workflowId, workflowId))
    .limit(1)
  if (!publication || !publication.published) return null

  if (publication.visibility === 'allowlist') {
    if (!(await readerInAllowlist(userId, publication.allowlistWorkspaceIds))) return null
  }

  return { workflowRow: context.workflow, publication, workspaceId: context.workspaceId }
}

/**
 * All published, reader-visible workflows in a workspace, for org members only.
 *
 * Returns `null` when the reader is NOT a member of the workspace's org (or the
 * workspace has no org) — the route turns that into a 404 so a non-member can't even
 * confirm the workspace exists or learn its name. A genuine org member with zero
 * published workflows gets an empty array (a legitimate, non-leaking empty doc).
 */
export async function listReadablePublications(
  workspaceId: string,
  userId: string
): Promise<ReadablePublication[] | null> {
  const orgId = await getWorkspaceOrganizationId(workspaceId)
  if (!orgId || !(await isOrganizationMember(userId, orgId))) return null

  const rows = await db
    .select({ workflow: workflowTable, publication: workflowPublication })
    .from(workflowPublication)
    .innerJoin(workflowTable, eq(workflowPublication.workflowId, workflowTable.id))
    .where(
      and(eq(workflowPublication.workspaceId, workspaceId), eq(workflowPublication.published, true))
    )

  const visible: ReadablePublication[] = []
  for (const row of rows) {
    if (row.publication.visibility === 'allowlist') {
      if (!(await readerInAllowlist(userId, row.publication.allowlistWorkspaceIds))) continue
    }
    visible.push({
      workflowRow: row.workflow,
      publication: row.publication,
      workspaceId,
    })
  }
  return visible
}

/**
 * Every published, reader-visible resource across an organization - the data behind the
 * org API catalog ("Org Resources"). Returns `null` when the reader is not a member of
 * the org (route -> 404). Enforces org membership once, then filters each publication by
 * visibility, exactly like the per-workspace list. Each row carries its workspace's name
 * so the catalog can group resources by service (workspace).
 */
export async function listOrgReadableResources(
  organizationId: string,
  userId: string
): Promise<ReadableOrgResource[] | null> {
  if (!(await isOrganizationMember(userId, organizationId))) return null

  const rows = await db
    .select({
      workflow: workflowTable,
      publication: workflowPublication,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
    })
    .from(workflowPublication)
    .innerJoin(workflowTable, eq(workflowPublication.workflowId, workflowTable.id))
    .innerJoin(workspace, eq(workflowPublication.workspaceId, workspace.id))
    .where(
      and(
        eq(workspace.organizationId, organizationId),
        eq(workflowPublication.published, true),
        isNull(workspace.archivedAt)
      )
    )

  const visible: ReadableOrgResource[] = []
  for (const row of rows) {
    if (row.publication.visibility === 'allowlist') {
      if (!(await readerInAllowlist(userId, row.publication.allowlistWorkspaceIds))) continue
    }
    visible.push({
      workflowRow: row.workflow,
      publication: row.publication,
      workspaceId: row.workspaceId,
      workspaceName: row.workspaceName,
    })
  }
  return visible
}
