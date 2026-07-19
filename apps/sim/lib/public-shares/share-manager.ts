import { db } from '@sim/db'
import { publicShare, user, workspace, workspaceFiles, workspaceInterface } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateId, generateShortId } from '@sim/utils/id'
import { and, eq, inArray, isNull } from 'drizzle-orm'
import type {
  ShareAuthType,
  ShareRecord,
  ShareResourceType,
} from '@/lib/api/contracts/public-shares'
import { encryptSecret } from '@/lib/core/security/encryption'
import type { InterfaceDefinition, InterfaceLayout } from '@/lib/interfaces/types'
import { buildShareUrl } from '@/lib/public-shares/urls'

const logger = createLogger('PublicShareManager')

/** Thrown when share auth config is invalid (e.g. enabling a password share with no password). Maps to a 400. */
export class ShareValidationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ShareValidationError'
  }
}

type PublicShareRow = typeof publicShare.$inferSelect

function mapShareRecord(row: PublicShareRow): ShareRecord {
  const resourceType = row.resourceType as ShareResourceType
  return {
    id: row.id,
    token: row.token,
    url: buildShareUrl(resourceType, row.token),
    isActive: row.isActive,
    resourceType,
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

export interface UpsertResourceShareInput {
  /** Which resource family the share points at; pins both the lookup and the link prefix. */
  resourceType: ShareResourceType
  resourceId: string
  workspaceId: string
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
 * Enable or disable the public share for a resource. First enable inserts a row
 * with a fresh unguessable token; subsequent calls flip `isActive`/`authType`
 * and keep the token stable (so an existing link resolves again after
 * re-enable).
 *
 * Auth validation only applies when **enabling** (`isActive: true`): `password`
 * requires a plaintext `password` unless one is already stored (encrypted via
 * {@link encryptSecret}); `email`/`sso` require a non-empty `allowedEmails`.
 * Disabling (going Private) always succeeds and preserves the stored config so a
 * later re-enable restores it. Validation failures throw {@link ShareValidationError}.
 */
export async function upsertResourceShare({
  resourceType,
  resourceId,
  workspaceId,
  userId,
  isActive,
  authType,
  password,
  allowedEmails,
  token,
}: UpsertResourceShareInput): Promise<ShareRecord> {
  const [existing] = await db
    .select()
    .from(publicShare)
    .where(and(eq(publicShare.resourceType, resourceType), eq(publicShare.resourceId, resourceId)))
    .limit(1)

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

  const [row] = await db
    .insert(publicShare)
    .values({
      id: generateId(),
      resourceType,
      resourceId,
      workspaceId,
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

  // `shareId` is the correlation key; the token is bearer material for the share
  // and must never be reconstructable from logs.
  logger.info('Upserted resource share', {
    shareId: row.id,
    resourceType,
    resourceId,
    workspaceId,
    isActive,
    authType: finalAuthType,
  })
  return mapShareRecord(row)
}

/**
 * Resolve a public token to its active share and the underlying (non-deleted)
 * file. Returns null if the token is unknown, the share is inactive, or the file
 * is gone. The caller treats null as a 404 — the existence of a file is never
 * leaked through this path.
 */
export interface ResolvedShare {
  share: PublicShareRow
  file: typeof workspaceFiles.$inferSelect
  /** Owning workspace name, for provenance on the public page. */
  workspaceName: string | null
  /** Display name of the file's uploader. */
  ownerName: string | null
}

export async function resolveActiveShareByToken(token: string): Promise<ResolvedShare | null> {
  const [row] = await db
    .select({
      share: publicShare,
      file: workspaceFiles,
      workspaceName: workspace.name,
      ownerName: user.name,
    })
    .from(publicShare)
    .innerJoin(workspaceFiles, eq(workspaceFiles.id, publicShare.resourceId))
    .leftJoin(workspace, eq(workspace.id, workspaceFiles.workspaceId))
    .leftJoin(user, eq(user.id, workspaceFiles.userId))
    .where(
      and(
        eq(publicShare.token, token),
        eq(publicShare.isActive, true),
        eq(publicShare.resourceType, 'file'),
        isNull(workspaceFiles.deletedAt)
      )
    )
    .limit(1)

  if (!row) return null

  return {
    share: row.share,
    file: row.file,
    workspaceName: row.workspaceName,
    ownerName: row.ownerName,
  }
}

type WorkspaceInterfaceRow = typeof workspaceInterface.$inferSelect

/**
 * Mirrors the interface service's private row mapper so the token resolve stays
 * a single query. TypeScript enforces completeness, so a new
 * {@link InterfaceDefinition} field cannot silently go missing here.
 */
function toInterfaceDefinition(row: WorkspaceInterfaceRow): InterfaceDefinition {
  return {
    id: row.id,
    workspaceId: row.workspaceId,
    name: row.name,
    description: row.description,
    layout: row.layout as InterfaceLayout,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    archivedAt: row.archivedAt ? row.archivedAt.toISOString() : null,
  }
}

export interface ResolvedInterfaceShare {
  share: PublicShareRow
  /** The interface's stored definition — the only authority for what a token grants. */
  definition: InterfaceDefinition
  /** The interface's own workspace, re-asserted against every resolved resource. */
  workspaceId: string
  /** Owning workspace name, for provenance on the public page. */
  workspaceName: string | null
  /** Display name of the interface's creator. */
  ownerName: string | null
}

/**
 * Resolve a public token to its active share and the underlying (non-archived)
 * interface.
 *
 * `resourceType` is pinned to `'interface'` in the WHERE clause, so a file
 * token can never resolve through this path. Returns null when the token is
 * unknown, the share is inactive, or the interface is archived — the caller
 * treats all three identically as a 404, so the existence of an interface is
 * never leaked.
 */
export async function resolveActiveInterfaceShareByToken(
  token: string
): Promise<ResolvedInterfaceShare | null> {
  const [row] = await db
    .select({
      share: publicShare,
      definition: workspaceInterface,
      workspaceName: workspace.name,
      ownerName: user.name,
    })
    .from(publicShare)
    .innerJoin(workspaceInterface, eq(workspaceInterface.id, publicShare.resourceId))
    .leftJoin(workspace, eq(workspace.id, workspaceInterface.workspaceId))
    .leftJoin(user, eq(user.id, workspaceInterface.createdBy))
    .where(
      and(
        eq(publicShare.token, token),
        eq(publicShare.isActive, true),
        eq(publicShare.resourceType, 'interface'),
        isNull(workspaceInterface.archivedAt)
      )
    )
    .limit(1)

  if (!row) return null

  return {
    share: row.share,
    definition: toInterfaceDefinition(row.definition),
    workspaceId: row.definition.workspaceId,
    workspaceName: row.workspaceName,
    ownerName: row.ownerName,
  }
}
