import { db } from '@sim/db'
import { project, projectWorkspace, workspace } from '@sim/db/schema'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import {
  buildOrganizationAccountAccessPolicy,
  listOrganizationAccountWorkspaceGrants,
  organizationAccountAccessPolicyCodec,
} from '@/lib/credential-groups/application/workspace-access-policy'
import type { OrganizationAccountWorkspaceGrant } from '@/lib/credential-groups/workspace-grants'
import { requireResourcePolicy } from '@/lib/resource-policies/repository'

/** Resolves project grants from current canonical membership on every credential access check. */
export async function requireOrganizationAccountRuntimePolicy(input: {
  organizationId: string
  resourceType: 'credential_group'
  resourceId: string
}) {
  const policy = await requireResourcePolicy({
    ...input,
    codec: organizationAccountAccessPolicyCodec,
  })
  const projectGrants = policy.document.projectGrants ?? []
  if (!projectGrants.length) return policy
  const rows = await db
    .select({ projectId: project.id, workspaceId: workspace.id })
    .from(project)
    .innerJoin(projectWorkspace, eq(projectWorkspace.projectId, project.id))
    .innerJoin(workspace, eq(workspace.id, projectWorkspace.workspaceId))
    .where(
      and(
        inArray(
          project.id,
          projectGrants.map((grant) => grant.projectId)
        ),
        eq(project.organizationId, input.organizationId),
        eq(workspace.organizationId, input.organizationId),
        isNull(project.archivedAt),
        isNull(workspace.archivedAt)
      )
    )
  const grants = new Map<string, OrganizationAccountWorkspaceGrant>(
    listOrganizationAccountWorkspaceGrants(policy.document).map((grant) => [
      grant.workspaceId,
      grant,
    ])
  )
  const byProject = new Map(projectGrants.map((grant) => [grant.projectId, grant.access]))
  for (const row of rows) {
    const inherited = byProject.get(row.projectId)!
    const existing = grants.get(row.workspaceId)?.access
    const access = !existing
      ? inherited
      : existing.mode === 'all' || inherited.mode === 'all'
        ? { mode: 'all' as const }
        : {
            mode: 'selected' as const,
            credentialTypes: [
              ...new Set([...existing.credentialTypes, ...inherited.credentialTypes]),
            ],
          }
    grants.set(row.workspaceId, { workspaceId: row.workspaceId, access })
  }
  return {
    ...policy,
    document: buildOrganizationAccountAccessPolicy(input.resourceId, [...grants.values()]),
  }
}
