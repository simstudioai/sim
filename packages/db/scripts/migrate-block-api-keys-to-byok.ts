#!/usr/bin/env bun

// Self-contained script for migrating block-level API keys into workspace BYOK keys.
// Iterates per workspace. Original block-level values are left untouched for safety.
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

// ---------- Encryption (mirrors apps/sim/lib/core/security/encryption.ts) ----------
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

// ---------- Schema ----------
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
  workflowName: string
  userId: string
}

// ---------- Main ----------
async function run() {
  console.log(`Mode: ${DRY_RUN ? 'DRY RUN (audit + preview)' : 'LIVE'}`)
  console.log(
    `Mappings: ${Object.entries(BLOCK_TYPE_TO_PROVIDER).map(([b, p]) => `${b}=${p}`).join(', ')}`
  )
  console.log('---\n')

  const stats = {
    workspacesProcessed: 0,
    workspacesSkipped: 0,
    conflicts: 0,
    inserted: 0,
    skippedExisting: 0,
    errors: 0,
    envVarFailures: 0,
  }

  try {
    // 1. Find all blocks that match our mapped types or contain nested tools
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

    // Group rows by workspace
    const workspaceRows = new Map<string, typeof rows>()
    let skippedNoWorkspace = 0
    for (const row of rows) {
      if (!row.workspaceId) {
        skippedNoWorkspace++
        continue
      }
      if (!workspaceRows.has(row.workspaceId)) workspaceRows.set(row.workspaceId, [])
      workspaceRows.get(row.workspaceId)!.push(row)
    }

    console.log(`Found ${rows.length} candidate blocks across ${workspaceRows.size} workspaces`)
    if (skippedNoWorkspace > 0) console.log(`Skipped ${skippedNoWorkspace} blocks with no workspace`)
    console.log()

    // 2. Iterate per workspace
    for (const [workspaceId, blocks] of workspaceRows) {
      console.log(`[Workspace ${workspaceId}] ${blocks.length} blocks`)

      // 2a. Extract all raw key references grouped by provider
      const providerKeys = new Map<string, RawKeyRef[]>()

      function addRef(providerId: string, ref: RawKeyRef) {
        if (!providerKeys.has(providerId)) providerKeys.set(providerId, [])
        providerKeys.get(providerId)!.push(ref)
      }

      for (const block of blocks) {
        const subBlocks = block.subBlocks as Record<string, { value?: any }>

        const providerId = BLOCK_TYPE_TO_PROVIDER[block.blockType]
        if (providerId) {
          const val = subBlocks?.apiKey?.value
          if (typeof val === 'string' && val.trim()) {
            addRef(providerId, {
              rawValue: val,
              blockName: block.blockName,
              workflowName: block.workflowName,
              userId: block.userId,
            })
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
            addRef(toolProviderId, {
              rawValue: toolApiKey,
              blockName: `${block.blockName} > tool "${tool.title || toolType}"`,
              workflowName: block.workflowName,
              userId: block.userId,
            })
          }
        }
      }

      if (providerKeys.size === 0) {
        console.log('  No API keys found, skipping\n')
        stats.workspacesSkipped++
        continue
      }

      // 2b. Load env vars only if this workspace has env var references
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

      async function resolveKey(
        ref: RawKeyRef,
        context: string
      ): Promise<string | null> {
        if (!isEnvVarReference(ref.rawValue)) return ref.rawValue

        const varName = extractEnvVarName(ref.rawValue)
        if (!varName) {
          stats.envVarFailures++
          return null
        }

        const personalVars = personalEnvCache.get(ref.userId)
        const encryptedValue = wsEnvVars[varName] ?? personalVars?.[varName]
        if (!encryptedValue) {
          console.warn(`  [WARN] Env var "${varName}" not found (${context})`)
          stats.envVarFailures++
          return null
        }

        try {
          return await decryptSecret(encryptedValue)
        } catch (error) {
          console.warn(`  [WARN] Failed to decrypt env var "${varName}" (${context}): ${error}`)
          stats.envVarFailures++
          return null
        }
      }

      // 2c. For each provider, detect conflicts then resolve and insert
      stats.workspacesProcessed++

      for (const [providerId, refs] of providerKeys) {
        // Resolve all keys for this provider to check for conflicts
        const resolved: { ref: RawKeyRef; key: string }[] = []
        for (const ref of refs) {
          const key = await resolveKey(ref, `"${ref.blockName}" in "${ref.workflowName}"`)
          if (key?.trim()) resolved.push({ ref, key })
        }

        if (resolved.length === 0) continue

        // Detect conflicting values
        const distinctKeys = new Set(resolved.map((r) => r.key))
        if (distinctKeys.size > 1) {
          stats.conflicts++
          console.log(`  [CONFLICT] provider "${providerId}": ${distinctKeys.size} distinct keys`)
          for (const { ref, key } of resolved) {
            const display = isEnvVarReference(ref.rawValue)
              ? `${ref.rawValue} -> ${maskKey(key)}`
              : maskKey(ref.rawValue)
            console.log(`    "${ref.blockName}" in "${ref.workflowName}": ${display}`)
          }
          console.log('    Using first resolved key')
        }

        // Use the first resolved key
        const chosen = resolved[0]

        if (DRY_RUN) {
          console.log(
            `  [DRY RUN] Would insert BYOK for provider "${providerId}": ${maskKey(chosen.key)}`
          )
          continue
        }

        // Insert into BYOK
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

          if ((result as any).rowCount === 0) {
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

      console.log()
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
      console.log('\n[DRY RUN] No changes were made to the database.')
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
