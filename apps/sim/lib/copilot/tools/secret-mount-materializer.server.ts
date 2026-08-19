import { db } from '@sim/db'
import { credential, credentialMember, environment, workspaceEnvironment } from '@sim/db/schema'
import { and, desc, eq, inArray, or, sql } from 'drizzle-orm'
import type { AnyPgColumn } from 'drizzle-orm/pg-core'
import {
  MAX_SECRET_MOUNT_NAME_LENGTH,
  MAX_SECRET_MOUNT_NAMES,
} from '@/lib/copilot/secret-mount-policy'
import { decryptSecret } from '@/lib/core/security/encryption'
import { setRecordValue } from '@/lib/core/utils/records'
import { checkWorkspaceAccess } from '@/lib/workspaces/permissions/utils'
import type {
  ResolvedSecretScope,
  ResolvedSecretTraceCatalogEntry,
} from '@/executor/utils/resolved-secret-trace-registry'

export { MAX_SECRET_MOUNT_NAME_LENGTH, MAX_SECRET_MOUNT_NAMES }

const MAX_SECRET_MOUNT_ENCRYPTED_BYTES = 512 * 1024
const MAX_SECRET_MOUNT_PLAINTEXT_BYTES = 64 * 1024
const MAX_SECRET_MOUNT_TOTAL_PLAINTEXT_BYTES = 256 * 1024

interface CredentialAccessRow {
  type: 'env_personal' | 'env_workspace'
  envKey: string
  envOwnerUserId: string | null
  role: 'admin' | 'member'
  status: 'active' | 'pending' | 'revoked'
  updatedAt: Date
  encryptedValue: string | null
  encryptedValueBytes: number | null
}

interface AuthorizedEncryptedSecret {
  name: string
  encryptedValue: string
  /** Which environment authorized this value, so the usage trail can attribute it. */
  scope: ResolvedSecretScope
  /**
   * Whose personal environment a `personal` value came from — the actor for their own
   * secret, the sharer for one shared with them. Never the actor by default: the trail is
   * read per owner, so attributing a shared secret to its borrower would file the row under
   * a secret the borrower does not have.
   */
  ownerUserId?: string
}

export interface MaterializedCopilotCodeSecrets {
  envVars: Record<string, string>
  catalogEntries: ResolvedSecretTraceCatalogEntry[]
}

export class CopilotCodeSecretAccessError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'CopilotCodeSecretAccessError'
  }
}

function normalizeRequestedNames(names: readonly string[]): string[] {
  const normalized: string[] = []
  const seen = new Set<string>()
  for (const name of names) {
    if (name.length === 0 || seen.has(name)) continue
    if (name.length > MAX_SECRET_MOUNT_NAME_LENGTH) {
      throw new CopilotCodeSecretAccessError(
        `Copilot secret names may be at most ${MAX_SECRET_MOUNT_NAME_LENGTH} characters`
      )
    }
    seen.add(name)
    normalized.push(name)
  }
  if (normalized.length > MAX_SECRET_MOUNT_NAMES) {
    throw new CopilotCodeSecretAccessError(
      `Copilot code may request at most ${MAX_SECRET_MOUNT_NAMES} secrets per call`
    )
  }
  return normalized
}

function encryptedVariables(row: { variables: unknown } | undefined): Record<string, string> {
  if (!row?.variables || typeof row.variables !== 'object' || Array.isArray(row.variables))
    return {}
  const result: Record<string, string> = {}
  for (const [name, value] of Object.entries(row.variables)) {
    if (typeof value === 'string') setRecordValue(result, name, value)
  }
  return result
}

function requestedVariables(column: AnyPgColumn, names: readonly string[]) {
  const keys = sql.join(
    names.map((name) => sql`${name}`),
    sql`, `
  )
  return sql<Record<string, string>>`coalesce(
    (
      select jsonb_object_agg(entry.key, entry.value)
      from jsonb_each_text(coalesce(${column}::jsonb, '{}'::jsonb)) as entry(key, value)
      where entry.key in (${keys})
        and octet_length(entry.value) <= ${MAX_SECRET_MOUNT_ENCRYPTED_BYTES}
    ),
    '{}'::jsonb
  )`.as('variables')
}

