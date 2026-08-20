import { db } from '@sim/db'
import { permissionGroup, permissionGroupWorkspace, workflow } from '@sim/db/schema'
import { resolveEffectiveWorkspacePermission } from '@sim/platform-authz/workspace'
import { and, eq, isNull } from 'drizzle-orm'
import type { WorkspaceAuthorizationContext } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import type { ResourcePolicySubject } from '@/lib/resource-policies/types'

async function requireUserSubject(
  subject: Extract<ResourcePolicySubject, { type: 'user' }>,
  context: WorkspaceAuthorizationContext
) {
  const permission = await resolveEffectiveWorkspacePermission(
    subject.userId,
    context.workspaceId,
    context.workspaceOrganizationId
  )
  if (!permission) {
    throw new OrchestrationError('validation', 'Policy user does not have workspace access')
  }
}

async function requireWorkflowSubject(
  subject: Extract<ResourcePolicySubject, { type: 'workflow' }>,
  context: WorkspaceAuthorizationContext
) {
  const [row] = await db
    .select({ id: workflow.id })
    .from(workflow)
    .where(
      and(
        eq(workflow.id, subject.workflowId),
        eq(workflow.workspaceId, context.workspaceId),
        isNull(workflow.archivedAt)
      )
    )
    .limit(1)
  if (!row) throw new OrchestrationError('validation', 'Policy workflow was not found')
}

async function requireAccessControlGroupSubject(
  subject: Extract<ResourcePolicySubject, { type: 'access_control_group' }>,
  context: WorkspaceAuthorizationContext
) {
  if (!context.workspaceOrganizationId) {
    throw new OrchestrationError(
      'validation',
      'Access Control Group grants require an organization workspace'
    )
  }
  const [row] = await db
    .select({ id: permissionGroup.id, isDefault: permissionGroup.isDefault })
    .from(permissionGroup)
    .where(
      and(
        eq(permissionGroup.id, subject.accessControlGroupId),
        eq(permissionGroup.organizationId, context.workspaceOrganizationId)
      )
    )
    .limit(1)
  if (!row) {
    throw new OrchestrationError(
      'validation',
      'Access Control Group does not apply to this workspace'
    )
  }
  if (!row.isDefault) {
    const [workspaceBinding] = await db
      .select({ id: permissionGroupWorkspace.id })
      .from(permissionGroupWorkspace)
      .where(
        and(
          eq(permissionGroupWorkspace.permissionGroupId, subject.accessControlGroupId),
          eq(permissionGroupWorkspace.workspaceId, context.workspaceId)
        )
      )
      .limit(1)
    if (!workspaceBinding) {
      throw new OrchestrationError(
        'validation',
        'Access Control Group does not apply to this workspace'
      )
    }
  }
}

export async function validateResourcePolicySubjects(
  subjects: ResourcePolicySubject[],
  context: WorkspaceAuthorizationContext
): Promise<void> {
  await Promise.all(
    subjects.map(async (subject) => {
      switch (subject.type) {
        case 'user':
          return requireUserSubject(subject, context)
        case 'workflow':
          return requireWorkflowSubject(subject, context)
        case 'access_control_group':
          return requireAccessControlGroupSubject(subject, context)
        case 'workspace_role':
        case 'external_identity':
          return
      }
    })
  )
}
