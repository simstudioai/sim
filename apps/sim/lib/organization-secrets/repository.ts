import { db } from '@sim/db'
import { organizationSecret, organizationSecretSource } from '@sim/db/schema'
import { generateId } from '@sim/utils/id'
import { and, eq, inArray, isNull, sql } from 'drizzle-orm'
import type { GenericSecretSource } from '@/lib/api/contracts/organization-secrets'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decryptSecret, encryptSecret } from '@/lib/core/security/encryption'
import { setRecordValue } from '@/lib/core/utils/records'
import {
  MAX_ORGANIZATION_SECRETS,
  MAX_SECRET_CIPHERTEXT_BYTES,
  type SecretChanges,
  type SecretSourceMode,
  secretVariablesSchema,
} from '@/lib/organization-secrets/validation'
import type { ResolvedSecretTraceCatalogEntry } from '@/executor/utils/resolved-secret-trace-registry'

type Transaction = Parameters<Parameters<typeof db.transaction>[0]>[0]
interface SecretScope {
  organizationId: string
  userId: string
}
interface ExpectedSource {
  id?: string
  mode: SecretSourceMode
}

export async function readSecretSource(
  organizationId: string
): Promise<GenericSecretSource | null> {
  const [source] = await db
    .select({ id: organizationSecretSource.id, mode: organizationSecretSource.mode })
    .from(organizationSecretSource)
    .where(eq(organizationSecretSource.organizationId, organizationId))
    .limit(1)
  return source ?? null
}

export async function configureSecretSource(
  organizationId: string,
  sourceId: string | null,
  mode: SecretSourceMode
): Promise<GenericSecretSource> {
  const fields = { id: organizationSecretSource.id, mode: organizationSecretSource.mode }
  const [source] = sourceId
    ? await db
        .update(organizationSecretSource)
        .set({ mode, updatedAt: new Date() })
        .where(
          and(
            eq(organizationSecretSource.organizationId, organizationId),
            eq(organizationSecretSource.id, sourceId)
          )
        )
        .returning(fields)
    : await db
        .insert(organizationSecretSource)
        .values({ id: generateId(), organizationId, mode })
        .onConflictDoNothing()
        .returning(fields)
  if (!source)
    throw new OrchestrationError('conflict', 'The source changed. Refresh and try again.')
  return source
}

export async function removeSecretSource(organizationId: string, sourceId: string): Promise<void> {
  const [removed] = await db
    .delete(organizationSecretSource)
    .where(
      and(
        eq(organizationSecretSource.organizationId, organizationId),
        eq(organizationSecretSource.id, sourceId)
      )
    )
    .returning({ id: organizationSecretSource.id })
  if (!removed) throw new OrchestrationError('not_found', 'Generic Secrets source not found')
}

/** Serializes saves with mode changes and source removal, including the empty-environment case. */
async function withSource<R>(
  scope: SecretScope,
  expected: ExpectedSource | undefined,
  execute: (tx: Transaction, source: GenericSecretSource, ownerUserId: string | null) => Promise<R>,
  absent?: () => R
): Promise<R> {
  return db.transaction(async (tx) => {
    const [source] = await tx
      .select({ id: organizationSecretSource.id, mode: organizationSecretSource.mode })
      .from(organizationSecretSource)
      .where(eq(organizationSecretSource.organizationId, scope.organizationId))
      .for('update')
      .limit(1)
    if (!source) {
      if (absent) return absent()
      throw new OrchestrationError('not_found', 'Generic Secrets source not found')
    }
    if (expected && (source.mode !== expected.mode || (expected.id && source.id !== expected.id))) {
      throw new OrchestrationError('conflict', 'The source changed. Refresh and try again.')
    }
    return execute(tx, source, source.mode === 'member' ? scope.userId : null)
  })
}

function scopePredicate(sourceId: string, ownerUserId: string | null) {
  return and(
    eq(organizationSecret.sourceId, sourceId),
    ownerUserId === null
      ? isNull(organizationSecret.ownerUserId)
      : eq(organizationSecret.ownerUserId, ownerUserId)
  )
}

