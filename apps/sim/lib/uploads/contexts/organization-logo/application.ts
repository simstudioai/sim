import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { member, organization, uploadSession } from '@sim/db/schema'
import { isOrgAdminRole } from '@sim/platform-authz/workspace'
import { and, eq, isNull } from 'drizzle-orm'
import { recordProjectedUseCaseAuditEntries } from '@/lib/core/application/authorized-workspace-use-case'
import { authorizeOrganizationOperation } from '@/lib/core/application/organization-authorization'
import { defineOrganizationOperation } from '@/lib/core/application/organization-operation'
import {
  OrchestrationError,
  type OrchestrationRequestContext,
} from '@/lib/core/orchestration/types'
import { getServeStoragePrefix } from '@/lib/uploads/config'
import { assertOrganizationLogoControlBinding } from '@/lib/uploads/contexts/organization-logo/binding'
import { createUploadSession, type UploadSessionRecord } from '@/lib/uploads/upload-session/service'

/**
 * permission-group-exempt: organization appearance is governed by organization administrator membership.
 */
export const organizationLogoOperation = defineOrganizationOperation({
  id: 'organization.logo.update',
  minimumRole: 'admin',
  principalKinds: ['session'],
  capability: 'none',
})

export interface CreateOrganizationLogoUploadInput {
  organizationId: string
  name: string
  contentType: string
  size: number
  localOrigin: string
}

export async function createOrganizationLogoUpload(
  principal: Principal,
  input: CreateOrganizationLogoUploadInput
) {
  const context = await authorizeOrganizationOperation(principal, organizationLogoOperation, input)
  const [current] = await db
    .select({ logo: organization.logo })
    .from(organization)
    .where(eq(organization.id, context.organizationId))
    .limit(1)
  if (!current) throw new OrchestrationError('not_found', 'Organization not found')
  return createUploadSession({
    purpose: 'organization_logo',
    principal,
    organizationId: context.organizationId,
    expectedLogo: current.logo,
    userId: context.userId,
    fileName: input.name,
    contentType: input.contentType,
    fileSize: input.size,
    localOrigin: input.localOrigin,
  })
}

export async function authorizeOrganizationLogoControl(
  principal: Principal,
  session: UploadSessionRecord
): Promise<void> {
  const binding = assertOrganizationLogoControlBinding(session, principal)
  await authorizeOrganizationOperation(principal, organizationLogoOperation, binding)
}

export function organizationLogoUploadResult(session: UploadSessionRecord) {
  return {
    path: `/api/files/serve/${getServeStoragePrefix()}/${encodeURIComponent(session.finalKey)}?context=organization-logos`,
    key: session.finalKey,
    name: session.fileName,
    size: session.fileSize,
    type: session.contentType,
  }
}

/** Registers the logo and durable completion marker together, so retries cannot restore an old logo. */
export async function finalizeOrganizationLogoUpload(
  principal: Principal,
  session: UploadSessionRecord,
  request: OrchestrationRequestContext
) {
  await authorizeOrganizationLogoControl(principal, session)
  const binding = assertOrganizationLogoControlBinding(session, principal)
  const value = organizationLogoUploadResult(session)
  const changed = await db.transaction(async (tx) => {
    const [current] = await tx
      .select({ completedFileId: uploadSession.completedFileId, status: uploadSession.status })
      .from(uploadSession)
      .where(
        and(
          eq(uploadSession.id, session.id),
          eq(uploadSession.purpose, 'organization_logo'),
          eq(uploadSession.finalKey, session.finalKey),
          isNull(uploadSession.workspaceId)
        )
      )
      .for('update')
      .limit(1)
    if (!current) throw new OrchestrationError('not_found', 'Upload session not found')
    if (current.completedFileId) return null
    if (current.status !== 'finalizing') {
      throw new OrchestrationError('conflict', 'Upload session is not ready for finalization')
    }

    const [membership] = await tx
      .select({ role: member.role })
      .from(member)
      .where(
        and(eq(member.organizationId, binding.organizationId), eq(member.userId, binding.userId))
      )
      .for('share')
      .limit(1)
    if (!membership) throw new OrchestrationError('not_found', 'Organization not found')
    if (!isOrgAdminRole(membership.role)) {
      throw new OrchestrationError('forbidden', 'Organization administrator access is required')
    }
    const [currentOrganization] = await tx
      .select({ logo: organization.logo })
      .from(organization)
      .where(eq(organization.id, binding.organizationId))
      .for('update')
      .limit(1)
    if (!currentOrganization) throw new OrchestrationError('not_found', 'Organization not found')
    if (currentOrganization.logo !== binding.expectedLogo) {
      throw new OrchestrationError(
        'conflict',
        'The organization logo changed while this upload was in progress. Please upload it again.'
      )
    }
    const [updated] = await tx
      .update(organization)
      .set({ logo: value.path })
      .where(eq(organization.id, binding.organizationId))
      .returning({ id: organization.id, name: organization.name })
    if (!updated) throw new OrchestrationError('not_found', 'Organization not found')
    const [registered] = await tx
      .update(uploadSession)
      .set({
        completedFileId: session.id,
        metadata: { ...session.metadata, organizationLogoPath: value.path },
        updatedAt: new Date(),
      })
      .where(and(eq(uploadSession.id, session.id), eq(uploadSession.status, 'finalizing')))
      .returning({ id: uploadSession.id })
    if (!registered) throw new Error('Organization logo registration marker could not be persisted')
    return updated
  })
  if (changed) {
    recordProjectedUseCaseAuditEntries(
      organizationLogoOperation,
      null,
      principal,
      request,
      [
        {
          action: AuditAction.ORGANIZATION_UPDATED,
          resourceType: AuditResourceType.ORGANIZATION,
          resourceId: changed.id,
          resourceName: changed.name,
          description: 'Updated organization logo',
        },
      ],
      binding.organizationId
    )
  }
  return { value, completedFileId: session.id }
}
