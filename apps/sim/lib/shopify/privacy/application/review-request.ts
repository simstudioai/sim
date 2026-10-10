import { AuditAction, AuditResourceType } from '@sim/audit'
import { toPrincipalActor } from '@sim/auth/principal'
import { db } from '@sim/db'
import { auditLog, shopifyPrivacyRequest } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { eq } from 'drizzle-orm'
import type { OperationUseCase } from '@/lib/core/application/operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { authorizePrivacyOperator } from '@/lib/shopify/privacy/application/authorization'
import {
  SHOPIFY_PRIVACY_STORES,
  type ShopifyPrivacyEvidence,
  type ShopifyPrivacyReview,
} from '@/lib/shopify/privacy/types'

// permission-group-exempt: platform privacy operations require current administrator authority
const operation = Object.freeze({
  id: 'shopify.privacy.review',
  capability: 'none',
  principalKinds: ['session'] as const,
})

interface ReviewShopifyPrivacyInput {
  requestId: string
  revision: number
  action: 'assign' | 'record_evidence' | 'complete' | 'legal_hold'
  scopeReviewed?: boolean
  evidence?: ShopifyPrivacyEvidence[]
  deliveryReference?: string
}

function validateEvidence(evidence: ShopifyPrivacyEvidence[]): void {
  const stores = new Set<string>()
  if (evidence.length < 1 || evidence.length > SHOPIFY_PRIVACY_STORES.length) {
    throw new OrchestrationError('validation', 'Provide bounded evidence for the reviewed stores')
  }
  for (const item of evidence) {
    if (
      !SHOPIFY_PRIVACY_STORES.includes(item.store) ||
      stores.has(item.store) ||
      !['exported', 'erased', 'no_data', 'legal_hold'].includes(item.outcome) ||
      !item.recordReference.trim() ||
      item.recordReference.length > 1000 ||
      !item.summary.trim() ||
      item.summary.length > 2000
    )
      throw new OrchestrationError(
        'validation',
        'Each store needs unique evidence and a bounded record reference'
      )
    stores.add(item.store)
  }
}

function requireCompletionEvidence(
  topic: string,
  review: ShopifyPrivacyReview | null,
  operatorId: string
): void {
  if (!review || !review.scopeReviewed || review.reviewedByUserId !== operatorId) {
    throw new OrchestrationError(
      'conflict',
      'The assigned operator must review the complete case scope'
    )
  }
  const stores = new Map(review.evidence.map((item) => [item.store, item]))
  const expectedOutcome = topic === 'customers/data_request' ? 'exported' : 'erased'
  for (const store of SHOPIFY_PRIVACY_STORES) {
    const evidence = stores.get(store)
    if (!evidence || ![expectedOutcome, 'no_data'].includes(evidence.outcome)) {
      throw new OrchestrationError(
        'conflict',
        'Every storage category needs completed fulfillment or verified no-data evidence'
      )
    }
  }
  if (topic === 'customers/data_request' && !review.deliveryReference?.trim()) {
    throw new OrchestrationError(
      'conflict',
      'Record secure delivery to the verified store owner before completion'
    )
  }
}

/** Records a human-verified result; it cannot turn queue delivery into automatic erasure. */
export const reviewShopifyPrivacyRequest: OperationUseCase<
  typeof operation,
  ReviewShopifyPrivacyInput,
  { revision: number; status: string }
