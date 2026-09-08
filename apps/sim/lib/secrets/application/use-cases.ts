import { AuditAction, AuditResourceType } from '@sim/audit'
import type { Principal } from '@sim/auth/principal'
import type { CursorKey, ListSortOrder } from '@/lib/api/list-query'
import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { ForbiddenOperationError } from '@/lib/core/application/forbidden'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  getPersonalEnvCredentialMetadata,
  getWorkspaceEnvKeyAdminAccess,
  hasWorkspaceEnvValue,
} from '@/lib/credentials/environment'
import {
  listVisibleWorkspaceCredentials,
  type VisibleWorkspaceCredential,
} from '@/lib/credentials/queries'
import {
  deletePersonalSecret,
  deleteWorkspaceSecret,
  readWorkspaceSecretValues,
  setPersonalSecret,
  setWorkspaceSecret,
  updateWorkspaceSecretMetadata,
} from '@/lib/credentials/secret-values'
import { secretOperations } from '@/lib/secrets/application/operations'
import { scanSecretReferences } from '@/lib/secrets/references/scan'
import { getSecretUsage } from '@/lib/secrets/usage/queries'
import { loadActiveWorkspaceContext } from '@/lib/uploads/contexts/workspace'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'

export type SecretScope = 'workspace' | 'personal'
export type SecretSortBy = 'name' | 'createdAt' | 'updatedAt'

interface SecretWorkspaceContext {
  workspaceId: string
  workspaceOrganizationId: string | null
  allowPersonalApiKeys: boolean
  billedAccountUserId: string
}

async function resolveWorkspaceContext(workspaceId: string): Promise<SecretWorkspaceContext> {
  const context = await loadActiveWorkspaceContext(workspaceId)
  if (!context) throw new OrchestrationError('not_found', 'Workspace not found')
  return context
}

function principalUserId(
  principal: Extract<Principal, { kind: 'session' | 'personal_api_key' | 'oauth_access_token' }>
): string {
  return principal.userId
}

function credentialTypes(scope?: SecretScope) {
  if (scope === 'workspace') return ['env_workspace'] as const
  if (scope === 'personal') return ['env_personal'] as const
  return ['env_workspace', 'env_personal'] as const
}

/**
 * Reads secret metadata for the caller.
 *
 * `ownedEnvSecretsOnly` is what keeps another user's personal secret out of the
 * result. It used to be a JS filter applied after the query; it lives in SQL now
 * because trimming rows after the page is cut would hand the caller fewer than
 * `limit` rows while `nextCursor` still promised more.
 *
 * The secret's public `name` is stored as the credential `displayName`, so the
 * caller-facing `name` sort aliases to that column here. The alias must not
 * escape into the cursor's sort stamp — see {@link listSecretsUseCase}.
 */
async function listSecretMetadata(params: {
  workspaceId: string
  userId: string
  scope?: SecretScope
  search?: string
  sortBy: SecretSortBy
  sortOrder: ListSortOrder
  limit?: number
  cursorKeys?: CursorKey[]
}): Promise<{ data: VisibleWorkspaceCredential[]; nextCursorKeys: CursorKey[] | null }> {
  const workspaceAccess = await checkWorkspaceAccess(params.workspaceId, params.userId)
  return listVisibleWorkspaceCredentials({
    workspaceId: params.workspaceId,
    userId: params.userId,
    workspaceAccess,
    types: [...credentialTypes(params.scope)],
    search: params.search,
    sortBy: params.sortBy === 'name' ? 'displayName' : params.sortBy,
    sortOrder: params.sortOrder,
    limit: params.limit,
    cursorKeys: params.cursorKeys,
    ownedEnvSecretsOnly: true,
  })
}

async function requireWorkspaceSecretMutationAccess(params: {
  workspaceId: string
  name: string
  userId: string
}): Promise<void> {
  const [workspaceAccess, keyAccess] = await Promise.all([
    checkWorkspaceAccess(params.workspaceId, params.userId),
    getWorkspaceEnvKeyAdminAccess({
      workspaceId: params.workspaceId,
      envKeys: [params.name],
      userId: params.userId,
    }),
  ])

  if (keyAccess.knownKeys.has(params.name)) {
    if (!workspaceAccess.canAdmin && !keyAccess.adminKeys.has(params.name)) {
      throw new ForbiddenOperationError(
        'SECRET_ADMIN_ACCESS_REQUIRED',
        'Credential admin permission required for this secret'
      )
    }
    return
  }
  if (!workspaceAccess.canWrite) {
    throw new ForbiddenOperationError(
      'INSUFFICIENT_WORKSPACE_ROLE',
      'Write permission required to set this secret'
    )
  }
}