function requestedOverLimitNames(column: AnyPgColumn, names: readonly string[]) {
  const keys = sql.join(
    names.map((name) => sql`${name}`),
    sql`, `
  )
  return sql<string[]>`coalesce(
    (
      select jsonb_agg(entry.key order by entry.key)
      from jsonb_each_text(coalesce(${column}::jsonb, '{}'::jsonb)) as entry(key, value)
      where entry.key in (${keys})
        and octet_length(entry.value) > ${MAX_SECRET_MOUNT_ENCRYPTED_BYTES}
    ),
    '[]'::jsonb
  )`.as('over_limit_names')
}

function overLimitNames(row: { overLimitNames?: unknown } | undefined): Set<string> {
  if (!Array.isArray(row?.overLimitNames)) return new Set()
  return new Set(row.overLimitNames.filter((name): name is string => typeof name === 'string'))
}

function activeAdmin(row: CredentialAccessRow): boolean {
  return row.role === 'admin' && row.status === 'active'
}

function unavailableError(names: readonly string[]): CopilotCodeSecretAccessError {
  return new CopilotCodeSecretAccessError(
    `Copilot code cannot access the requested secret${names.length === 1 ? '' : 's'}: ${names.join(', ')}`
  )
}

/**
 * Resolves exact Secrets-tab values for arbitrary Copilot code after rechecking current authority.
 * No plaintext is produced until every requested name has an authorized source.
 */
