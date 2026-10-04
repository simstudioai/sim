import type { Principal } from '@sim/auth/principal'
import { db } from '@sim/db'
import { publicShare, user, workspaceFiles } from '@sim/db/schema'
import { generateShortId } from '@sim/utils/id'
import { and, eq, isNull } from 'drizzle-orm'
import { isAccountBlocked } from '@/lib/auth/ban'
import { asOrchestrationError, OrchestrationError } from '@/lib/core/orchestration/types'
import { deploymentAuthCookieName } from '@/lib/core/security/deployment'
import {
  type DeploymentAuthResult,
  validateDeploymentCredentials,
} from '@/lib/core/security/deployment-credentials'
import type { DbTransaction } from '@/lib/db/types'
import {
  type PublicFileReadOperation,
  publicFileOperations,
} from '@/lib/public-shares/application/operations'
import { loadPublicFileOwner } from '@/lib/public-shares/application/owner-adapters'
import { resolveFileOwner } from '@/lib/workspace-files/ownership'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

const grantIdentity = Symbol('verified-public-file-share')
export interface VerifiedPublicFileShareGrant {
  readonly [grantIdentity]: true
}
interface PublicFileCredential {
  method: 'GET' | 'POST'
  password?: string
  email?: string
  cookies?: Readonly<Record<string, string>>
  sessionPrincipal?: Principal
  clientIp?: string | null
}
interface SessionIdentity {
  userId: string
  email: string
}
interface GrantState {
  token: string
  policy: string
  session?: SessionIdentity
  authenticatedEmail?: string
  expiresAt: number
}
const grants = new WeakMap<VerifiedPublicFileShareGrant, GrantState>()

function unavailable(): never {
  throw new OrchestrationError('not_found', 'File share not found')
}