> = {
  operation,
  async execute({ principal, input }) {
    return db.transaction(async (tx) => {
      const operatorId = await authorizePrivacyOperator(principal, tx)
      const [request] = await tx
        .select()
        .from(shopifyPrivacyRequest)
        .where(eq(shopifyPrivacyRequest.id, input.requestId))
        .limit(1)
        .for('update')
      if (!request) throw new OrchestrationError('not_found', 'Privacy request not found')
      if (request.revision !== input.revision || request.completedAt) {
        throw new OrchestrationError(
          'conflict',
          'Privacy case changed or is already completed; reload it before reviewing'
        )
      }
      const revision = request.revision + 1
      const now = new Date()
      const recordReviewAudit = async (status: string, stores: string[] = []) => {
        await tx.insert(auditLog).values({
          id: generateId(),
          actorId: operatorId,
          action: AuditAction.PRIVACY_REQUEST_REVIEWED,
          resourceType: AuditResourceType.PRIVACY_REQUEST,
          resourceId: request.id,
          metadata: {
            operation: operation.id,
            actor: toPrincipalActor(principal),
            action: input.action,
            revision,
            previousStatus: request.status,
            status,
            previousAssignedToUserId: request.assignedToUserId,
            assignedToUserId: operatorId,
            stores,
          },
        })
      }
      if (input.action === 'assign') {
        const status = request.status === 'legal_hold' ? 'legal_hold' : 'processing'
        await tx
          .update(shopifyPrivacyRequest)
          .set({
            assignedToUserId: operatorId,
            revision,
            status,
            updatedAt: now,
          })
          .where(eq(shopifyPrivacyRequest.id, request.id))
        await recordReviewAudit(status)
        return { revision, status }
      }
      if (request.assignedToUserId !== operatorId) {
        throw new OrchestrationError(
          'forbidden',
          'Assign this case to yourself before recording fulfillment'
        )
      }
      const previous = request.encryptedEvidence
        ? (JSON.parse(
            (await decryptSecret(request.encryptedEvidence)).decrypted
          ) as ShopifyPrivacyReview)
        : null
      if (input.action === 'complete') {
        requireCompletionEvidence(request.topic, previous, operatorId)
        await tx
          .update(shopifyPrivacyRequest)
          .set({
            status: 'completed',
            revision,
            completedAt: now,
            completedByUserId: operatorId,
            encryptedPayload: '',
            updatedAt: now,
          })
          .where(eq(shopifyPrivacyRequest.id, request.id))
        await recordReviewAudit('completed', [...SHOPIFY_PRIVACY_STORES])
        return { revision, status: 'completed' }
      }
      if (!['record_evidence', 'legal_hold'].includes(input.action)) {
        throw new OrchestrationError('validation', 'Unsupported privacy review action')
      }
      validateEvidence(input.evidence ?? [])
      if (
        input.deliveryReference !== undefined &&
        (!input.deliveryReference.trim() || input.deliveryReference.length > 1000)
      ) {
        throw new OrchestrationError(
          'validation',
          'A bounded delivery record reference is required'
        )
      }
      const evidence = new Map(previous?.evidence.map((item) => [item.store, item]))
      for (const item of input.evidence ?? []) evidence.set(item.store, item)
      if (
        input.action === 'legal_hold' &&
        !(input.evidence ?? []).some((item) => item.outcome === 'legal_hold')
      ) {
        throw new OrchestrationError('validation', 'Legal retention needs documented hold evidence')
      }
      const review: ShopifyPrivacyReview = {
        scopeReviewed:
          input.scopeReviewed ??
          (previous?.reviewedByUserId === operatorId && previous.scopeReviewed),
        evidence: [...evidence.values()],
        ...(input.deliveryReference || previous?.deliveryReference
          ? { deliveryReference: input.deliveryReference ?? previous?.deliveryReference }
          : {}),
        reviewedByUserId: operatorId,
        reviewedAt: now.toISOString(),
      }
      const status = review.evidence.some((item) => item.outcome === 'legal_hold')
        ? 'legal_hold'
        : 'processing'
      const encryptedEvidence = (await encryptSecret(JSON.stringify(review))).encrypted
      await tx
        .update(shopifyPrivacyRequest)
        .set({ encryptedEvidence, status, revision, updatedAt: now })
        .where(eq(shopifyPrivacyRequest.id, request.id))
      await recordReviewAudit(
        status,
        (input.evidence ?? []).map((item) => item.store)
      )
      return { revision, status }
    })
  },
}
