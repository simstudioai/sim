import { AuditAction, AuditResourceType, recordAudit } from '@sim/audit'
import { db } from '@sim/db'
import type { AdminMutationActor } from '@/lib/admin/dashboard'
import {
  licenseAuditMetadata,
  requireLinkableTo,
} from '@/lib/billing/aws-marketplace/application/use-cases'
import {
  countUnlinkedLicenses,
  linkLicenseForTeam,
  listUnlinkedLicenses,
  lockLicense,
  organizationExists,
} from '@/lib/billing/aws-marketplace/repository'
import { OrchestrationError } from '@/lib/core/orchestration/types'

/** The licenses no organization holds yet, the ones the team's notices ask to link. */
export async function listUnlinkedAwsMarketplaceLicenses(page: { limit: number; offset: number }) {
  const [total, rows] = await Promise.all([countUnlinkedLicenses(), listUnlinkedLicenses(page)])
  return {
    total,
    licenses: rows.map((license) => ({
      id: license.id,
      licenseArn: license.licenseArn,
      customerAwsAccountId: license.customerAwsAccountId,
      agreementId: license.agreementId,
      status: license.status,
      dimension: license.dimension,
      quantity: license.quantity,
      expiresAt: license.expiresAt?.toISOString() ?? null,
      lastVerifiedAt: license.lastVerifiedAt.toISOString(),
      licenseEventReceivedAt: license.licenseEventReceivedAt?.toISOString() ?? null,
      linkedByUserId: license.linkedByUserId,
      contactEmail: license.contactEmail,
      companyName: license.companyName,
      createdAt: license.createdAt.toISOString(),
    })),
  }
}

/**
 * The team links a license to the organization it provisioned for the buyer. A license linked
 * elsewhere is refused, as it is for a buyer; linking it to the same organization again changes
 * nothing and is not audited.
 */
export async function linkAwsMarketplaceLicenseAsAdmin(
  input: { licenseId: string; organizationId: string },
  actor: AdminMutationActor
): Promise<{ id: string; organizationId: string }> {
  const { license, newlyLinked } = await db.transaction(async (tx) => {
    const locked = await lockLicense(tx, input.licenseId)
    if (!locked) throw new OrchestrationError('not_found', 'License')
    requireLinkableTo(locked, input.organizationId)
    if (!(await organizationExists(tx, input.organizationId))) {
      throw new OrchestrationError('not_found', 'Organization')
    }
    if (locked.organizationId === input.organizationId) {
      return { license: locked, newlyLinked: false }
    }
    return {
      license: await linkLicenseForTeam(tx, input.licenseId, input.organizationId),
      newlyLinked: true,
    }
  })
  if (newlyLinked) {
    recordAudit({
      actorId: actor.id,
      actorName: actor.name,
      actorEmail: actor.email,
      action: AuditAction.AWS_MARKETPLACE_LICENSE_LINKED,
      resourceType: AuditResourceType.AWS_MARKETPLACE_LICENSE,
      resourceId: license.id,
      resourceName: license.dimension ?? 'AWS Marketplace license',
      description: 'Admin linked an AWS Marketplace subscription to an organization',
      metadata: { ...licenseAuditMetadata(license), organizationId: input.organizationId },
    })
  }
  return { id: license.id, organizationId: input.organizationId }
}