async function loadSnapshot(tx: DbTransaction, token: string) {
  const [discovered] = await tx
    .select({ share: publicShare, file: workspaceFiles })
    .from(publicShare)
    .innerJoin(workspaceFiles, eq(publicShare.resourceId, workspaceFiles.id))
    .where(and(eq(publicShare.token, token), eq(publicShare.resourceType, 'file')))
    .limit(1)
  if (!discovered) unavailable()
  const owner = resolveFileOwner(discovered.file)
  if (
    !owner ||
    discovered.share.entityType !== owner.entityType ||
    discovered.share.entityId !== owner.entityId
  )
    unavailable()
  const context = await loadPublicFileOwner(tx, owner)
  const [file] = await tx
    .select()
    .from(workspaceFiles)
    .where(
      and(
        eq(workspaceFiles.id, discovered.file.id),
        fileOwnerCondition(context.owner),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .for('share')
  if (!file) unavailable()
  const [share] = await tx
    .select()
    .from(publicShare)
    .where(
      and(
        eq(publicShare.id, discovered.share.id),
        eq(publicShare.token, token),
        eq(publicShare.resourceType, 'file'),
        eq(publicShare.resourceId, file.id),
        eq(publicShare.entityType, context.owner.entityType),
        eq(publicShare.entityId, context.owner.entityId),
        eq(publicShare.isActive, true)
      )
    )
    .for('share')
  if (
    !share ||
    share.workspaceId !== (context.owner.entityType === 'workspace' ? context.owner.entityId : null)
  )
    unavailable()
  const [creator] = file.userId
    ? await tx.select({ name: user.name }).from(user).where(eq(user.id, file.userId)).limit(1)
    : []
  return { ...context, file, share, creatorName: creator?.name ?? null }
}
export type PublicFileShareSnapshot = Awaited<ReturnType<typeof loadSnapshot>>

function policy(snapshot: PublicFileShareSnapshot) {
  const { share, owner } = snapshot
  return JSON.stringify([
    share.id,
    share.token,
    share.resourceId,
    owner,
    share.authType,
    share.password,
    share.allowedEmails,
  ])
}
async function loadSession(
  tx: DbTransaction,
  userId: string
): Promise<SessionIdentity | undefined> {
  const [row] = await tx
    .select({
      id: user.id,
      email: user.email,
      banned: user.banned,
      banExpires: user.banExpires,
      suspendedAt: user.suspendedAt,
    })
    .from(user)
    .where(eq(user.id, userId))
    .for('share')
  return row && !isAccountBlocked(row) ? { userId: row.id, email: row.email } : undefined
}

/** Exchanges real credentials for an in-process, short-lived bearer grant bound to current sharing policy. */
export async function authorizePublicFileShare({
  token,
  credential,
}: {
  token: string
  credential: PublicFileCredential
}): Promise<
  | (DeploymentAuthResult & { authorized: false; authType: string })
  | {
      authorized: true
      authType: string
      grant: VerifiedPublicFileShareGrant
      authenticatedEmail?: string
    }
> {
  try {
    if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) unavailable()
    const initial = await db.transaction(async (tx) => {
      const snapshot = await loadSnapshot(tx, token)
      const session =
        snapshot.share.authType === 'sso' && credential.sessionPrincipal?.kind === 'session'
          ? await loadSession(tx, credential.sessionPrincipal.userId)
          : undefined
      return { snapshot, session }
    })
    const result = await validateDeploymentCredentials(
      generateShortId(),
      initial.snapshot.share,
      {
        method: credential.method,
        authToken:
          credential.cookies?.[deploymentAuthCookieName('file', initial.snapshot.share.id)],
        clientIp: credential.clientIp,
        sessionPresent: Boolean(initial.session),
        sessionEmail: initial.session?.email,
      },
      credential.method === 'POST'
        ? { password: credential.password, email: credential.email }
        : undefined,
      'file'
    )
    if (!result.authorized)
      return { ...result, authorized: false, authType: initial.snapshot.share.authType }
    const state: GrantState = {
      token,
      policy: policy(initial.snapshot),
      session: initial.session,
      authenticatedEmail: result.authenticatedEmail,
      expiresAt: Date.now() + 60_000,
    }
    await db.transaction((tx) => validateState(tx, state))
    const grant: VerifiedPublicFileShareGrant = Object.freeze({ [grantIdentity]: true as const })
    grants.set(grant, state)
    return {
      authorized: true,
      grant,
      authType: initial.snapshot.share.authType,
      authenticatedEmail: result.authenticatedEmail,
    }
  } catch (error) {
    throw asOrchestrationError(error) ?? error
  }
}

async function validateState(tx: DbTransaction, state: GrantState) {
  if (state.expiresAt <= Date.now()) unavailable()
  const snapshot = await loadSnapshot(tx, state.token)
  if (policy(snapshot) !== state.policy) unavailable()
  if (state.session) {
    const session = await loadSession(tx, state.session.userId)
    if (!session || session.email !== state.session.email) unavailable()
  }
  return snapshot
}

/** A credential challenge authorizes only verification of this live token's declared authentication mode. */
export async function preparePublicFileShareChallenge(
  token: string,
  authType: 'password' | 'email' | 'sso'
) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) unavailable()
  const initial = await db.transaction((tx) => loadSnapshot(tx, token))
  if (initial.share.authType !== authType) {
    const message =
      authType === 'sso'
        ? 'This file is not configured for SSO'
        : `This file does not use ${authType} authentication`
    throw new OrchestrationError('validation', message)
  }
  const state: GrantState = { token, policy: policy(initial), expiresAt: Date.now() + 60_000 }
  return Object.freeze({
    shareId: initial.share.id,
    async withCurrentPolicy<T>(
      execute: (snapshot: PublicFileShareSnapshot) => Promise<T> | T
    ): Promise<T> {
      try {
        return await db.transaction(async (tx) => execute(await validateState(tx, state)))
      } catch (error) {
        throw asOrchestrationError(error) ?? error
      }
    },
  })
}

/** Every bearer read rechecks current token, owner, file lifetime, and verified session policy. */
export async function withPublicFileShareGrant<T>(
  grant: VerifiedPublicFileShareGrant,
  operation: PublicFileReadOperation,
  execute: (tx: DbTransaction, snapshot: PublicFileShareSnapshot) => Promise<T>
): Promise<T> {
  try {
    if (!Object.values(publicFileOperations).some((registered) => registered === operation))
      throw new Error('Unregistered public file operation')
    const state = grants.get(grant)
    if (!state) unavailable()
    return await db.transaction(async (tx) => execute(tx, await validateState(tx, state)))
  } catch (error) {
    throw asOrchestrationError(error) ?? error
  }
}
