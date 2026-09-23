import { db } from '@sim/db'
import {
  credential,
  credentialGroupEnrollment,
  knowledgeConnector,
  knowledgeConnectorMember,
} from '@sim/db/schema'
import { and, eq, exists, inArray, isNotNull, isNull, sql } from 'drizzle-orm'

/** Retains the viewer's account-level failure even after a run claims no due members. */
export function hasViewerMemberSyncError(userId: string) {
  return sql<boolean>`${exists(
    db
      .select({ id: knowledgeConnectorMember.id })
      .from(knowledgeConnectorMember)
      .innerJoin(credential, eq(credential.id, knowledgeConnectorMember.credentialId))
      .innerJoin(
        credentialGroupEnrollment,
        eq(credentialGroupEnrollment.id, credential.credentialGroupEnrollmentId)
      )
      .where(
        and(
          eq(knowledgeConnector.accessMode, 'members'),
          eq(knowledgeConnectorMember.connectorId, knowledgeConnector.id),
          eq(credentialGroupEnrollment.userId, userId),
          inArray(knowledgeConnectorMember.status, ['active', 'suspended']),
          inArray(credential.managedOauthStatus, ['active', 'needs_reauth']),
          isNull(credential.revokedAt),
          isNotNull(knowledgeConnectorMember.lastError)
        )
      )
  )}`
}