async function readBoundedSecrets(
  tx: Transaction,
  sourceId: string,
  ownerUserId: string | null,
  names?: string[]
) {
  const predicate = and(
    scopePredicate(sourceId, ownerUserId),
    names ? inArray(organizationSecret.name, names) : undefined
  )
  const [size] = await tx
    .select({
      count: sql<number>`count(*)::integer`,
      bytes: sql<number>`coalesce(sum(octet_length(${organizationSecret.encryptedValue})), 0)::integer`,
    })
    .from(organizationSecret)
    .where(predicate)
  if (size.count > MAX_ORGANIZATION_SECRETS || size.bytes > MAX_SECRET_CIPHERTEXT_BYTES) {
    throw new OrchestrationError('validation', 'Secrets exceed the environment size limit')
  }
  return tx
    .select({ name: organizationSecret.name, encryptedValue: organizationSecret.encryptedValue })
    .from(organizationSecret)
    .where(predicate)
    .orderBy(organizationSecret.name)
    .limit(MAX_ORGANIZATION_SECRETS)
}

async function decryptEntries(
  rows: { name: string; encryptedValue: string }[]
): Promise<ResolvedSecretTraceCatalogEntry[]> {
  const entries: ResolvedSecretTraceCatalogEntry[] = []
  for (const row of rows) {
    const { decrypted } = await decryptSecret(row.encryptedValue, { logFailure: false })
    entries.push({ ...row, plaintext: decrypted })
  }
  const variables = Object.fromEntries(entries.map((entry) => [entry.name, entry.plaintext]))
  if (!secretVariablesSchema.safeParse(variables).success) {
    throw new OrchestrationError('validation', 'Secrets exceed the environment size limit')
  }
  return entries
}

export function readSecrets(scope: SecretScope, expected: ExpectedSource) {
  return withSource(scope, expected, async (tx, source, ownerUserId) => {
    const entries = await decryptEntries(await readBoundedSecrets(tx, source.id, ownerUserId))
    return {
      source,
      variables: Object.fromEntries(entries.map((entry) => [entry.name, entry.plaintext])),
    }
  })
}

export function saveSecrets(scope: SecretScope, expected: ExpectedSource, changes: SecretChanges) {
  return withSource(scope, expected, async (tx, source, ownerUserId) => {
    const entries = await decryptEntries(await readBoundedSecrets(tx, source.id, ownerUserId))
    const next = Object.fromEntries(entries.map((entry) => [entry.name, entry.plaintext]))
    for (const name of changes.remove) delete next[name]
    for (const [name, value] of Object.entries(changes.upsert)) {
      setRecordValue(next, name, value)
    }
    const parsed = secretVariablesSchema.safeParse(next)
    if (!parsed.success)
      throw new OrchestrationError('validation', 'Secrets exceed the environment size limit')
    const changedNames = [...new Set([...changes.remove, ...Object.keys(changes.upsert)])]
    if (!changedNames.length) return
    await tx
      .delete(organizationSecret)
      .where(
        and(scopePredicate(source.id, ownerUserId), inArray(organizationSecret.name, changedNames))
      )
    const rows = []
    for (const [name, value] of Object.entries(changes.upsert)) {
      const { encrypted } = await encryptSecret(value)
      rows.push({
        id: generateId(),
        sourceId: source.id,
        ownerUserId,
        name,
        encryptedValue: encrypted,
      })
    }
    if (rows.length) await tx.insert(organizationSecret).values(rows)
  })
}

/** Names only: prompt discovery never reads ciphertext or decrypts the environment. */
export function listSecretNames(scope: SecretScope): Promise<string[]> {
  return withSource(
    scope,
    undefined,
    async (tx, source, ownerUserId) => {
      const rows = await tx
        .select({ name: organizationSecret.name })
        .from(organizationSecret)
        .where(scopePredicate(source.id, ownerUserId))
        .orderBy(organizationSecret.name)
        .limit(MAX_ORGANIZATION_SECRETS + 1)
      if (rows.length > MAX_ORGANIZATION_SECRETS)
        throw new OrchestrationError('validation', 'Too many secrets')
      return rows.map((row) => row.name)
    },
    () => []
  )
}

export function materializeSecrets(scope: SecretScope, names: string[]) {
  return withSource(scope, undefined, async (tx, source, ownerUserId) => {
    const rows = names.length ? await readBoundedSecrets(tx, source.id, ownerUserId, names) : []
    if (rows.length !== names.length)
      throw new OrchestrationError('forbidden', 'One or more requested secrets are unavailable')
    const catalogEntries = await decryptEntries(rows)
    return {
      envVars: Object.fromEntries(catalogEntries.map((entry) => [entry.name, entry.plaintext])),
      catalogEntries,
    }
  })
}
