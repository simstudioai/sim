import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import type { ScimUserAttributes } from '@sim/db/schema'
import { normalizeEmail } from '@sim/utils/string'
import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import type { DbOrTx } from '@/lib/db/types'
import { suspendMemberTx, unsuspendMemberTx } from '@/lib/organizations/members/lifecycle'
import {
  invalidateAfterSessionRevocation,
  revokeUserSessionsTx,
} from '@/lib/organizations/members/revocation'
import type { ScimAuditEntry } from '@/ee/scim/lib/application/audit'
import {
  defineAuthorizedScimUseCase,
  type ScimUseCaseArgs,
  type ScimUseCaseContext,
} from '@/ee/scim/lib/application/authorized-scim-use-case'
import { scimOperations } from '@/ee/scim/lib/application/operations'
import { syncAccountIdentityTx } from '@/ee/scim/lib/identity/account-identity'
import { assertDomainOwned } from '@/ee/scim/lib/identity/resolve-user'
import { reconcileUserProjection } from '@/ee/scim/lib/projection/reconcile-user'
import { primaryEmail } from '@/ee/scim/lib/protocol/canonical'
import { notFound, ScimError } from '@/ee/scim/lib/protocol/errors'
import { toUserResource } from '@/ee/scim/lib/protocol/resources'
import { applyUserPatch, userAttributesEqual } from '@/ee/scim/lib/protocol/user-patch'
import {
  assertUserNameAvailable,
  findScimUserById,
  loadGroupsForScimUsers,
  type ScimUserRecord,
  toUserResourceRow,
  updateScimUser,
} from '@/ee/scim/lib/repository/users'

/**
 * The write half of the User resource.
 *
 * `PUT` and `PATCH` differ only in how they arrive at the next resource — one
 * carries it whole, the other as operations against the stored copy. They share
 * everything after that, so the two cannot drift on what an email change or a
 * deactivation actually does.
 */

export interface UpdateOutcome {
  emailChanged: boolean
  deactivated: boolean
  reactivated: boolean
}

async function applyUserUpdate(
  tx: DbOrTx,
  context: ScimUseCaseContext,
  current: ScimUserRecord,
  next: ScimUserAttributes
): Promise<UpdateOutcome> {
  const nextEmail = primaryEmail(next)
  const emailChanged = accountEmailDiverged(current, next)
  const deactivated = current.active && !next.active
  const reactivated = !current.active && next.active

  if (next.userName !== current.userName) {
    await assertUserNameAvailable(tx, context.connection.id, next.userName, current.id)
  }

  if (emailChanged) {
    /**
     * A directory may only move an account to an address in a domain the
     * organization has proven it owns. Without that, a tenant could point
     * someone else's Sim account at a mailbox it controls and recover it.
     */
    await assertDomainOwned(tx, context.organizationId, nextEmail)
    await syncAccountIdentityTx(tx, {
      userId: current.userId,
      email: nextEmail,
      name: next.name.formatted,
    })

    /**
     * An address change ends the sessions established under the old one. A
     * deactivation in the same request revokes them itself, so this only runs
     * when nothing else will.
     */
    if (!deactivated) {
      await revokeUserSessionsTx(tx, {
        userId: current.userId,
        organizationId: context.organizationId,
      })
    }
  } else if (next.name.formatted !== current.attributes.name.formatted) {
    await syncAccountIdentityTx(tx, { userId: current.userId, name: next.name.formatted })
  }

  if (deactivated) {
    await suspendMemberTx(tx, {
      userId: current.userId,
      organizationId: context.organizationId,
      source: 'scim',
    })
  } else if (reactivated) {
    await unsuspendMemberTx(tx, { userId: current.userId, source: 'scim' })
  }

  await updateScimUser(tx, {
    scimUserId: current.id,
    attributes: next,
    active: next.active,
  })

  await reconcileUserProjection(tx, {
    connectionId: context.connection.id,
    organizationId: context.organizationId,
    scimUserId: current.id,
    settings: context.connection.settings,
  })

  return { emailChanged, deactivated, reactivated }
}

export interface UpdateScimUserResult {
  scimUserId: string
  userId: string
  outcome: UpdateOutcome | null
  resource: ReturnType<typeof toUserResource>
}

/**
 * Loads the stored resource under the organization and user advisory locks.
 *
 * The locks, not a row lock, serialize two concurrent PATCHes on one account:
 * the record is read once to learn the user, locked, then read again so the
 * patch is computed against the state the lock protects. A `FOR UPDATE` on the
 * `scim_user` row would invert the documented order against projection writers,
 * which take the advisory locks first and then touch rows referencing this one.
 */
async function loadUserForUpdate(
  tx: DbOrTx,
  context: ScimUseCaseContext,
  scimUserId: string
): Promise<ScimUserRecord> {
  const found = await findScimUserById(tx, context.connection.id, scimUserId)
  if (!found) throw notFound('SCIM User not found')
  await acquireOrganizationUserMutationLocks(tx, {
    userId: found.userId,
    organizationIds: [context.organizationId],
  })
  const current = await findScimUserById(tx, context.connection.id, scimUserId)
  if (!current) throw notFound('SCIM User not found')
  return current
}

