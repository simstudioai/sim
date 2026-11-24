/**
 * Binding workspace source keys to credentials: `credentials.ts` names each credential a workflow
 * uses by a key (`credential('slack')`), and an apply binds or releases that key here. No
 * credential changes, but every workflow naming the key resolves it to the bound credential from
 * the next apply on, so binding takes write, re-checks that the caller sees each credential it
 * touches (the one bound, and the one a rebind moves the key off), and is audited.
 */
import { AuditAction, AuditResourceType } from '@sim/audit'
import { type Principal, resolvePrincipalSubjectUserId } from '@sim/auth/principal'
import { db } from '@sim/db'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { listCredentialsVisibleTo } from '@/lib/credentials/application/list-workspace-credentials'
import { credentialOperations } from '@/lib/credentials/application/operations'
import { loadActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/context'
import {
  claimResourceKey,
  lockKeyHolder,
  type ResourceKeyClaim,
  releaseResourceKey,
} from '@/lib/workspaces/resource-keys'

interface BindCredentialKeyInput {
  workspaceId: string
  key: string
  credentialId: string
  /**
   * The credential the key may move off (a source rebinding the key on purpose); any other live
   * credential holding it refuses the bind.
   */
  takeFrom?: string
}

interface BindCredentialKeyResult {
  /** Bound anew, already bound to it, or moved off a credential (`takeFrom`, or a deleted one). */
  claim: ResourceKeyClaim
  credentialId: string
  credentialName: string
  /** The credential the key was bound to before, when another. */
  previousCredentialId: string | null
}

interface ReleaseCredentialKeyInput {
  workspaceId: string
  key: string
  credentialId: string
}

interface ReleaseCredentialKeyResult {
  /** Whether the key was bound to the credential and is now free. */
  released: boolean
  credentialId: string
  credentialName: string
}

async function resolveWorkspace(workspaceId: string) {
  const context = await loadActiveWorkspaceApplicationContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

/**
 * The display name of each of `ids` the caller's credential listing shows; a credential it does
 * not show (another member's, deleted, or of another workspace) is not found, as it is to them.
 */
async function requireVisible(
  principal: Principal,
  workspaceId: string,
  ids: readonly string[]
): Promise<Map<string, string>> {
  const unique = [...new Set(ids)]
  const { credentials } = await listCredentialsVisibleTo(principal, workspaceId, {
    ids: unique,
    sortBy: 'createdAt',
    sortOrder: 'asc',
    limit: unique.length,
  })
  const names = new Map(credentials.map((credential) => [credential.id, credential.displayName]))
  if (unique.some((id) => !names.has(id))) {
    throw new OrchestrationError('not_found', 'Credential not found')
  }
  return names
}

/**
 * Binds `key` to a credential the caller sees, moving it off `takeFrom` (also one they see) when
 * that holds it, or off a deleted credential. A key another live credential holds is refused
 * (`ResourceKeyTakenError`). Audits every bind that moved the key, with the credential it left.
 */
export const bindCredentialKey = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.bindKey,
  resolveContext: ({ input }: { input: BindCredentialKeyInput }) =>
    resolveWorkspace(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<BindCredentialKeyResult> {
    const names = await requireVisible(principal, context.workspaceId, [
      input.credentialId,
      ...(input.takeFrom ? [input.takeFrom] : []),
    ])
    const { claim, previous } = await db.transaction(async (tx) => {
      const previous = await lockKeyHolder(tx, context.workspaceId, 'credential', input.key)
      const claim = await claimResourceKey({
        workspaceId: context.workspaceId,
        kind: 'credential',
        key: input.key,
        resourceId: input.credentialId,
        origin: 'adopted',
        createdBy: resolvePrincipalSubjectUserId(principal) ?? null,
        ...(input.takeFrom ? { takeFrom: input.takeFrom } : {}),
        tx,
      })
      return { claim, previous }
    })
    return {
      claim,
      credentialId: input.credentialId,
      credentialName: names.get(input.credentialId) ?? '',
      previousCredentialId: previous !== input.credentialId ? previous : null,
    }
  },
  projectAudit: ({ input, result }) =>
    result.claim === 'kept'
      ? []
      : {
          action: AuditAction.CREDENTIAL_KEY_BOUND,
          resourceType: AuditResourceType.CREDENTIAL,
          resourceId: result.credentialId,
          resourceName: result.credentialName,
          description: `Bound the credential key "${input.key}" to "${result.credentialName}"`,
          metadata: {
            key: input.key,
            credentialId: result.credentialId,
            previousCredentialId: result.previousCredentialId,
          },
        },
})

/**
 * Unbinds `key` from a credential the caller sees; a key bound to anything else is left as it
 * is. The credential is untouched. Audits a release that freed the key.
 */
export const releaseCredentialKey = defineAuthorizedWorkspaceUseCase({
  operation: credentialOperations.releaseKey,
  resolveContext: ({ input }: { input: ReleaseCredentialKeyInput }) =>
    resolveWorkspace(input.workspaceId),
  authorizationOptions: {},
  async execute({ principal, input, context }): Promise<ReleaseCredentialKeyResult> {
    const names = await requireVisible(principal, context.workspaceId, [input.credentialId])
    const released = await releaseResourceKey({
      workspaceId: context.workspaceId,
      kind: 'credential',
      key: input.key,
      resourceId: input.credentialId,
    })
    return {
      released,
      credentialId: input.credentialId,
      credentialName: names.get(input.credentialId) ?? '',
    }
  },
  projectAudit: ({ input, result }) =>
    result.released
      ? {
          action: AuditAction.CREDENTIAL_KEY_RELEASED,
          resourceType: AuditResourceType.CREDENTIAL,
          resourceId: result.credentialId,
          resourceName: result.credentialName,
          description: `Released the credential key "${input.key}" from "${result.credentialName}"`,
          metadata: { key: input.key, credentialId: result.credentialId },
        }
      : [],
})