async function findSecretMetadata(params: {
  workspaceId: string
  userId: string
  scope: SecretScope
  name: string
}): Promise<VisibleWorkspaceCredential | null> {
  const { data } = await listSecretMetadata({
    ...params,
    search: params.name,
    sortBy: 'name',
    sortOrder: 'asc',
  })
  return (
    data.find(
      (candidate) =>
        candidate.envKey === params.name &&
        (params.scope === 'workspace'
          ? candidate.type === 'env_workspace'
          : candidate.type === 'env_personal' && candidate.envOwnerUserId === params.userId)
    ) ?? null
  )
}

async function getWorkspaceSecretMetadata(params: {
  workspaceId: string
  userId: string
  name: string
}): Promise<VisibleWorkspaceCredential> {
  const row = await findSecretMetadata({ ...params, scope: 'workspace' })
  if (!row) throw new Error(`Secret metadata was not created for workspace:${params.name}`)
  return row
}

/**
 * Resolves the metadata a personal-scope write reports back.
 *
 * A personal secret is stored once per user, and its `env_personal` credential
 * rows are per-workspace mirrors written only for the workspaces the caller holds
 * an explicit grant on. A caller whose access to this workspace is inherited — an
 * organization admin with no `permissions` row — authorizes fine and commits the
 * value, but has no mirror here; deciding the response from that mirror would
 * report a committed write as a failure. The workspace's own mirror still answers
 * when it exists because it carries the real per-workspace metadata; otherwise the
 * secret's earliest mirror does, and a secret with no mirror anywhere was created
 * by this very write.
 */
async function getPersonalSecretMetadata(params: {
  workspaceId: string
  userId: string
  name: string
  updatedAt: Date
}): Promise<VisibleWorkspaceCredential> {
  const mirror = await findSecretMetadata({
    workspaceId: params.workspaceId,
    userId: params.userId,
    scope: 'personal',
    name: params.name,
  })
  if (mirror) return mirror

  const stored = await getPersonalEnvCredentialMetadata({
    userId: params.userId,
    envKey: params.name,
  })

  return {
    /** No credential row backs this projection; the id is never presented. */
    id: stored?.id ?? `env_personal:${params.userId}:${params.name}`,
    workspaceId: params.workspaceId,
    type: 'env_personal',
    displayName: params.name,
    description: null,
    unredacted: false,
    providerId: null,
    accountId: null,
    envKey: params.name,
    envOwnerUserId: params.userId,
    createdBy: params.userId,
    createdAt: stored?.createdAt ?? params.updatedAt,
    updatedAt: params.updatedAt,
    hasServiceAccountKey: false,
    role: 'admin',
  }
}

const authorizationOptions = {}

export interface ListSecretsInput {
  workspaceId: string
  scope?: SecretScope
  search?: string
  sortBy: SecretSortBy
  sortOrder: ListSortOrder
  limit: number
  cursorKeys?: CursorKey[]
}

/**
 * Lists secret metadata as one keyset page.
 *
 * `sortBy`/`sortOrder` are echoed back in the caller's own vocabulary — `name`,
 * not the `displayName` column it aliases to — because the presenter stamps the
 * cursor with them and the route re-checks that stamp on replay. Stamping the
 * aliased column name would make every cursor minted under `name` fail to
 * validate on the next request.
 */
