import type { Principal } from '@sim/auth/principal'
import { resolvePrincipalAuditAttribution } from '@sim/auth/principal'
import { db } from '@sim/db'
import { type ScimConnectionSettings, scimConnection } from '@sim/db/schema'
import { eq } from 'drizzle-orm'
import type { OperationUseCase } from '@/lib/core/application'
import type { OrchestrationRequestContext } from '@/lib/core/orchestration/types'
import { recordScimAuditEntries, type ScimAuditEntry } from '@/ee/scim/lib/application/audit'
import type { ScimOperation, ScimPrincipal } from '@/ee/scim/lib/application/operations'
import { scimBaseUrl } from '@/ee/scim/lib/base-url'
import { ScimError } from '@/ee/scim/lib/protocol/errors'

/**
 * The authorized wrapper every directory operation runs inside.
 *
 * It owns the lifecycle the application boundary prescribes — principal check,
 * canonical load, authorization, execute, audit projection, post-commit effects
 * — for an operation whose scope is an organization rather than a workspace, so
 * it cannot use `defineAuthorizedWorkspaceUseCase`.
 */

export interface ScimUseCaseContext {
  connection: {
    id: string
    organizationId: string
    settings: ScimConnectionSettings
  }
  organizationId: string
  /** Absolute base for `meta.location` and `$ref`, e.g. `https://sim.ai/api/scim/v2`. */
  baseUrl: string
}

export interface ScimUseCaseArgs<I> {
  principal: ScimPrincipal
  input: I
  context: ScimUseCaseContext
  request?: OrchestrationRequestContext
}

export interface ScimUseCaseResultArgs<I, R> extends ScimUseCaseArgs<I> {
  result: R
}

interface AuthorizedScimUseCaseDefinition<O extends ScimOperation, I, R> {
  operation: O
  execute(args: ScimUseCaseArgs<I>): Promise<R>
  projectAudit?(args: ScimUseCaseResultArgs<I, R>): ScimAuditEntry | ScimAuditEntry[] | undefined
  afterSuccess?(args: ScimUseCaseResultArgs<I, R>): Promise<void>
}

function requireScimPrincipal(
  principal: Principal,
  operation: ScimOperation
): asserts principal is ScimPrincipal {
  if (principal.kind !== 'scim_connection') {
    throw new Error(
      `Operation ${operation.id} reached by principal kind ${principal.kind}, which its policy does not name`
    )
  }
}

/**
 * Re-reads the connection on every operation.
 *
 * Authentication already resolved it, but a long-running provisioning cycle can
 * outlive an administrator disabling the connection. Reading it here means the
 * next request in that cycle stops, rather than the cycle continuing until its
 * credential happens to be checked again.
 */
async function loadActiveConnection(
  connectionId: string
): Promise<ScimUseCaseContext['connection']> {
  const [row] = await db
    .select({
      id: scimConnection.id,
      organizationId: scimConnection.organizationId,
      status: scimConnection.status,
      settings: scimConnection.settings,
    })
    .from(scimConnection)
    .where(eq(scimConnection.id, connectionId))
    .limit(1)

  if (!row || row.status !== 'active') {
    throw new ScimError(401, undefined, 'Invalid SCIM token', {
      'WWW-Authenticate': 'Bearer realm="SCIM"',
    })
  }
  return { id: row.id, organizationId: row.organizationId, settings: row.settings }
}

export function defineAuthorizedScimUseCase<const O extends ScimOperation, I, R>(
  definition: AuthorizedScimUseCaseDefinition<O, I, R>
): OperationUseCase<O, I, R> {
  return {
    operation: definition.operation,
    async execute({ principal, input, request }) {
      requireScimPrincipal(principal, definition.operation)

      if (!principal.scopes.includes(definition.operation.scope)) {
        throw new ScimError(
          403,
          undefined,
          `The credential does not carry the ${definition.operation.scope} scope`
        )
      }

      const connection = await loadActiveConnection(principal.connectionId)
      if (connection.organizationId !== principal.organizationId) {
        /**
         * Unreachable through the authenticator, which reads both from the same
         * joined row. Asserted anyway because every query below is scoped by the
         * connection alone, so a mismatch here would be a cross-tenant read.
         */
        throw new Error('SCIM connection organization does not match its principal')
      }

      const context: ScimUseCaseContext = {
        connection,
        organizationId: connection.organizationId,
        baseUrl: scimBaseUrl(),
      }

      const result = await definition.execute({ principal, input, context, request })
      const resultArgs = { principal, input, context, request, result }

      const projected = definition.projectAudit?.(resultArgs)
      const entries =
        projected === undefined ? [] : Array.isArray(projected) ? projected : [projected]
      if (entries.length > 0) {
        /**
         * The actor is the connection, never a person: nobody was at a keyboard
         * when the directory synchronized, and naming the administrator who
         * configured it would attribute months of automated changes to one login.
         */
        const attribution = resolvePrincipalAuditAttribution(principal)
        recordScimAuditEntries({
          actorId: attribution.actorId,
          actorName: attribution.actorName ?? undefined,
          entries,
          metadata: {
            organizationId: context.organizationId,
            connectionId: context.connection.id,
            credentialId: principal.credentialId,
            operation: definition.operation.id,
            source: 'scim',
            actor: attribution.actor,
          },
          request,
        })
      }

      await definition.afterSuccess?.(resultArgs)
      return result
    },
  }
}