/**
 * Whether the account's address no longer matches what the directory asserts.
 *
 * The directory is the authority on a provisioned member's address. If the
 * person changed it in Sim, the next directory write — even one that repeats
 * the stored attributes — restores it, so what the directory sees and what the
 * account uses cannot stay apart.
 */
function accountEmailDiverged(current: ScimUserRecord, next: ScimUserAttributes): boolean {
  return normalizeEmail(primaryEmail(next)) !== normalizeEmail(current.email)
}

/** Rendered inside the write transaction, so a concurrent delete cannot make a committed update unreadable. */
async function renderUpdated(
  tx: DbOrTx,
  connectionId: string,
  scimUserId: string,
  baseUrl: string
): Promise<ReturnType<typeof toUserResource>> {
  const record = await findScimUserById(tx, connectionId, scimUserId)
  if (!record) throw new ScimError(500, undefined, 'The updated user could not be read back')
  const groups = (await loadGroupsForScimUsers(tx, [record.id])).get(record.id) ?? []
  return toUserResource(toUserResourceRow(record, groups), baseUrl)
}

function auditEntries(result: UpdateScimUserResult): ScimAuditEntry[] | undefined {
  if (!result.outcome) return undefined
  const entries: ScimAuditEntry[] = [
    {
      action: AuditAction.SCIM_USER_UPDATED,
      resourceType: AuditResourceType.USER,
      resourceId: result.userId,
      metadata: {
        scimUserId: result.scimUserId,
        emailChanged: result.outcome.emailChanged,
      },
    },
  ]
  if (result.outcome.deactivated) {
    entries.push({
      action: AuditAction.SCIM_USER_DEACTIVATED,
      resourceType: AuditResourceType.USER,
      resourceId: result.userId,
      metadata: { scimUserId: result.scimUserId },
    })
  }
  if (result.outcome.reactivated) {
    entries.push({
      action: AuditAction.SCIM_USER_REACTIVATED,
      resourceType: AuditResourceType.USER,
      resourceId: result.userId,
      metadata: { scimUserId: result.scimUserId },
    })
  }
  return entries
}

function invalidateIfAccessChanged(result: UpdateScimUserResult, organizationId: string): void {
  if (!result.outcome) return
  if (result.outcome.emailChanged || result.outcome.deactivated || result.outcome.reactivated) {
    invalidateAfterSessionRevocation({ userId: result.userId, organizationId })
  }
}

export interface ReplaceScimUserInput {
  scimUserId: string
  attributes: ScimUserAttributes
}

export const replaceScimUser = defineAuthorizedScimUseCase({
  operation: scimOperations.updateUser,
  async execute({
    input,
    context,
  }: ScimUseCaseArgs<ReplaceScimUserInput>): Promise<UpdateScimUserResult> {
    return db.transaction(async (tx) => {
      const current = await loadUserForUpdate(tx, context, input.scimUserId)

      /**
       * A replace keeps attributes Sim does not model that the directory sent on
       * a previous write but omitted now, so a partial mapping does not erase
       * them.
       */
      const next: ScimUserAttributes = {
        ...input.attributes,
        ...(current.attributes.extra || input.attributes.extra
          ? { extra: { ...current.attributes.extra, ...input.attributes.extra } }
          : {}),
      }

      /**
       * Okta re-sends the whole resource on every cycle for every user. A PUT that
       * changes nothing must not write, audit, or re-project, or a 2,000-user
       * organization produces 2,000 spurious audit rows per sync.
       */
      const outcome =
        userAttributesEqual(current.attributes, next) && !accountEmailDiverged(current, next)
          ? null
          : await applyUserUpdate(tx, context, current, next)
      return {
        scimUserId: current.id,
        userId: current.userId,
        outcome,
        resource: await renderUpdated(tx, context.connection.id, current.id, context.baseUrl),
      }
    })
  },
  projectAudit: ({ result }) => auditEntries(result),
  afterSuccess: async ({ result, context }) =>
    invalidateIfAccessChanged(result, context.organizationId),
})

export interface PatchScimUserInput {
  scimUserId: string
  operations: readonly ScimPatchOperation[]
}

export const patchScimUser = defineAuthorizedScimUseCase({
  operation: scimOperations.updateUser,
  async execute({
    input,
    context,
  }: ScimUseCaseArgs<PatchScimUserInput>): Promise<UpdateScimUserResult> {
    return db.transaction(async (tx) => {
      const current = await loadUserForUpdate(tx, context, input.scimUserId)

      const { next, changed } = applyUserPatch(current.attributes, input.operations)

      /**
       * A patch that changes nothing is answered with the resource and no write.
       * Directories re-send unchanged attributes constantly on incremental
       * cycles, and treating each as a write would produce an audit row, a
       * projection pass, and a `lastModified` bump for a request that meant
       * nothing.
       */
      const outcome =
        changed || accountEmailDiverged(current, next)
          ? await applyUserUpdate(tx, context, current, next)
          : null
      return {
        scimUserId: current.id,
        userId: current.userId,
        outcome,
        resource: await renderUpdated(tx, context.connection.id, current.id, context.baseUrl),
      }
    })
  },
  projectAudit: ({ result }) => auditEntries(result),
  afterSuccess: async ({ result, context }) =>
    invalidateIfAccessChanged(result, context.organizationId),
})
