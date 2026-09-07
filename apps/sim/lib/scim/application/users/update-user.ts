import { AuditAction, AuditResourceType } from '@sim/audit'
import { db } from '@sim/db'
import { type ScimUserAttributes, user } from '@sim/db/schema'
import { normalizeEmail } from '@sim/utils/string'
import { eq } from 'drizzle-orm'
import type { ScimPatchOperation } from '@/lib/api/contracts/scim'
import { acquireOrganizationUserMutationLocks } from '@/lib/billing/organizations/membership'
import type { DbOrTx } from '@/lib/db/types'
import {
  invalidateAfterSessionRevocation,
  revokeUserSessionsTx,
  suspendMemberTx,
  unsuspendMemberTx,
} from '@/lib/organizations/members/lifecycle'
import {
  defineAuthorizedScimUseCase,
  type ScimAuditEntry,
  type ScimUseCaseArgs,
  type ScimUseCaseContext,
} from '@/lib/scim/application/authorized-scim-use-case'
import { scimOperations } from '@/lib/scim/application/operations'
import { assertDomainOwned, assertEmailAvailable } from '@/lib/scim/identity/resolve-user'
import { reconcileUserProjection } from '@/lib/scim/projection/reconcile-user'
import { primaryEmail } from '@/lib/scim/protocol/canonical'
import { notFound, ScimError } from '@/lib/scim/protocol/errors'
import { toUserResource } from '@/lib/scim/protocol/resources'
import { applyUserPatch, userAttributesEqual } from '@/lib/scim/protocol/user-patch'
import {
  assertUserNameAvailable,
  findScimUserById,
  loadGroupsForScimUsers,
  lockScimUserById,
  type ScimUserRecord,
  toUserResourceRow,
  updateScimUser,
} from '@/lib/scim/repository/users'

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
  const emailChanged = normalizeEmail(nextEmail) !== normalizeEmail(current.email)
  const deactivated = current.active && !next.active
  const reactivated = !current.active && next.active

  /**
   * Taken first so the advisory locks always precede the `organization` row
   * lock that a session revocation takes, in every path through this function.
   */
  await acquireOrganizationUserMutationLocks(tx, {
    userId: current.userId,
    organizationIds: [context.organizationId],
  })

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
    await assertEmailAvailable(tx, nextEmail, current.userId)
    await tx
      .update(user)
      .set({
        email: nextEmail,
        normalizedEmail: normalizeEmail(nextEmail),
        /** The new address is unproven until its owner acts on it. */
        emailVerified: false,
        name: next.name.formatted,
        updatedAt: new Date(),
      })
      .where(eq(user.id, current.userId))

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
    await tx
      .update(user)
      .set({ name: next.name.formatted, updatedAt: new Date() })
      .where(eq(user.id, current.userId))
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

async function renderUpdated(
  connectionId: string,
  scimUserId: string,
  baseUrl: string
): Promise<ReturnType<typeof toUserResource>> {
  const record = await findScimUserById(db, connectionId, scimUserId)
  if (!record) throw new ScimError(500, undefined, 'The updated user could not be read back')
  const groups = (await loadGroupsForScimUsers(db, [record.id])).get(record.id) ?? []
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

async function invalidateIfAccessChanged(result: UpdateScimUserResult, organizationId: string) {
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
    const { scimUserId, userId, outcome } = await db.transaction(async (tx) => {
      const current = await lockScimUserById(tx, context.connection.id, input.scimUserId)
      if (!current) throw notFound('SCIM User not found')

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
      if (userAttributesEqual(current.attributes, next)) {
        return { scimUserId: current.id, userId: current.userId, outcome: null }
      }
      return {
        scimUserId: current.id,
        userId: current.userId,
        outcome: await applyUserUpdate(tx, context, current, next),
      }
    })
    return {
      scimUserId,
      userId,
      outcome,
      resource: await renderUpdated(context.connection.id, scimUserId, context.baseUrl),
    }
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
    const { scimUserId, userId, outcome } = await db.transaction(async (tx) => {
      const current = await lockScimUserById(tx, context.connection.id, input.scimUserId)
      if (!current) throw notFound('SCIM User not found')

      const { next, changed } = applyUserPatch(current.attributes, input.operations)

      /**
       * A patch that changes nothing is answered with the resource and no write.
       * Directories re-send unchanged attributes constantly on incremental
       * cycles, and treating each as a write would produce an audit row, a
       * projection pass, and a `lastModified` bump for a request that meant
       * nothing.
       */
      if (!changed) return { scimUserId: current.id, userId: current.userId, outcome: null }
      return {
        scimUserId: current.id,
        userId: current.userId,
        outcome: await applyUserUpdate(tx, context, current, next),
      }
    })
    return {
      scimUserId,
      userId,
      outcome,
      resource: await renderUpdated(context.connection.id, scimUserId, context.baseUrl),
    }
  },
  projectAudit: ({ result }) => auditEntries(result),
  afterSuccess: async ({ result, context }) =>
    invalidateIfAccessChanged(result, context.organizationId),
})
