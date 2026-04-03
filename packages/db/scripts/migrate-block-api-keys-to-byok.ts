#!/usr/bin/env bun

// Self-contained script for migrating block-level API keys into workspace BYOK keys.
// Iterates per workspace. Original block-level values are left untouched for safety.
// Handles both literal keys ("sk-xxx...") and env var references ("{{VAR_NAME}}").
//
// Usage:
//   # Step 1 — Dry run: audit for conflicts + preview inserts (no DB writes)
//   #   Outputs migrate-byok-workspace-ids.txt for the live run.
//   bun run packages/db/scripts/migrate-block-api-keys-to-byok.ts --dry-run \
//     --map jina=jina --map perplexity=perplexity --map google_books=google_cloud
//
//   # Step 2 — Live run: insert BYOK keys (--from-file is required)
//   bun run packages/db/scripts/migrate-block-api-keys-to-byok.ts \
//     --map jina=jina --map perplexity=perplexity --map google_books=google_cloud \
//     --from-file migrate-byok-workspace-ids.txt
//
//   # Optionally scope dry run to specific users (repeatable)
//   bun run packages/db/scripts/migrate-block-api-keys-to-byok.ts --dry-run \
//     --map jina=jina --user user_abc123 --user user_def456

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { appendFileSync, readFileSync, writeFileSync } from 'fs'
import { resolve } from 'path'
import { eq, sql } from 'drizzle-orm'
import { index, json, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { v4 as uuidv4 } from 'uuid'

// ---------- CLI ----------
const DRY_RUN = process.argv.includes('--dry-run')

function parseMapArgs(): Record<string, string> {
  const mapping: Record<string, string> = {}
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--map' && args[i + 1]) {
      const [blockType, providerId] = args[i + 1].split('=')
      if (blockType && providerId) {
        mapping[blockType] = providerId
      } else {
        console.error(
          `Invalid --map value: "${args[i + 1]}". Expected format: blockType=providerId`
        )
        process.exit(1)
      }
      i++
    }
  }
  return mapping
}

const BLOCK_TYPE_TO_PROVIDER = parseMapArgs()
if (Object.keys(BLOCK_TYPE_TO_PROVIDER).length === 0) {
  console.error('No --map arguments provided. Specify at least one: --map blockType=providerId')
  console.error(
    'Example: --map jina=jina --map perplexity=perplexity --map google_books=google_cloud'
  )
  process.exit(1)
}

function parseUserArgs(): string[] {
  const users: string[] = []
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--user' && args[i + 1]) {
      users.push(args[i + 1])
      i++
    }
  }
  return users
}

const USER_FILTER = parseUserArgs()

function parseFromFileArg(): string | null {
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--from-file' && args[i + 1]) {
      return args[i + 1]
    }
  }
  return null
}

const FROM_FILE = parseFromFileArg()

if (!DRY_RUN && !FROM_FILE) {
  console.error('Live runs require --from-file. Run with --dry-run first to generate the file.')
  process.exit(1)
}
if (DRY_RUN && FROM_FILE) {
  console.error(
    '--from-file cannot be used with --dry-run. Dry runs always discover workspaces from the database.'
  )
  process.exit(1)
}

// ---------- Env ----------
function getEnv(name: string): string | undefined {
  if (typeof process !== 'undefined' && process.env && name in process.env) {
    return process.env[name]
  }
  return undefined
}

const CONNECTION_STRING = getEnv('POSTGRES_URL') ?? getEnv('DATABASE_URL')
if (!CONNECTION_STRING) {
  console.error('Missing POSTGRES_URL or DATABASE_URL environment variable')
  process.exit(1)
}

const ENCRYPTION_KEY = getEnv('ENCRYPTION_KEY')
if (!ENCRYPTION_KEY || ENCRYPTION_KEY.length !== 64) {
  console.error('ENCRYPTION_KEY must be set to a 64-character hex string (32 bytes)')
  process.exit(1)
}

// ---------- Encryption (mirrors apps/sim/lib/core/security/encryption.ts) ----------
function getEncryptionKeyBuffer(): Buffer {
  return Buffer.from(ENCRYPTION_KEY!, 'hex')
}

