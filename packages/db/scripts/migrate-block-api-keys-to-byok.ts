#!/usr/bin/env bun

// Self-contained script for migrating block-level API keys into workspace BYOK keys.
// Original block-level values are left untouched for safety.
// Handles both literal keys ("sk-xxx...") and env var references ("{{VAR_NAME}}").
//
// Usage:
//   # Dry run: audit for conflicts + preview inserts (no DB writes)
//   bun run packages/db/scripts/migrate-block-api-keys-to-byok.ts --dry-run \
//     --map jina=jina --map perplexity=perplexity --map google_books=google_cloud
//
//   # Live run: insert BYOK keys
//   bun run packages/db/scripts/migrate-block-api-keys-to-byok.ts \
//     --map jina=jina --map perplexity=perplexity --map google_books=google_cloud

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import { eq, sql } from 'drizzle-orm'
import { index, json, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core'
import { drizzle } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'
import { v4 as uuidv4 } from 'uuid'

// ---------- CLI parsing ----------
const DRY_RUN = process.argv.includes('--dry-run')
const BATCH_SIZE = 50

function parseMapArgs(): Record<string, string> {
  const mapping: Record<string, string> = {}
  const args = process.argv.slice(2)
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--map' && args[i + 1]) {
      const [blockType, providerId] = args[i + 1].split('=')
      if (blockType && providerId) {
        mapping[blockType] = providerId
      } else {
        console.error(`Invalid --map value: "${args[i + 1]}". Expected format: blockType=providerId`)
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

// ---------- Inlined encryption helpers (mirrors apps/sim/lib/core/security/encryption.ts) ----------
function getEncryptionKeyBuffer(): Buffer {
  return Buffer.from(ENCRYPTION_KEY!, 'hex')
}

async function encryptSecret(secret: string): Promise<string> {
  const iv = randomBytes(16)
  const key = getEncryptionKeyBuffer()
  const cipher = createCipheriv('aes-256-gcm', key, iv)
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

  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(authTag)

  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

// ---------- Minimal schema ----------
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

// ---------- DB client ----------
const postgresClient = postgres(CONNECTION_STRING, {
  prepare: false,
  idle_timeout: 20,
  connect_timeout: 30,
  max: 10,
  onnotice: () => {},
})
const db = drizzle(postgresClient)

// ---------- Agent/HITL nested tool handling ----------
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

// ---------- Types ----------
type KeyEntry = {
  workspaceId: string
  providerId: string
  apiKey: string
  userId: string
  blockId: string
  blockName: string
  workflowId: string
  workflowName: string
  rawValue: string
  isEnvVar: boolean
}

// ---------- Main ----------
async function run() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (audit + preview)' : 'LIVE'}`)
  console.log(`Mappings: ${Object.entries(BLOCK_TYPE_TO_PROVIDER).map(([b, p]) => `${b}=${p}`).join(', ')}`)
  console.log('---\n')

  try {
    // 1. Build block type list: mapped types + agent/HITL for nested tools
    const mappedBlockTypes = Object.keys(BLOCK_TYPE_TO_PROVIDER)
    const agentTypes = Object.keys(TOOL_INPUT_SUBBLOCK_IDS)
    const allBlockTypes = [...new Set([...mappedBlockTypes, ...agentTypes])]

    const rows = await db
      .select({
        blockId: workflowBlocks.id,
        blockName: workflowBlocks.name,
        blockType: workflowBlocks.type,
        subBlocks: workflowBlocks.subBlocks,
        workflowId: workflow.id,
        workflowName: workflow.name,
        userId: workflow.userId,
        workspaceId: workflow.workspaceId,
      })
      .from(workflowBlocks)
      .innerJoin(workflow, eq(workflowBlocks.workflowId, workflow.id))
      .where(
        sql`${workflowBlocks.type} IN (${sql.join(
          allBlockTypes.map((t) => sql`${t}`),
          sql`, `
        )})`
      )

    console.log(`Found ${rows.length} candidate blocks\n`)

    // 2. Pre-load env vars for resolving {{VAR}} references
    const personalEnvRows = await db.select().from(environment)
    const workspaceEnvRows = await db.select().from(workspaceEnvironment)

    const personalEnvByUser = new Map<string, Record<string, string>>()
    for (const row of personalEnvRows) {
      personalEnvByUser.set(row.userId, (row.variables as Record<string, string>) || {})
    }

    const workspaceEnvByWs = new Map<string, Record<string, string>>()
    for (const row of workspaceEnvRows) {
      workspaceEnvByWs.set(row.workspaceId, (row.variables as Record<string, string>) || {})
    }

    console.log(
      `Loaded env vars: ${personalEnvByUser.size} users, ${workspaceEnvByWs.size} workspaces\n`
    )

    async function resolveApiKeyValue(
      value: string,
      workspaceId: string,
      userId: string,
      context: string
    ): Promise<{ resolvedKey: string | null; isEnvVar: boolean; failed: boolean }> {
      if (isEnvVarReference(value)) {
        const varName = extractEnvVarName(value)
        if (varName) {
          const wsVars = workspaceEnvByWs.get(workspaceId)
          const personalVars = personalEnvByUser.get(userId)
          const encryptedValue = wsVars?.[varName] ?? personalVars?.[varName]

          if (encryptedValue) {
            try {
              const resolved = await decryptSecret(encryptedValue)
              return { resolvedKey: resolved, isEnvVar: true, failed: false }
            } catch (error) {
              console.warn(
                `  [WARN] Failed to decrypt env var "${varName}" for ${context}: ${error}`
              )
              return { resolvedKey: null, isEnvVar: true, failed: true }
            }
          } else {
            console.warn(`  [WARN] Env var "${varName}" not found for ${context}`)
            return { resolvedKey: null, isEnvVar: true, failed: true }
          }
        }
        return { resolvedKey: null, isEnvVar: true, failed: true }
      }

      return { resolvedKey: value, isEnvVar: false, failed: false }
    }

    // 3. Scan all blocks and collect resolved keys
    const allEntries: KeyEntry[] = []
    let literalCount = 0
    let envVarCount = 0
    let nestedToolKeyCount = 0
    let envVarResolutionFailures = 0
    let skippedNoWorkspace = 0
    let skippedEmptyKey = 0

    for (const row of rows as any[]) {
      const subBlocks = row.subBlocks as Record<string, { id: string; type: string; value?: any }>
      const workspaceId = row.workspaceId as string | null
      if (!workspaceId) {
        skippedNoWorkspace++
        continue
      }

      // --- Direct apiKey on the block ---
      const providerId = BLOCK_TYPE_TO_PROVIDER[row.blockType]
      if (providerId) {
        const apiKeyValue = subBlocks?.apiKey?.value
        if (typeof apiKeyValue === 'string' && apiKeyValue.trim()) {
          const { resolvedKey, isEnvVar, failed } = await resolveApiKeyValue(
            apiKeyValue,
            workspaceId,
            row.userId,
            `block ${row.blockId}`
          )

          if (isEnvVar) envVarCount++
          else literalCount++
          if (failed) envVarResolutionFailures++

          if (resolvedKey?.trim()) {
            allEntries.push({
              workspaceId,
              providerId,
              apiKey: resolvedKey,
              userId: row.userId,
              blockId: row.blockId,
              blockName: row.blockName,
              workflowId: row.workflowId,
              workflowName: row.workflowName,
              rawValue: apiKeyValue,
              isEnvVar,
            })
          }
        } else {
          skippedEmptyKey++
        }
      }

      // --- Nested tools inside agent / human_in_the_loop ---
      const toolInputId = TOOL_INPUT_SUBBLOCK_IDS[row.blockType]
      if (toolInputId) {
        const toolInputSubBlock = subBlocks?.[toolInputId]
        if (toolInputSubBlock) {
          const tools = parseToolInputValue(toolInputSubBlock.value)
          for (const tool of tools) {
            const toolType = tool?.type as string | undefined
            const toolApiKey = tool?.params?.apiKey as string | undefined
            if (!toolType || !toolApiKey || !toolApiKey.trim()) continue

            const toolProviderId = BLOCK_TYPE_TO_PROVIDER[toolType]
            if (!toolProviderId) continue

            nestedToolKeyCount++

            const { resolvedKey, isEnvVar, failed } = await resolveApiKeyValue(
              toolApiKey,
              workspaceId,
              row.userId,
              `nested tool "${toolType}" in block ${row.blockId}`
            )

            if (isEnvVar) envVarCount++
            else literalCount++
            if (failed) envVarResolutionFailures++

            if (resolvedKey?.trim()) {
              allEntries.push({
                workspaceId,
                providerId: toolProviderId,
                apiKey: resolvedKey,
                userId: row.userId,
                blockId: row.blockId,
                blockName: `${row.blockName} > tool "${tool.title || toolType}"`,
                workflowId: row.workflowId,
                workflowName: row.workflowName,
                rawValue: toolApiKey,
                isEnvVar,
              })
            }
          }
        }
      }
    }

    console.log(`Literal API keys: ${literalCount}`)
    console.log(`Env var references: ${envVarCount}`)
    console.log(`Nested tool keys (agent/HITL): ${nestedToolKeyCount}`)
    console.log(`Env var resolution failures: ${envVarResolutionFailures}`)
    console.log(`Skipped (no workspace): ${skippedNoWorkspace}`)
    console.log(`Skipped (empty key): ${skippedEmptyKey}`)
    console.log(`Total resolved key entries: ${allEntries.length}\n`)

    // 4. Deduplicate by (workspaceId, providerId) — first key wins
    const byokInserts = new Map<
      string,
      { workspaceId: string; providerId: string; apiKey: string; userId: string }
    >()
    for (const entry of allEntries) {
      const dedupeKey = `${entry.workspaceId}::${entry.providerId}`
      if (!byokInserts.has(dedupeKey)) {
        byokInserts.set(dedupeKey, {
          workspaceId: entry.workspaceId,
          providerId: entry.providerId,
          apiKey: entry.apiKey,
          userId: entry.userId,
        })
      }
    }

    console.log(`Unique (workspace, provider) pairs to insert: ${byokInserts.size}\n`)

    // 5. Dry run: audit for conflicts + preview
    if (DRY_RUN) {
      // Group entries by (workspace, provider) to detect conflicts
      const groupMap = new Map<string, KeyEntry[]>()
      for (const entry of allEntries) {
        const key = `${entry.workspaceId}::${entry.providerId}`
        if (!groupMap.has(key)) groupMap.set(key, [])
        groupMap.get(key)!.push(entry)
      }

      let conflictCount = 0
      for (const [groupKey, entries] of groupMap) {
        const distinctKeys = new Set(entries.map((e) => e.apiKey))
        if (distinctKeys.size <= 1) continue

        conflictCount++
        const [wsId, provId] = groupKey.split('::')
        console.log(
          `  [CONFLICT] workspace ${wsId}, provider "${provId}" has ${distinctKeys.size} distinct keys:`
        )
        for (const entry of entries) {
          const keyDisplay = entry.isEnvVar ? entry.rawValue : maskKey(entry.rawValue)
          const typeLabel = entry.isEnvVar ? 'env var' : 'literal'
          const resolvedNote = entry.isEnvVar ? ` -> resolves to ${maskKey(entry.apiKey)}` : ''
          console.log(
            `    Block "${entry.blockName}" in workflow "${entry.workflowName}": ${keyDisplay} (${typeLabel})${resolvedNote}`
          )
        }
        console.log()
      }

      if (conflictCount === 0) {
        console.log('No conflicts detected.\n')
      } else {
        console.log(
          `${conflictCount} conflict(s) found. First key per (workspace, provider) will be used.\n`
        )
      }

      for (const entry of byokInserts.values()) {
        console.log(
          `  [DRY RUN] Would insert BYOK key for workspace ${entry.workspaceId}, provider "${entry.providerId}": ${maskKey(entry.apiKey)}`
        )
      }

      console.log('\n[DRY RUN] No changes were made to the database.')
      console.log('Run without --dry-run to apply changes.')
      return
    }

    // 6. Live: insert into workspace_byok_keys
    const insertEntries = Array.from(byokInserts.values())
    let insertedCount = 0
    let skippedConflictCount = 0
    let insertErrorCount = 0

    for (let i = 0; i < insertEntries.length; i += BATCH_SIZE) {
      const batch = insertEntries.slice(i, i + BATCH_SIZE)
      const batchNum = Math.floor(i / BATCH_SIZE) + 1
      console.log(
        `Insert batch ${batchNum} (${i + 1}-${Math.min(i + BATCH_SIZE, insertEntries.length)} of ${insertEntries.length})`
      )

      for (const entry of batch) {
        try {
          const encrypted = await encryptSecret(entry.apiKey)

          const result = await db
            .insert(workspaceBYOKKeys)
            .values({
              id: uuidv4(),
              workspaceId: entry.workspaceId,
              providerId: entry.providerId,
              encryptedApiKey: encrypted,
              createdBy: entry.userId,
            })
            .onConflictDoNothing({
              target: [workspaceBYOKKeys.workspaceId, workspaceBYOKKeys.providerId],
            })

          if ((result as any).rowCount === 0) {
            console.log(
              `  [SKIP] BYOK key already exists for workspace ${entry.workspaceId}, provider "${entry.providerId}"`
            )
            skippedConflictCount++
          } else {
            console.log(
              `  [INSERT] BYOK key for workspace ${entry.workspaceId}, provider "${entry.providerId}": ${maskKey(entry.apiKey)}`
            )
            insertedCount++
          }
        } catch (error) {
          console.error(
            `  [ERROR] Failed to insert BYOK key for workspace ${entry.workspaceId}, provider "${entry.providerId}":`,
            error
          )
          insertErrorCount++
        }
      }
    }

    // 7. Summary
    console.log('\n---')
    console.log('Migration Summary:')
    console.log(`  BYOK keys inserted: ${insertedCount}`)
    console.log(`  BYOK keys skipped (already existed): ${skippedConflictCount}`)
    console.log(`  BYOK insert errors: ${insertErrorCount}`)
    console.log(`  Env var resolution failures: ${envVarResolutionFailures}`)
    console.log('\nMigration completed successfully!')
  } catch (error) {
    console.error('Fatal error during migration:', error)
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
