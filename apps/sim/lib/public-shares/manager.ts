import { db } from '@sim/db'
import { publicShare, workspaceFiles } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type { z } from 'zod'
import type {
  ShareAuthType,
  ShareRecord,
  shareResourceTypeSchema,
} from '@/lib/api/contracts/public-shares'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { encryptSecret } from '@/lib/core/security/encryption'
import { getBaseUrl } from '@/lib/core/utils/urls'
import type { DbTransaction } from '@/lib/db/types'
import { lockWorkspaceProject } from '@/lib/projects/membership'
import type { EditableFileOwner } from '@/lib/workspace-files/ownership'
import { fileOwnerCondition } from '@/lib/workspace-files/ownership-query'

const logger = createLogger('PublicShareManager')

/** Thrown when share auth config is invalid (e.g. enabling a password share with no password). Maps to a 400. */
export class ShareValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareValidationError'
  }
}

type ShareResourceType = z.infer<typeof shareResourceTypeSchema>

type PublicShareRow = typeof publicShare.$inferSelect

/** Public share URL for a token: `{baseUrl}/f/{token}`. */
export function buildShareUrl(token: string): string {
  return `${getBaseUrl()}/f/${token}`
}

function mapShareRecord(row: PublicShareRow): ShareRecord {
  return {
    id: row.id,
    token: row.token,
    url: buildShareUrl(row.token),
    isActive: row.isActive,
    resourceType: row.resourceType as ShareResourceType,
    resourceId: row.resourceId,
    authType: row.authType as ShareAuthType,
    hasPassword: Boolean(row.password),
    allowedEmails: Array.isArray(row.allowedEmails) ? (row.allowedEmails as string[]) : [],
  }
}

export async function getShareForResource(
  resourceType: ShareResourceType,
  resourceId: string
): Promise<ShareRecord | null> {
  const [row] = await db
    .select()
    .from(publicShare)
    .where(and(eq(publicShare.resourceType, resourceType), eq(publicShare.resourceId, resourceId)))
    .limit(1)

  return row ? mapShareRecord(row) : null
}

/**
 * Batch-fetch shares for many resources of the same type, keyed by `resourceId`.
 * Used to enrich the files list without an N+1 query.
 */
export async function getSharesForResources(
  resourceType: ShareResourceType,
  resourceIds: string[]
): Promise<Map<string, ShareRecord>> {
  const result = new Map<string, ShareRecord>()
  if (resourceIds.length === 0) return result

  const rows = await db
    .select()
    .from(publicShare)
    .where(
      and(eq(publicShare.resourceType, resourceType), inArray(publicShare.resourceId, resourceIds))
    )

  for (const row of rows) {
    result.set(row.resourceId, mapShareRecord(row))
  }
  return result
}

/**
 * Batch-fetch shares for resources after constraining them to one workspace.
 * Application use cases that authorize at workspace scope use this form so a
 * caller-supplied resource id cannot reach a share from another workspace.
 */
export async function getWorkspaceSharesForResources(
  resourceType: ShareResourceType,
  workspaceId: string,
  resourceIds: string[]
): Promise<Map<string, ShareRecord>> {
  const result = new Map<string, ShareRecord>()
  if (resourceIds.length === 0) return result

  const rows = await db
    .select()
    .from(publicShare)
    .where(
      and(
        eq(publicShare.resourceType, resourceType),
        eq(publicShare.workspaceId, workspaceId),
        inArray(publicShare.resourceId, resourceIds)
      )
    )

  for (const row of rows) {
    result.set(row.resourceId, mapShareRecord(row))
  }
  return result
}

/**
 * All shares of a type within a workspace, keyed by `resourceId`.
 *
 * Preferred over {@link getSharesForResources} when enriching a workspace-wide
 * listing: an id-list `IN` clause grows with the file count, while this is a
 * single indexed lookup on `workspaceId`. Returning a superset of the listed
 * resources is harmless — callers read it by `get(id)`.
 */
export async function getWorkspaceShares(
  resourceType: ShareResourceType,
  workspaceId: string
): Promise<Map<string, ShareRecord>> {
  const rows = await db
    .select()
    .from(publicShare)
    .where(
      and(eq(publicShare.resourceType, resourceType), eq(publicShare.workspaceId, workspaceId))
    )

  const result = new Map<string, ShareRecord>()
  for (const row of rows) {
    result.set(row.resourceId, mapShareRecord(row))
  }
  return result
}

export interface FileShareUpdate {
  fileId: string
  userId: string
  isActive: boolean
  /** Defaults to the existing share's authType (or `'public'` for a new share). */
  authType?: ShareAuthType
  /** Plaintext password to set; encrypted at rest. Required to first enable a password share. */
  password?: string
  /** Allowed emails/domains; required to enable an `email`/`sso` share without an existing list. */
  allowedEmails?: string[]
  /** Client-reserved token to persist on first insert; ignored when the share already exists. */
  token?: string
}

