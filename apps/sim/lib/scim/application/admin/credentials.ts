import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { SCIM_SCOPES, type ScimScope, scimConnection, scimCredential } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, count, eq, isNull, sql } from 'drizzle-orm'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { requireConnection, toCredentialView } from '@/lib/scim/application/admin/connection-view'
import {
  defineAuthorizedScimAdminUseCase,
  type ScimAdminUseCaseArgs,
} from '@/lib/scim/application/authorized-scim-admin-use-case'
import { scimAdminOperations } from '@/lib/scim/application/operations'
import { activeCredentialCondition, generateScimToken } from '@/lib/scim/authenticate'

/**
 * Issuing and revoking the bearer credentials a directory authenticates with.
 *
 * Two may be active at once. That is the whole point of rotation: an
 * administrator issues the replacement, updates the directory, confirms it
 * works, and only then revokes the old one — with no window where the directory
 * cannot authenticate.
 */
const MAX_ACTIVE_CREDENTIALS = 2

const DAY_MS = 24 * 60 * 60 * 1000

export interface IssueScimCredentialInput {
  organizationId: string
  scopes?: ScimScope[]
  expiresInDays?: number
}

export const issueScimCredential = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.issueCredential,
  async execute({ input, context }: ScimAdminUseCaseArgs<IssueScimCredentialInput>) {
    const connection = await requireConnection(context.organizationId)
    const { secret, hash, prefix } = generateScimToken()
    const scopes = input.scopes ?? [...SCIM_SCOPES]
    const expiresAt = input.expiresInDays
      ? new Date(Date.now() + input.expiresInDays * DAY_MS)
      : null

    const created = await db.transaction(async (tx) => {
      /** The connection row is the lock, so two issue requests cannot both see one free slot. */
      await tx
        .select({ id: scimConnection.id })
        .from(scimConnection)
        .where(eq(scimConnection.id, connection.id))
        .for('update')

      const [active] = await tx
        .select({ value: count() })
        .from(scimCredential)
        .where(activeCredentialCondition(connection.id))
      if ((active?.value ?? 0) >= MAX_ACTIVE_CREDENTIALS) {
        throw new OrchestrationError(
          'conflict',
          `At most ${MAX_ACTIVE_CREDENTIALS} credentials may be active at once. Revoke one before issuing another.`
        )
      }

      const [row] = await tx
        .insert(scimCredential)
        .values({
          id: generateId(),
          connectionId: connection.id,
          tokenHash: hash,
          tokenPrefix: prefix,
          scopes,
          expiresAt,
          createdBy: context.actorUserId,
        })
        .returning({
          id: scimCredential.id,
          tokenPrefix: scimCredential.tokenPrefix,
          scopes: scimCredential.scopes,
          expiresAt: scimCredential.expiresAt,
          lastUsedAt: scimCredential.lastUsedAt,
          createdAt: scimCredential.createdAt,
        })
      return row
    })

    return { secret, credential: toCredentialView(created), connectionId: connection.id }
  },
  /** The prefix identifies the credential; the secret is never recorded. */
  projectAudit: ({ result }) => ({
    action: AuditAction.SCIM_CREDENTIAL_ISSUED,
    resourceType: AuditResourceType.SCIM_CONNECTION,
    resourceId: result.connectionId,
    metadata: { tokenPrefix: result.credential.tokenPrefix, scopes: result.credential.scopes },
  }),
})

export const revokeScimCredential = defineAuthorizedScimAdminUseCase({
  operation: scimAdminOperations.revokeCredential,
  async execute({
    input,
    context,
  }: ScimAdminUseCaseArgs<{ organizationId: string; credentialId: string }>) {
    const [revoked] = await db
      .update(scimCredential)
      .set({ revokedAt: new Date(), revokedBy: context.actorUserId })
      .where(
        and(
          eq(scimCredential.id, input.credentialId),
          isNull(scimCredential.revokedAt),
          sql`${scimCredential.connectionId} in (
            select ${scimConnection.id} from ${scimConnection}
            where ${scimConnection.organizationId} = ${context.organizationId}
          )`
        )
      )
      .returning({ id: scimCredential.id, tokenPrefix: scimCredential.tokenPrefix })

    if (!revoked) throw new OrchestrationError('not_found', 'Credential not found')
    return { success: true as const, revoked }
  },
  projectAudit: ({ result }) => ({
    action: AuditAction.SCIM_CREDENTIAL_REVOKED,
    resourceType: AuditResourceType.SCIM_CONNECTION,
    resourceId: result.revoked.id,
    metadata: { tokenPrefix: result.revoked.tokenPrefix },
  }),
})