async function encryptSecret(secret: string): Promise<string> {
  const iv = randomBytes(16)
  const key = getEncryptionKeyBuffer()
  const cipher = createCipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  let encrypted = cipher.update(secret, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  const authTag = cipher.getAuthTag()
  return `${iv.toString('hex')}:${encrypted}:${authTag.toString('hex')}`
}

async function decryptSecret(encryptedValue: string): Promise<string> {
  const parts = encryptedValue.split(':')
  const ivHex = parts[0]
  const authTagHex = parts[parts.length - 1]
  const encrypted = parts.slice(1, -1).join(':')

  if (!ivHex || !encrypted || !authTagHex) {
    throw new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"')
  }

  const key = getEncryptionKeyBuffer()
  const iv = Buffer.from(ivHex, 'hex')
  const authTag = Buffer.from(authTagHex, 'hex')

  const decipher = createDecipheriv('aes-256-gcm', key, iv, { authTagLength: 16 })
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// ---------- Schema ----------
const workspaceTable = pgTable('workspace', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
})

const workflow = pgTable('workflow', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  workspaceId: text('workspace_id'),
  name: text('name').notNull(),
})

const workflowBlocks = pgTable(
  'workflow_blocks',
  {
    id: text('id').primaryKey(),
    workflowId: text('workflow_id').notNull(),
    type: text('type').notNull(),
    name: text('name').notNull(),
    subBlocks: jsonb('sub_blocks').notNull().default('{}'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workflowIdIdx: index('workflow_blocks_workflow_id_idx').on(table.workflowId),
  })
)

const workspaceBYOKKeys = pgTable(
  'workspace_byok_keys',
  {
    id: text('id').primaryKey(),
    workspaceId: text('workspace_id').notNull(),
    providerId: text('provider_id').notNull(),
    encryptedApiKey: text('encrypted_api_key').notNull(),
    createdBy: text('created_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => ({
    workspaceProviderUnique: uniqueIndex('workspace_byok_provider_unique').on(
      table.workspaceId,
      table.providerId
    ),
    workspaceIdx: index('workspace_byok_workspace_idx').on(table.workspaceId),
  })
)

const environment = pgTable('environment', {
  id: text('id').primaryKey(),
  userId: text('user_id').notNull(),
  variables: json('variables').notNull(),
})

const workspaceEnvironment = pgTable('workspace_environment', {
  id: text('id').primaryKey(),
  workspaceId: text('workspace_id').notNull(),
  variables: json('variables').notNull().default('{}'),
})

const WORKSPACE_CONCURRENCY = 100
const WORKSPACE_BATCH_SIZE = 1000
const SLEEP_MS = 30_000

// ---------- DB ----------
const postgresClient = postgres(CONNECTION_STRING, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 10,
  onnotice: () => {},
})
const db = drizzle(postgresClient)

// ---------- Helpers ----------
const TOOL_INPUT_SUBBLOCK_IDS: Record<string, string> = {
  agent: 'tools',
  human_in_the_loop: 'notification',
}

const ENV_VAR_PATTERN = /^\{\{([^}]+)\}\}$/

function isEnvVarReference(value: string): boolean {
  return ENV_VAR_PATTERN.test(value)
}

function extractEnvVarName(value: string): string | null {
  const match = ENV_VAR_PATTERN.exec(value)
  return match ? match[1].trim() : null
}

function maskKey(key: string): string {
  if (key.length <= 8) return '•'.repeat(8)
  return key.slice(0, 4) + '•'.repeat(Math.min(key.length - 8, 12)) + key.slice(-4)
}

function parseToolInputValue(value: unknown): any[] {
  if (Array.isArray(value)) return value
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value)
      if (Array.isArray(parsed)) return parsed
    } catch {}
  }
  return []
}

type RawKeyRef = {
  rawValue: string
  blockName: string
  workflowId: string
  workflowName: string
  userId: string
}

type EnvLookup = {
  wsEnvVars: Record<string, string>
  personalEnvCache: Map<string, Record<string, string>>
}

type KeySource = 'plaintext' | 'workspace' | 'personal'

const KEY_SOURCE_PRIORITY: Record<KeySource, number> = {
  plaintext: 0,
  workspace: 1,
  personal: 2,
}

interface ResolveKeyContext {
  workspaceId: string
  workspaceOwnerId: string | null
}