/**
 * Enable or disable the public share for a file. First enable inserts a row with
 * a fresh unguessable token; subsequent calls flip `isActive`/`authType` and keep
 * the token stable (so an existing link resolves again after re-enable).
 *
 * Auth validation only applies when **enabling** (`isActive: true`): `password`
 * requires a plaintext `password` unless one is already stored (encrypted via
 * {@link encryptSecret}); `email`/`sso` require a non-empty `allowedEmails`.
 * Disabling (going Private) always succeeds and preserves the stored config so a
 * later re-enable restores it. Validation failures throw {@link ShareValidationError}.
 */
export async function upsertFileShare(
  input: FileShareUpdate & { workspaceId: string }
): Promise<ShareRecord> {
  return db.transaction(async (tx) => {
    await lockWorkspaceProject(tx, input.workspaceId)
    return upsertOwnedFileShare(tx, { entityType: 'workspace', entityId: input.workspaceId }, input)
  })
}

/** Reads a share only within its canonical file owner; authorization belongs to the caller. */
export async function getOwnedFileShare(
  tx: DbTransaction,
  owner: EditableFileOwner,
  fileId: string
): Promise<ShareRecord | null> {
  const [row] = await tx
    .select()
    .from(publicShare)
    .where(
      and(
        eq(publicShare.resourceType, 'file'),
        eq(publicShare.resourceId, fileId),
        eq(publicShare.entityType, owner.entityType),
        eq(publicShare.entityId, owner.entityId)
      )
    )
    .limit(1)
  return row ? mapShareRecord(row) : null
}

/** Reuses share configuration and token lifetime for every registered editable owner. */
export async function upsertOwnedFileShare(
  tx: DbTransaction,
  owner: EditableFileOwner,
  { fileId, userId, isActive, authType, password, allowedEmails, token }: FileShareUpdate
): Promise<ShareRecord> {
  const [file] = await tx
    .select({ id: workspaceFiles.id })
    .from(workspaceFiles)
    .where(
      and(
        fileOwnerCondition(owner),
        eq(workspaceFiles.id, fileId),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .for('update')
    .limit(1)
  if (!file) throw new OrchestrationError('not_found', 'File not found')
  const [existing] = await tx
    .select()
    .from(publicShare)
    .where(and(eq(publicShare.resourceType, 'file'), eq(publicShare.resourceId, fileId)))
    .limit(1)

  if (
    existing &&
    (existing.entityType !== owner.entityType || existing.entityId !== owner.entityId)
  )
    throw new OrchestrationError('not_found', 'File share not found')

  const finalAuthType: ShareAuthType =
    authType ?? (existing?.authType as ShareAuthType | undefined) ?? 'public'
  const existingAllowedEmails = Array.isArray(existing?.allowedEmails)
    ? (existing.allowedEmails as string[])
    : []

  // Disabling preserves the stored config (and skips validation) so turning
  // sharing off always succeeds; only enabling validates the chosen auth mode.
  let finalPassword: string | null = existing?.password ?? null
  let finalAllowedEmails: string[] = existingAllowedEmails
  if (isActive) {
    if (!['public', 'password', 'email', 'sso'].includes(finalAuthType))
      throw new ShareValidationError('Invalid share authentication mode')
    if (password !== undefined && (password.length < 15 || password.length > 1024))
      throw new ShareValidationError('Password must be between 15 and 1024 characters')
    if (
      allowedEmails &&
      (allowedEmails.length > 200 ||
        allowedEmails.some((email) => email.length < 1 || email.length > 320))
    )
      throw new ShareValidationError('Invalid allowed email list')
    if (!existing && token !== undefined && !/^[A-Za-z0-9_-]{16,64}$/.test(token))
      throw new ShareValidationError('Invalid share token')
    if (finalAuthType === 'password') {
      if (password) {
        finalPassword = (await encryptSecret(password)).encrypted
      } else if (existing?.password) {
        finalPassword = existing.password
      } else {
        throw new ShareValidationError('Password is required for password-protected shares')
      }
      finalAllowedEmails = []
    } else if (finalAuthType === 'email' || finalAuthType === 'sso') {
      finalAllowedEmails = allowedEmails ?? existingAllowedEmails
      if (finalAllowedEmails.length === 0) {
        throw new ShareValidationError(
          'At least one allowed email is required for email/SSO shares'
        )
      }
      finalPassword = null
    } else {
      finalPassword = null
      finalAllowedEmails = []
    }
  }

  const [row] = await tx
    .insert(publicShare)
    .values({
      id: generateId(),
      resourceType: 'file',
      resourceId: fileId,
      workspaceId: owner.entityType === 'workspace' ? owner.entityId : null,
      entityType: owner.entityType,
      entityId: owner.entityId,
      createdBy: userId,
      token: token ?? generateShortId(),
      isActive,
      authType: finalAuthType,
      password: finalPassword,
      allowedEmails: finalAllowedEmails,
    })
    .onConflictDoUpdate({
      target: [publicShare.resourceType, publicShare.resourceId],
      set: {
        isActive,
        authType: finalAuthType,
        password: finalPassword,
        allowedEmails: finalAllowedEmails,
        updatedAt: new Date(),
      },
    })
    .returning()

  logger.info('Upserted file share', {
    fileId,
    owner,
    isActive,
    authType: finalAuthType,
  })
  return mapShareRecord(row)
}