export const listSecretsUseCase = defineAuthorizedWorkspaceUseCase({
  operation: secretOperations.list,
  resolveContext: ({ input }: { input: ListSecretsInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const userId = principalUserId(principal)
    const page = await listSecretMetadata({
      ...input,
      workspaceId: context.workspaceId,
      userId,
    })
    /**
     * The one place a secret value rides a read response: rows the workspace marked
     * visible (unredacted) — whose values already print into every run log this
     * caller can open — so external agents don't have to scrape logs for them.
     * Bounded by the page, and read from one environment row.
     */
    const visibleNames = page.data.flatMap((row) =>
      row.type === 'env_workspace' && row.unredacted && row.envKey ? [row.envKey] : []
    )
    const values = await readWorkspaceSecretValues({
      workspaceId: context.workspaceId,
      names: visibleNames,
    })
    return {
      secrets: page.data,
      values,
      nextCursorKeys: page.nextCursorKeys,
      userId,
      sortBy: input.sortBy,
      sortOrder: input.sortOrder,
    }
  },
})

export interface SetSecretInput {
  workspaceId: string
  name: string
  scope: SecretScope
  /**
   * Omitted for a workspace-scope metadata-only write, which updates `description`
   * and `unredacted` alone and never re-encrypts or replaces the stored value.
   * Required for personal scope, which has no other writable field.
   */
  value?: string
  /**
   * Workspace scope only, and rejected at the contract for personal scope: an
   * `env_personal` row is a per-workspace mirror of one user-global secret, so a
   * description written here would exist in this workspace alone.
   */
  description?: string | null
  /** Redaction opt-out; workspace scope only, for the same mirror-row reason as description. */
  unredacted?: boolean
}

export const setSecretUseCase = defineAuthorizedWorkspaceUseCase({
  operation: secretOperations.set,
  resolveContext: ({ input }: { input: SetSecretInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const userId = principalUserId(principal)
    if (input.scope === 'personal' && input.description !== undefined) {
      throw new OrchestrationError(
        'validation',
        'description is only supported for a workspace secret'
      )
    }
    if (input.scope === 'personal' && input.unredacted !== undefined) {
      throw new OrchestrationError(
        'validation',
        'unredacted is only supported for a workspace secret'
      )
    }
    if (input.scope === 'workspace') {
      await requireWorkspaceSecretMutationAccess({
        workspaceId: context.workspaceId,
        name: input.name,
        userId,
      })
    }

    if (input.scope === 'workspace') {
      /**
       * A value-less workspace write takes the update-only manager: no encryption,
       * no variables rewrite, and no credential insert, so it cannot create a
       * secret and cannot cost the caller a re-transmission of the plaintext. A
       * miss is a 404, and `created: false` keeps the route answering 200 for
       * something it did not create.
       */
      if (input.value === undefined) {
        /**
         * A write that names none of the three writable fields would still issue
         * the UPDATE, stamping `updatedAt` and dropping the workspace's env cache
         * entry for nothing. The contract rejects it; this repeats the guard for
         * every other surface that reaches the use case directly.
         */
        if (input.description === undefined && input.unredacted === undefined) {
          throw new OrchestrationError(
            'validation',
            'value, description, or unredacted is required'
          )
        }

        const metadata = await updateWorkspaceSecretMetadata({
          workspaceId: context.workspaceId,
          name: input.name,
          description: input.description,
          unredacted: input.unredacted,
        })
        if (!metadata) throw new OrchestrationError('not_found', 'Secret not found')
        /**
         * The response read is a second statement, so a delete committed between
         * the two leaves nothing to report back. That is the same disappearance
         * the miss above answers, so it answers the same way rather than raising
         * the unclassified fault a "must exist" read would.
         */
        const updated = await findSecretMetadata({
          workspaceId: context.workspaceId,
          userId,
          scope: 'workspace',
          name: input.name,
        })
        if (!updated) throw new OrchestrationError('not_found', 'Secret not found')
        return { secret: updated, userId, created: false }
      }

      const mutation = await setWorkspaceSecret({
        workspaceId: context.workspaceId,
        name: input.name,
        value: input.value,
        userId,
        description: input.description,
        unredacted: input.unredacted,
      })
      const secret = await getWorkspaceSecretMetadata({
        workspaceId: context.workspaceId,
        userId,
        name: input.name,
      })
      return { secret, userId, created: mutation.created }
    }

    /**
     * Personal scope has no metadata field, so a value-less write here could only be
     * a silent no-op. The contract rejects it; this repeats the guard for every
     * other surface that reaches the use case directly.
     */
    if (input.value === undefined) {
      throw new OrchestrationError('validation', 'value is required for a personal secret')
    }

    const mutation = await setPersonalSecret({ userId, name: input.name, value: input.value })
    const secret = await getPersonalSecretMetadata({
      workspaceId: context.workspaceId,
      userId,
      name: input.name,
      updatedAt: mutation.updatedAt,
    })
    return { secret, userId, created: mutation.created }
  },
  projectAudit: ({ input }) => ({
    action: AuditAction.ENVIRONMENT_UPDATED,
    resourceType: AuditResourceType.ENVIRONMENT,
    resourceId: `${input.scope}:${input.name}`,
    resourceName: input.name,
    description:
      input.value === undefined
        ? `Updated ${input.scope} secret "${input.name}" metadata`
        : `Set ${input.scope} secret "${input.name}"`,
    metadata: {
      scope: input.scope,
      name: input.name,
      ...(input.description !== undefined ? { descriptionUpdated: true } : {}),
      /** The value, not just a marker: enabling visibility is the security-relevant event. */
      ...(input.unredacted !== undefined ? { unredacted: input.unredacted } : {}),
    },
  }),
})

export interface DeleteSecretInput {
  workspaceId: string
  name: string
  scope: SecretScope
}

export const deleteSecretUseCase = defineAuthorizedWorkspaceUseCase({
  operation: secretOperations.delete,
  resolveContext: ({ input }: { input: DeleteSecretInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const userId = principalUserId(principal)
    if (input.scope === 'workspace') {
      await requireWorkspaceSecretMutationAccess({
        workspaceId: context.workspaceId,
        name: input.name,
        userId,
      })
    }

    const deleted =
      input.scope === 'workspace'
        ? await deleteWorkspaceSecret({ workspaceId: context.workspaceId, name: input.name })
        : await deletePersonalSecret({ userId, name: input.name })
    if (!deleted) throw new OrchestrationError('not_found', 'Secret not found')
    return { name: input.name, scope: input.scope }
  },
  projectAudit: ({ input }) => ({
    action: AuditAction.ENVIRONMENT_DELETED,
    resourceType: AuditResourceType.ENVIRONMENT,
    resourceId: `${input.scope}:${input.name}`,
    resourceName: input.name,
    description: `Deleted ${input.scope} secret "${input.name}"`,
    metadata: { scope: input.scope, name: input.name },
  }),
})

export interface ListSecretUsageInput {
  workspaceId: string
  name: string
  scope: SecretScope
  limit: number
}

/**
 * Gates the usage trail behind the same permission that reveals the value.
 *
 * The trail names workflows, people, and run ids. Someone who may use a secret but not read
 * it has no claim on that, and letting a Member enumerate who else uses a key would hand back
 * a slice of exactly what the value masking withholds. Workspace secrets therefore require
 * workspace-admin or credential-admin on that key — the same predicate
 * `maskWorkspaceEnvForViewer` applies — while a personal secret is only ever the caller's own.
 */
async function requireSecretUsageReadAccess(params: {
  workspaceId: string
  name: string
  scope: SecretScope
  userId: string
}): Promise<void> {
  /**
   * Safe to trust the asserted scope here, and only here: the read below is NARROWED by it to
   * `secretOwnerUserId`, so asserting `personal` for a workspace key returns the caller's own
   * (empty) trail rather than the workspace one. A read that is not scope-narrowed must not
   * reuse this — see {@link requireSecretReferencesReadAccess}.
   */
  if (params.scope === 'personal') return

  const [workspaceAccess, keyAccess] = await Promise.all([
    checkWorkspaceAccess(params.workspaceId, params.userId),
    getWorkspaceEnvKeyAdminAccess({
      workspaceId: params.workspaceId,
      envKeys: [params.name],
      userId: params.userId,
    }),
  ])

  if (!workspaceAccess.canAdmin && !keyAccess.adminKeys.has(params.name)) {
    throw new ForbiddenOperationError(
      'SECRET_ADMIN_ACCESS_REQUIRED',
      'Credential admin permission required to view this secret usage'
    )
  }
}

export const listSecretUsageUseCase = defineAuthorizedWorkspaceUseCase({
  operation: secretOperations.usage,
  resolveContext: ({ input }: { input: ListSecretUsageInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const userId = principalUserId(principal)
    await requireSecretUsageReadAccess({
      workspaceId: context.workspaceId,
      name: input.name,
      scope: input.scope,
      userId,
    })

    return getSecretUsage({
      workspaceId: context.workspaceId,
      secretName: input.name,
      secretScope: input.scope,
      /**
       * A personal trail is only ever the caller's own. Scoping the read to their id is what
       * enforces that — two people can hold a personal `OPENAI_KEY`, and a name-and-scope
       * filter alone would hand each of them the other's workflows, actors, and run links.
       * A workspace secret has no owner, so it reads under the storage sentinel.
       */
      secretOwnerUserId: input.scope === 'personal' ? userId : '',
      limit: input.limit,
    })
  },
})

/**
 * Deliberately carries no `scope`. A reference is found by name, so a scope here could only be
 * an assertion the caller controls and the read never narrows by — exactly the shape that made
 * the first cut of this operation bypassable. The name alone decides both access and result.
 */
export interface ListSecretReferencesInput {
  workspaceId: string
  name: string
}

/**
 * Gates the reference scan on what the NAME resolves to, never on the scope the caller asserts.
 *
 * The usage trail can trust `scope` because it narrows the read by it — a personal request is
 * filtered to `secretOwnerUserId`, so asserting `personal` for a workspace key returns nothing.
 * A reference scan cannot: `{{KEY}}` names a key and not a scope, so the scan is name-based and
 * workspace-wide by construction. Reusing the trail's gate therefore made `scope=personal` a
 * bypass — it returns before any check, and a member could read the admin-gated map for any
 * workspace secret by naming it under personal scope.
 *
 * So the asserted scope is discarded here and the canonical name decides:
 *  - a workspace secret exists under this name → only its admins (or a workspace admin) may look,
 *    which is the same predicate that reveals its value;
 *  - no workspace secret exists → the caller must actually hold a personal secret of that name,
 *    which stops a member enumerating arbitrary names for a map they have no claim to.
 */
/**
 * Which branch authorized the read. `personal` depends on no workspace value existing under the
 * name — a condition another request can change — so only that branch needs re-checking after
 * the scan. An `admin` caller stays authorized however the name resolves, and pays nothing.
 */
type SecretReferencesGrant = 'admin' | 'personal'

async function requireSecretReferencesReadAccess(params: {
  workspaceId: string
  name: string
  userId: string
}): Promise<SecretReferencesGrant> {
  const [workspaceAccess, keyAccess] = await Promise.all([
    checkWorkspaceAccess(params.workspaceId, params.userId),
    getWorkspaceEnvKeyAdminAccess({
      workspaceId: params.workspaceId,
      envKeys: [params.name],
      userId: params.userId,
    }),
  ])
  if (workspaceAccess.canAdmin || keyAccess.adminKeys.has(params.name)) return 'admin'

  const forbidden = new ForbiddenOperationError(
    'SECRET_ADMIN_ACCESS_REQUIRED',
    'Credential admin permission required to view this secret usage'
  )

  /**
   * A workspace value under this name is admin-gated outright — a personal secret the caller
   * happens to hold under the same name does not unlock the workspace one's reference map,
   * and at run time the workspace value is the one that wins anyway.
   *
   * Read from the authoritative variables map rather than `keyAccess.knownKeys`: that set only
   * covers names with an `env_workspace` credential row, so a legacy value written before the
   * ACL existed would look like "no workspace secret here" and fall through to the personal
   * branch — handing a non-admin the map for exactly the oldest keys.
   */
  if (await hasWorkspaceEnvValue({ workspaceId: params.workspaceId, envKey: params.name })) {
    throw forbidden
  }

  const owned = await getPersonalEnvCredentialMetadata({
    userId: params.userId,
    envKey: params.name,
  })
  if (!owned) throw forbidden
  return 'personal'
}

export const listSecretReferencesUseCase = defineAuthorizedWorkspaceUseCase({
  operation: secretOperations.references,
  resolveContext: ({ input }: { input: ListSecretReferencesInput }) =>
    resolveWorkspaceContext(input.workspaceId),
  authorizationOptions,
  async execute({ principal, input, context }) {
    const userId = principalUserId(principal)
    const grant = await requireSecretReferencesReadAccess({
      workspaceId: context.workspaceId,
      name: input.name,
      userId,
    })

    /**
     * Name-based, not scope-narrowed: the same reference sites answer for a workspace secret and
     * for the personal one it shadows. Narrowing by scope would report a personal secret as
     * unreferenced the moment a workspace variable of the same name existed.
     */
    const scan = await scanSecretReferences({
      workspaceId: context.workspaceId,
      name: input.name,
    })

    /**
     * Re-check the one input that can change under us. A `personal` grant rests on no workspace
     * value existing under this name; a workspace secret created between the check and the scan
     * would make the very map now in hand admin-gated. The read is cheap and skipped entirely
     * for an `admin` grant, and failing closed here costs a non-admin nothing they were entitled
     * to keep — the request is simply refused the way it would have been a moment later.
     */
    if (
      grant === 'personal' &&
      (await hasWorkspaceEnvValue({ workspaceId: context.workspaceId, envKey: input.name }))
    ) {
      throw new ForbiddenOperationError(
        'SECRET_ADMIN_ACCESS_REQUIRED',
        'Credential admin permission required to view this secret usage'
      )
    }

    return scan
  },
})