type MigrationStats = {
  workspacesProcessed: number
  workspacesSkipped: number
  conflicts: number
  inserted: number
  skippedExisting: number
  errors: number
  envVarFailures: number
}

type WorkspaceResult = {
  stats: MigrationStats
  shouldWriteWorkspaceId: boolean
}

function createEmptyStats(): MigrationStats {
  return {
    workspacesProcessed: 0,
    workspacesSkipped: 0,
    conflicts: 0,
    inserted: 0,
    skippedExisting: 0,
    errors: 0,
    envVarFailures: 0,
  }
}

function mergeStats(target: MigrationStats, source: MigrationStats) {
  target.workspacesProcessed += source.workspacesProcessed
  target.workspacesSkipped += source.workspacesSkipped
  target.conflicts += source.conflicts
  target.inserted += source.inserted
  target.skippedExisting += source.skippedExisting
  target.errors += source.errors
  target.envVarFailures += source.envVarFailures
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

async function resolveKey(
  ref: RawKeyRef,
  env: EnvLookup,
  ctx: ResolveKeyContext
): Promise<{ key: string | null; source: KeySource; envVarFailed: boolean }> {
  if (!isEnvVarReference(ref.rawValue)) {
    return { key: ref.rawValue, source: 'plaintext', envVarFailed: false }
  }

  const varName = extractEnvVarName(ref.rawValue)
  if (!varName) return { key: null, source: 'personal', envVarFailed: true }

  const personalVars = env.personalEnvCache.get(ref.userId)

  const wsValue = env.wsEnvVars[varName]
  const personalValue = personalVars?.[varName]
  const encryptedValue = wsValue ?? personalValue
  const source: KeySource = wsValue ? 'workspace' : 'personal'

  const logPrefix =
    `workspace=${ctx.workspaceId} owner=${ctx.workspaceOwnerId ?? 'unknown'}` +
    ` workflow=${ref.workflowId} user=${ref.userId}`

  if (!encryptedValue) {
    console.warn(
      `  [WARN] Env var "${varName}" not found — ${logPrefix} "${ref.blockName}" in "${ref.workflowName}"`
    )
    return { key: null, source, envVarFailed: true }
  }

  try {
    const decrypted = await decryptSecret(encryptedValue)
    return { key: decrypted, source, envVarFailed: false }
  } catch (error) {
    console.warn(
      `  [WARN] Failed to decrypt env var "${varName}" — ${logPrefix} "${ref.blockName}" in "${ref.workflowName}": ${error}`
    )
    return { key: null, source, envVarFailed: true }
  }
}

async function processWorkspace(
  workspaceId: string,
  allBlockTypes: string[],
  userFilter: ReturnType<typeof sql>,
  total: number,
  index: number
): Promise<WorkspaceResult> {
  const stats = createEmptyStats()

  try {
    const [blocks, wsRows] = await Promise.all([
      db
        .select({
          blockId: workflowBlocks.id,
          blockName: workflowBlocks.name,
          blockType: workflowBlocks.type,
          subBlocks: workflowBlocks.subBlocks,
          workflowId: workflow.id,
          workflowName: workflow.name,
          userId: workflow.userId,
        })
        .from(workflowBlocks)
        .innerJoin(workflow, eq(workflowBlocks.workflowId, workflow.id))
        .where(
          sql`${workflow.workspaceId} = ${workspaceId} AND ${workflowBlocks.type} IN (${sql.join(
            allBlockTypes.map((t) => sql`${t}`),
            sql`, `
          )})${userFilter}`
        ),
      db
        .select({ ownerId: workspaceTable.ownerId })
        .from(workspaceTable)
        .where(eq(workspaceTable.id, workspaceId))
        .limit(1),
    ])

    const workspaceOwnerId = wsRows[0]?.ownerId ?? null

    console.log(
      `[${index}/${total}] [Workspace ${workspaceId}] ${blocks.length} blocks, owner=${workspaceOwnerId ?? 'unknown'}`
    )

    const providerKeys = new Map<string, RawKeyRef[]>()

    for (const block of blocks) {
      const subBlocks = block.subBlocks as Record<string, { value?: any }>

      const providerId = BLOCK_TYPE_TO_PROVIDER[block.blockType]
      if (providerId) {
        const val = subBlocks?.apiKey?.value
        if (typeof val === 'string' && val.trim()) {
          const refs = providerKeys.get(providerId) ?? []
          refs.push({
            rawValue: val,
            blockName: block.blockName,
            workflowId: block.workflowId,
            workflowName: block.workflowName,
            userId: block.userId,
          })
          providerKeys.set(providerId, refs)
        }
      }

      const toolInputId = TOOL_INPUT_SUBBLOCK_IDS[block.blockType]
      if (toolInputId) {
        const tools = parseToolInputValue(subBlocks?.[toolInputId]?.value)
        for (const tool of tools) {
          const toolType = tool?.type as string | undefined
          const toolApiKey = tool?.params?.apiKey as string | undefined
          if (!toolType || !toolApiKey || !toolApiKey.trim()) continue
          const toolProviderId = BLOCK_TYPE_TO_PROVIDER[toolType]
          if (!toolProviderId) continue
          const refs = providerKeys.get(toolProviderId) ?? []
          refs.push({
            rawValue: toolApiKey,
            blockName: `${block.blockName} > tool "${tool.title || toolType}"`,
            workflowId: block.workflowId,
            workflowName: block.workflowName,
            userId: block.userId,
          })
          providerKeys.set(toolProviderId, refs)
        }
      }
    }

    if (providerKeys.size === 0) {
      console.log(`  [${index}/${total}] No API keys found, skipping\n`)
      stats.workspacesSkipped++
      return { stats, shouldWriteWorkspaceId: false }
    }

    const needsEnvVars = [...providerKeys.values()]
      .flat()
      .some((ref) => isEnvVarReference(ref.rawValue))

    let wsEnvVars: Record<string, string> = {}
    const personalEnvCache = new Map<string, Record<string, string>>()

    if (needsEnvVars) {
      const wsEnvRows = await db
        .select()
        .from(workspaceEnvironment)
        .where(sql`${workspaceEnvironment.workspaceId} = ${workspaceId}`)
        .limit(1)
      if (wsEnvRows[0]) {
        wsEnvVars = (wsEnvRows[0].variables as Record<string, string>) || {}
      }

      const userIds = [...new Set([...providerKeys.values()].flat().map((r) => r.userId))]
      if (userIds.length > 0) {
        const personalRows = await db
          .select()
          .from(environment)
          .where(
            sql`${environment.userId} IN (${sql.join(
              userIds.map((id) => sql`${id}`),
              sql`, `
            )})`
          )
        for (const row of personalRows) {
          personalEnvCache.set(row.userId, (row.variables as Record<string, string>) || {})
        }
      }
    }

    const envLookup: EnvLookup = { wsEnvVars, personalEnvCache }

    stats.workspacesProcessed++

    const existingBYOKProviders = new Set<string>()
    if (DRY_RUN) {
      const existingRows = await db
        .select({ providerId: workspaceBYOKKeys.providerId })
        .from(workspaceBYOKKeys)
        .where(eq(workspaceBYOKKeys.workspaceId, workspaceId))
      for (const row of existingRows) {
        existingBYOKProviders.add(row.providerId)
      }
    }

    let hasNewInserts = false

    for (const [providerId, refs] of providerKeys) {
      const resolved: { ref: RawKeyRef; key: string; source: KeySource }[] = []
      const resolveCtx: ResolveKeyContext = { workspaceId, workspaceOwnerId }
      for (const ref of refs) {
        const { key, source, envVarFailed } = await resolveKey(ref, envLookup, resolveCtx)
        if (envVarFailed) stats.envVarFailures++
        if (!key?.trim()) continue

        if (source === 'personal' && ref.userId !== workspaceOwnerId) {
          console.log(
            `  [SKIP-PERSONAL] Ignoring non-owner personal key from user=${ref.userId} workflow=${ref.workflowId} "${ref.blockName}" in "${ref.workflowName}"`
          )
          continue
        }

        resolved.push({ ref, key: key.trim(), source })
      }

      if (resolved.length === 0) continue

      resolved.sort((a, b) => KEY_SOURCE_PRIORITY[a.source] - KEY_SOURCE_PRIORITY[b.source])

      const distinctKeys = new Set(resolved.map((r) => r.key))
      if (distinctKeys.size > 1) {
        stats.conflicts++
        console.log(`  [CONFLICT] provider "${providerId}": ${distinctKeys.size} distinct keys`)
        for (const { ref, key, source } of resolved) {
          const isOwner = ref.userId === workspaceOwnerId ? ' (owner)' : ''
          const display = isEnvVarReference(ref.rawValue)
            ? `${ref.rawValue} -> ${maskKey(key)}`
            : maskKey(ref.rawValue)
          console.log(
            `    [${source}] user=${ref.userId}${isOwner} workflow=${ref.workflowId} "${ref.blockName}" in "${ref.workflowName}": ${display}`
          )
        }
        const chosenIsOwner = resolved[0].ref.userId === workspaceOwnerId ? ', owner' : ''
        console.log(
          `    Using highest-priority key (${resolved[0].source}${chosenIsOwner}, user=${resolved[0].ref.userId})`
        )
      }

      const chosen = resolved[0]

      if (DRY_RUN) {
        if (existingBYOKProviders.has(providerId)) {
          console.log(`  [DRY RUN] BYOK already exists for provider "${providerId}", skipping`)
          stats.skippedExisting++
          continue
        }
        hasNewInserts = true
        console.log(
          `  [DRY RUN] Would insert BYOK for provider "${providerId}": ${maskKey(chosen.key)}`
        )
        continue
      }

      try {
        const encrypted = await encryptSecret(chosen.key)
        const result = await db
          .insert(workspaceBYOKKeys)
          .values({
            id: uuidv4(),
            workspaceId,
            providerId,
            encryptedApiKey: encrypted,
            createdBy: chosen.ref.userId,
          })
          .onConflictDoNothing({
            target: [workspaceBYOKKeys.workspaceId, workspaceBYOKKeys.providerId],
          })
          .returning({ id: workspaceBYOKKeys.id })

        if (result.length === 0) {
          console.log(`  [SKIP] BYOK already exists for provider "${providerId}"`)
          stats.skippedExisting++
        } else {
          console.log(`  [INSERT] BYOK for provider "${providerId}": ${maskKey(chosen.key)}`)
          stats.inserted++
        }
      } catch (error) {
        console.error(`  [ERROR] Failed to insert BYOK for provider "${providerId}":`, error)
        stats.errors++
      }
    }

    console.log(`  [${index}/${total}] Done with workspace ${workspaceId}\n`)
    return { stats, shouldWriteWorkspaceId: DRY_RUN && hasNewInserts }
  } catch (error) {
    console.error(`  [ERROR] Failed workspace ${workspaceId}:`, error)
    stats.errors++
    return { stats, shouldWriteWorkspaceId: false }
  }
}

// ---------- Main ----------
async function run() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (audit + preview)' : 'LIVE'}`)
  console.log(
    `Mappings: ${Object.entries(BLOCK_TYPE_TO_PROVIDER)
      .map(([b, p]) => `${b}=${p}`)
      .join(', ')}`
  )
  console.log(`Users: ${USER_FILTER.length > 0 ? USER_FILTER.join(', ') : 'all'}`)
  if (FROM_FILE) console.log(`From file: ${FROM_FILE}`)
  console.log('---\n')

  const stats = createEmptyStats()
  let workspaceIdsWritten = 0

  try {
    // 1. Get distinct workspace IDs that have matching blocks
    const mappedBlockTypes = Object.keys(BLOCK_TYPE_TO_PROVIDER)
    const agentTypes = Object.keys(TOOL_INPUT_SUBBLOCK_IDS)
    const allBlockTypes = [...new Set([...mappedBlockTypes, ...agentTypes])]

    const userFilter =
      USER_FILTER.length > 0
        ? sql` AND ${workflow.userId} IN (${sql.join(
            USER_FILTER.map((id) => sql`${id}`),
            sql`, `
          )})`
        : sql``

    let workspaceIds: string[]

    if (DRY_RUN) {
      const workspaceIdRows = await db
        .selectDistinct({ workspaceId: workflow.workspaceId })
        .from(workflowBlocks)
        .innerJoin(workflow, eq(workflowBlocks.workflowId, workflow.id))
        .where(
          sql`${workflow.workspaceId} IS NOT NULL AND ${workflowBlocks.type} IN (${sql.join(
            allBlockTypes.map((t) => sql`${t}`),
            sql`, `
          )})${userFilter}`
        )

      workspaceIds = workspaceIdRows
        .map((r) => r.workspaceId)
        .filter((id): id is string => id !== null)

      console.log(`Found ${workspaceIds.length} workspaces with candidate blocks\n`)

      const outPath = resolve('migrate-byok-workspace-ids.txt')
      writeFileSync(outPath, '')
      console.log(`[DRY RUN] Will write workspace IDs with keys to ${outPath}\n`)
    } else {
      const raw = readFileSync(resolve(FROM_FILE!), 'utf-8')
      workspaceIds = raw
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean)
      console.log(`Loaded ${workspaceIds.length} workspace IDs from ${FROM_FILE}\n`)
    }

    // 2. Process workspaces in parallel groups of 100, pausing for 60s after each 1000
    for (let batchStart = 0; batchStart < workspaceIds.length; batchStart += WORKSPACE_BATCH_SIZE) {
      const batch = workspaceIds.slice(batchStart, batchStart + WORKSPACE_BATCH_SIZE)
      console.log(
        `[BATCH] Processing workspaces ${batchStart + 1}-${batchStart + batch.length} of ${workspaceIds.length}`
      )

      for (
        let concurrencyStart = 0;
        concurrencyStart < batch.length;
        concurrencyStart += WORKSPACE_CONCURRENCY
      ) {
        const workspaceChunk = batch.slice(
          concurrencyStart,
          concurrencyStart + WORKSPACE_CONCURRENCY
        )
        const results = await Promise.all(
          workspaceChunk.map((workspaceId, chunkIndex) =>
            processWorkspace(
              workspaceId,
              allBlockTypes,
              userFilter,
              workspaceIds.length,
              batchStart + concurrencyStart + chunkIndex + 1
            )
          )
        )

        if (DRY_RUN) {
          const workspaceIdsWithKeys = results
            .map((result, resultIndex) =>
              result.shouldWriteWorkspaceId ? workspaceChunk[resultIndex] : null
            )
            .filter((id): id is string => id !== null)

          if (workspaceIdsWithKeys.length > 0) {
            appendFileSync(
              resolve('migrate-byok-workspace-ids.txt'),
              `${workspaceIdsWithKeys.join('\n')}\n`
            )
            workspaceIdsWritten += workspaceIdsWithKeys.length
          }
        }

        for (const result of results) {
          mergeStats(stats, result.stats)
        }
      }

      if (batchStart + batch.length < workspaceIds.length) {
        console.log(
          `  [THROTTLE] ${batchStart + batch.length}/${workspaceIds.length} workspaces — sleeping ${SLEEP_MS / 1000}s`
        )
        await sleep(SLEEP_MS)
      }
    }

    // 3. Summary
    console.log('---')
    console.log('Summary:')
    console.log(`  Workspaces processed: ${stats.workspacesProcessed}`)
    console.log(`  Workspaces skipped (no keys): ${stats.workspacesSkipped}`)
    console.log(`  BYOK keys inserted: ${stats.inserted}`)
    console.log(`  BYOK keys skipped (already existed): ${stats.skippedExisting}`)
    console.log(`  Conflicts (multiple distinct keys): ${stats.conflicts}`)
    console.log(`  Insert errors: ${stats.errors}`)
    console.log(`  Env var resolution failures: ${stats.envVarFailures}`)

    if (DRY_RUN) {
      console.log(
        `\n[DRY RUN] Wrote ${workspaceIdsWritten} workspace IDs (with new keys to insert) to migrate-byok-workspace-ids.txt`
      )
      console.log('[DRY RUN] No changes were made to the database.')
      console.log('Run without --dry-run to apply changes.')
    } else {
      console.log('\nMigration completed successfully!')
    }
  } catch (error) {
    console.error('Fatal error:', error)
    process.exit(1)
  } finally {
    try {
      await postgresClient.end({ timeout: 5 })
    } catch {}
  }
}

run()
  .then(() => {
    console.log('\nDone!')
    process.exit(0)
  })
  .catch((error) => {
    console.error('Unexpected error:', error)
    process.exit(1)
  })