export async function materializeCopilotCodeSecrets(params: {
  actorUserId: string
  workspaceId: string
  requestedNames: readonly string[]
}): Promise<MaterializedCopilotCodeSecrets> {
  const requestedNames = normalizeRequestedNames(params.requestedNames)
  if (requestedNames.length === 0) return { envVars: {}, catalogEntries: [] }

  const access = await checkWorkspaceAccess(params.workspaceId, params.actorUserId)
  if (!access.exists || !access.canWrite) {
    throw new CopilotCodeSecretAccessError(
      'Write access is required to mount secrets into Copilot code'
    )
  }

  const [personalRows, workspaceRows, credentialRows] = await Promise.all([
    db
      .select({
        variables: requestedVariables(environment.variables, requestedNames),
        overLimitNames: requestedOverLimitNames(environment.variables, requestedNames),
      })
      .from(environment)
      .where(eq(environment.userId, params.actorUserId))
      .limit(1),
    db
      .select({
        variables: requestedVariables(workspaceEnvironment.variables, requestedNames),
        overLimitNames: requestedOverLimitNames(workspaceEnvironment.variables, requestedNames),
      })
      .from(workspaceEnvironment)
      .where(eq(workspaceEnvironment.workspaceId, params.workspaceId))
      .limit(1),
    db
      .selectDistinctOn([credential.type, credential.envKey], {
        type: credential.type,
        envKey: credential.envKey,
        envOwnerUserId: credential.envOwnerUserId,
        role: credentialMember.role,
        status: credentialMember.status,
        updatedAt: credential.updatedAt,
        encryptedValue: sql<string | null>`case
          when octet_length(${environment.variables} ->> ${credential.envKey}) <= ${MAX_SECRET_MOUNT_ENCRYPTED_BYTES}
          then ${environment.variables} ->> ${credential.envKey}
          else null
        end`.as('encrypted_value'),
        encryptedValueBytes: sql<
          number | null
        >`octet_length(${environment.variables} ->> ${credential.envKey})`.as(
          'encrypted_value_bytes'
        ),
      })
      .from(credential)
      .innerJoin(
        credentialMember,
        and(
          eq(credentialMember.credentialId, credential.id),
          eq(credentialMember.userId, params.actorUserId)
        )
      )
      .leftJoin(environment, eq(environment.userId, credential.envOwnerUserId))
      .where(
        and(
          eq(credential.workspaceId, params.workspaceId),
          inArray(credential.type, ['env_workspace', 'env_personal']),
          inArray(credential.envKey, requestedNames),
          eq(credentialMember.role, 'admin'),
          eq(credentialMember.status, 'active'),
          or(
            eq(credential.type, 'env_workspace'),
            sql<boolean>`coalesce(${environment.variables}::jsonb, '{}'::jsonb) ? ${credential.envKey}`
          )
        )
      )
      .orderBy(credential.type, credential.envKey, desc(credential.updatedAt))
      .limit(MAX_SECRET_MOUNT_NAMES * 2),
  ])

  const ownPersonalEncrypted = encryptedVariables(personalRows[0])
  const workspaceEncrypted = encryptedVariables(workspaceRows[0])
  const ownPersonalOverLimit = overLimitNames(personalRows[0])
  const workspaceOverLimit = overLimitNames(workspaceRows[0])
  const envCredentialRows = credentialRows.filter(
    (row): row is CredentialAccessRow =>
      (row.type === 'env_personal' || row.type === 'env_workspace') &&
      typeof row.envKey === 'string'
  )
  const authorizedSharedPersonalRows = envCredentialRows.filter(
    (row) =>
      row.type === 'env_personal' &&
      row.envOwnerUserId !== null &&
      row.envOwnerUserId !== params.actorUserId &&
      activeAdmin(row)
  )

  const authorizedSources: AuthorizedEncryptedSecret[] = []
  const unavailable: string[] = []
  const overLimit: string[] = []
  for (const name of requestedNames) {
    const workspaceValue = workspaceEncrypted[name]
    const workspaceExists = workspaceValue !== undefined || workspaceOverLimit.has(name)
    const workspaceAuthorized =
      workspaceExists &&
      (access.canAdmin ||
        envCredentialRows.some(
          (row) => row.type === 'env_workspace' && row.envKey === name && activeAdmin(row)
        ))

    if (workspaceAuthorized) {
      if (workspaceValue === undefined) {
        overLimit.push(name)
        continue
      }
      authorizedSources.push({ name, encryptedValue: workspaceValue, scope: 'workspace' })
      continue
    }

    const ownPersonalValue = ownPersonalEncrypted[name]
    if (ownPersonalOverLimit.has(name)) {
      overLimit.push(name)
      continue
    }
    if (ownPersonalValue !== undefined) {
      authorizedSources.push({
        name,
        encryptedValue: ownPersonalValue,
        scope: 'personal',
        ownerUserId: params.actorUserId,
      })
      continue
    }

    const sharedPersonal = authorizedSharedPersonalRows
      .filter((row) => row.envKey === name)
      .sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime())
      .at(0)
    if (
      sharedPersonal &&
      sharedPersonal.encryptedValueBytes !== null &&
      sharedPersonal.encryptedValueBytes > MAX_SECRET_MOUNT_ENCRYPTED_BYTES
    ) {
      overLimit.push(name)
      continue
    }
    const sharedPersonalValue = sharedPersonal?.encryptedValue ?? undefined
    if (sharedPersonalValue !== undefined) {
      authorizedSources.push({
        name,
        encryptedValue: sharedPersonalValue,
        scope: 'personal',
        /** Non-null by the `authorizedSharedPersonalRows` filter above. */
        ownerUserId: sharedPersonal?.envOwnerUserId as string,
      })
      continue
    }

    unavailable.push(name)
  }

  if (overLimit.length > 0) {
    throw new CopilotCodeSecretAccessError('Requested secrets exceed the Copilot mount size limit')
  }
  if (unavailable.length > 0) throw unavailableError(unavailable)

  let decryptedEntries: ResolvedSecretTraceCatalogEntry[]
  try {
    decryptedEntries = await Promise.all(
      authorizedSources.map(async ({ name, encryptedValue, scope, ownerUserId }) => {
        const { decrypted } = await decryptSecret(encryptedValue)
        return {
          name,
          plaintext: decrypted,
          encryptedValue,
          scope,
          ...(ownerUserId ? { ownerUserId } : {}),
        }
      })
    )
  } catch {
    throw new CopilotCodeSecretAccessError('One or more requested secrets could not be decrypted')
  }

  let totalPlaintextBytes = 0
  for (const entry of decryptedEntries) {
    const plaintextBytes = Buffer.byteLength(entry.plaintext, 'utf8')
    totalPlaintextBytes += plaintextBytes
    if (
      plaintextBytes > MAX_SECRET_MOUNT_PLAINTEXT_BYTES ||
      totalPlaintextBytes > MAX_SECRET_MOUNT_TOTAL_PLAINTEXT_BYTES
    ) {
      throw new CopilotCodeSecretAccessError(
        'Requested secrets exceed the Copilot mount size limit'
      )
    }
  }

  return {
    envVars: Object.fromEntries(decryptedEntries.map((entry) => [entry.name, entry.plaintext])),
    catalogEntries: decryptedEntries,
  }
}
