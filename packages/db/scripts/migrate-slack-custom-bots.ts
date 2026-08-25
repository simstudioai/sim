#!/usr/bin/env bun

/**
 * Materializes raw Slack bot tokens from saved workflows as reusable
 * `slack-custom-bot` credentials.
 *
 * This intentionally mirrors the block-key-to-BYOK migration:
 * - dry-run discovery and validation must happen first;
 * - the dry run writes the workspace allowlist consumed by the live run;
 * - migrated legacy triggers keep their URL and gain a durable credential link;
 * - deployment snapshots are never changed.
 * - Slack is never called; token validation remains deferred to normal credential use.
 *
 * Sources covered:
 * - legacy Slack triggers (`signingSecret` + `botToken`), including `triggerConfig` fallback;
 * - legacy Slack action blocks using `authMethod = bot_token`;
 * - Slack tools embedded in `tools` or `notification` tool-input subblocks.
 *
 * Usage:
 *   bun run packages/db/scripts/migrate-slack-custom-bots.ts --dry-run
 *   bun run packages/db/scripts/migrate-slack-custom-bots.ts \
 *     --from-file migrate-slack-custom-bot-workspace-ids.txt
 */

import { createCipheriv, createDecipheriv, randomBytes } from 'crypto'
import {
  appendFileSync,
  existsSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from 'fs'
import { resolve } from 'path'
import {
  credential,
  credentialMember,
  environment,
  permissions,
  webhook,
  workflow,
  workflowBlocks,
  workspace,
  workspaceEnvironment,
} from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { describeError, getErrorMessage, getPostgresErrorCode } from '@sim/utils/errors'
import { chunkArray, sleep } from '@sim/utils/helpers'
import { generateId } from '@sim/utils/id'
import { isRecordLike } from '@sim/utils/object'
import { type BackoffOptions, backoffWithJitter } from '@sim/utils/retry'
import { truncate } from '@sim/utils/string'
import { and, asc, eq, gt, inArray, isNotNull, isNull, sql } from 'drizzle-orm'
import { drizzle, type PostgresJsDatabase } from 'drizzle-orm/postgres-js'
import postgres from 'postgres'

const logger = createLogger('MigrateSlackCustomBots', { logLevel: 'INFO', enabled: true })

const SLACK_CUSTOM_BOT_PROVIDER_ID = 'slack-custom-bot'
const SLACK_CUSTOM_BOT_SECRET_TYPE = 'slack_custom_bot'
const LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE = 'legacy_custom_bot'
const DISPLAY_NAME_MAX_LENGTH = 255
const DESCRIPTION_MAX_LENGTH = 500
const OUTPUT_FILE = 'migrate-slack-custom-bot-workspace-ids.txt'
const WORKSPACE_CONCURRENCY = 10
const WORKSPACE_DISCOVERY_PAGE_SIZE = 250
const MEMBERSHIP_INSERT_CHUNK_SIZE = 500
const TRIGGER_BLOCK_UPDATE_CHUNK_SIZE = 500
const WEBHOOK_UPDATE_CHUNK_SIZE = 500
const ENVIRONMENT_USER_QUERY_CHUNK_SIZE = 500
const MAX_BLOCKS_PER_WORKSPACE = 10_000
const MAX_MEMBERS_PER_WORKSPACE = 10_000
const MAX_SLACK_CREDENTIALS_PER_WORKSPACE = 10_000
const MAX_SLACK_WEBHOOKS_PER_WORKSPACE = 10_000
const MAX_SOURCES_PER_WORKSPACE = 20_000
const MAX_TOOLS_PER_SUBBLOCK = 1_000
const MAX_SUBBLOCK_BYTES = 2 * 1024 * 1024
const MAX_WORKSPACE_SUBBLOCK_BYTES = 32 * 1024 * 1024
const MAX_ENVIRONMENT_BYTES = 5 * 1024 * 1024
const MAX_PERSONAL_ENVIRONMENT_BYTES_PER_WORKSPACE = 16 * 1024 * 1024
const MAX_ENCRYPTED_CREDENTIAL_BYTES = 256 * 1024
const MAX_ENCRYPTED_CREDENTIAL_BYTES_PER_WORKSPACE = 16 * 1024 * 1024
const MAX_WEBHOOK_PROVIDER_CONFIG_BYTES = 512 * 1024
const MAX_WEBHOOK_PROVIDER_CONFIG_BYTES_PER_WORKSPACE = 16 * 1024 * 1024
const MAX_ALLOWLIST_BYTES = 10 * 1024 * 1024
const MAX_ALLOWLIST_WORKSPACES = 250_000
const TRANSACTION_LOCK_TIMEOUT_MS = 2_000
const TRANSACTION_STATEMENT_TIMEOUT_MS = 10_000
const LIVE_LOCK_NAMESPACE = 834_217
const LIVE_LOCK_ID = 20_260_819
const DATABASE_READ_MAX_ATTEMPTS = 5
const DATABASE_READ_RETRY_BACKOFF = { baseMs: 500, maxMs: 5_000 } as const

const TRANSIENT_DATABASE_ERROR_CODES = new Set([
  '53300',
  '53400',
  '57P01',
  '57P02',
  '57P03',
  '58000',
  '58030',
  'CONNECT_TIMEOUT',
  'CONNECTION_CLOSED',
  'CONNECTION_DESTROYED',
  'CONNECTION_ENDED',
  'ECONNREFUSED',
  'ECONNRESET',
  'EHOSTUNREACH',
  'ENETDOWN',
  'ENETRESET',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'ETIMEDOUT',
])

const CANDIDATE_BLOCK_TYPES = ['slack', 'agent', 'human_in_the_loop', 'mothership', 'pi'] as const

const TOOL_INPUT_SUBBLOCK_IDS = ['tools', 'notification'] as const
const ENV_VAR_PATTERN = /^\{\{([^}]+)\}\}$/

type MigrationDb = PostgresJsDatabase
type PostgresClient = ReturnType<typeof postgres>
type ReservedPostgresClient = Awaited<ReturnType<PostgresClient['reserve']>>
type SlackSourceKind = 'trigger' | 'action' | 'embedded_tool'

interface LiveRunLock {
  connection: ReservedPostgresClient
  backendPid: number
}

interface DatabaseReadRetryContext {
  operation: string
  workspaceId?: string
}

interface DatabaseReadRetryOptions {
  maxAttempts?: number
  backoff?: BackoffOptions
}

export function isTransientDatabaseError(error: unknown): boolean {
  const described = describeError(error)
  const code = getPostgresErrorCode(error) ?? described.errno
  if (!code) return false
  return code.startsWith('08') || TRANSIENT_DATABASE_ERROR_CODES.has(code)
}

export async function retryTransientDatabaseRead<T>(
  operation: () => Promise<T>,
  context: DatabaseReadRetryContext,
  options: DatabaseReadRetryOptions = {}
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? DATABASE_READ_MAX_ATTEMPTS
  if (
    !Number.isInteger(maxAttempts) ||
    maxAttempts < 1 ||
    maxAttempts > DATABASE_READ_MAX_ATTEMPTS
  ) {
    throw new Error(
      `Database read retry attempts must be between 1 and ${DATABASE_READ_MAX_ATTEMPTS}`
    )
  }

  for (let attempt = 1; ; attempt++) {
    try {
      return await operation()
    } catch (error) {
      if (!isTransientDatabaseError(error) || attempt >= maxAttempts) throw error
      const delayMs = backoffWithJitter(
        attempt,
        null,
        options.backoff ?? DATABASE_READ_RETRY_BACKOFF
      )
      logger.warn('Retrying transient database read', {
        operation: context.operation,
        workspaceId: context.workspaceId,
        failedAttempt: attempt,
        maxAttempts,
        retryInMs: Math.round(delayMs),
        error: describeError(error),
      })
      await sleep(delayMs)
    }
  }
}

export interface SlackMigrationBlock {
  blockId: string
  blockName: string
  blockType: string
  triggerMode: boolean
  subBlocks: unknown
  workflowId: string
  workflowName: string
  workflowUserId: string
}

export interface SlackBotSource {
  sourceId: string
  kind: SlackSourceKind
  blockId: string
  blockName: string
  workflowId: string
  workflowName: string
  workflowUserId: string
  toolTitle?: string
  rawBotToken?: string
  rawSigningSecret?: string
  existingBotCredentialId?: string
}

interface CliOptions {
  dryRun: boolean
  fromFile: string | null
}

export interface EnvironmentLookup {
  workspaceVariables: Record<string, string>
  personalVariablesByUserId: Map<string, Record<string, string>>
  workspaceOwnerId: string
  encryptionKey: string
}

export type SlackSourceSecretResolution =
  | { status: 'ready'; botToken: string; signingSecret?: string }
  | { status: 'unresolved'; reason: string }

export interface ResolvedSlackBotSource {
  source: SlackBotSource
  botToken: string
  signingSecret?: string
}

export interface SlackCredentialGroup {
  workflowId: string
  workflowName: string
  botToken: string
  signingSecret?: string
  sources: SlackBotSource[]
}

interface PreparedSourceLink {
  source: SlackBotSource
  updateTriggerBlock: boolean
  legacyWebhookCount: number
  webhookIdsToUpdate: string[]
}

interface PreparedCredential {
  workflowId: string
  workflowName: string
  sources: SlackBotSource[]
  sourceLinks: PreparedSourceLink[]
  credentialId: string
  insertCredential: boolean
  displayName?: string
  description?: string
  botToken?: string
  signingSecret?: string
}

export interface ExistingMigrationCredential {
  credentialId: string
  hasSigningSecret: boolean
}

interface StoredMigrationCredential extends ExistingMigrationCredential {
  workflowId: string
  botToken: string
  signingSecret?: string
}

export interface LegacySlackWebhookRow {
  id: string
  workflowId: string
  blockId: string | null
  routingKey: string | null
  providerConfig: unknown
}

interface MigrationStats {
  workspacesProcessed: number
  workspacesSkipped: number
  sourcesFound: number
  inserted: number
  skippedExisting: number
  skippedUnresolved: number
  triggersLinked: number
  webhooksMarked: number
  actionOnly: number
  errors: number
}

interface WorkspaceResult {
  stats: MigrationStats
  approvedForLiveRun: boolean
}

function emptyStats(): MigrationStats {
  return {
    workspacesProcessed: 0,
    workspacesSkipped: 0,
    sourcesFound: 0,
    inserted: 0,
    skippedExisting: 0,
    skippedUnresolved: 0,
    triggersLinked: 0,
    webhooksMarked: 0,
    actionOnly: 0,
    errors: 0,
  }
}

function mergeStats(target: MigrationStats, source: MigrationStats): void {
  target.workspacesProcessed += source.workspacesProcessed
  target.workspacesSkipped += source.workspacesSkipped
  target.sourcesFound += source.sourcesFound
  target.inserted += source.inserted
  target.skippedExisting += source.skippedExisting
  target.skippedUnresolved += source.skippedUnresolved
  target.triggersLinked += source.triggersLinked
  target.webhooksMarked += source.webhooksMarked
  target.actionOnly += source.actionOnly
  target.errors += source.errors
}

function parseCliOptions(args: string[]): CliOptions {
  const dryRun = args.includes('--dry-run')
  const fromFileIndex = args.indexOf('--from-file')
  const fromFile = fromFileIndex >= 0 ? args[fromFileIndex + 1] : null

  if (fromFileIndex >= 0 && !fromFile) {
    throw new Error('--from-file requires a path')
  }
  if (dryRun && fromFile) {
    throw new Error('--dry-run and --from-file cannot be used together')
  }
  if (!dryRun && !fromFile) {
    throw new Error(`Live runs require --from-file ${OUTPUT_FILE}; run --dry-run first`)
  }

  return { dryRun, fromFile }
}

function nonEmptyString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function subBlockValues(subBlocks: unknown): Record<string, unknown> {
  if (!isRecordLike(subBlocks)) {
    throw new Error('workflow_blocks.sub_blocks must be an object')
  }

  const values: Record<string, unknown> = {}
  for (const [id, stored] of Object.entries(subBlocks)) {
    if (!isRecordLike(stored)) {
      throw new Error(`Subblock "${id}" must be an object`)
    }
    values[id] = stored.value
  }
  return values
}

function parseToolInputValue(value: unknown, subBlockId: string): unknown[] {
  if (value === null || value === undefined || value === '') return []

  const parsed = typeof value === 'string' ? JSON.parse(value) : value
  if (!Array.isArray(parsed)) {
    throw new Error(`Tool-input subblock "${subBlockId}" must contain an array`)
  }
  if (parsed.length > MAX_TOOLS_PER_SUBBLOCK) {
    throw new Error(
      `Tool-input subblock "${subBlockId}" exceeds the ${MAX_TOOLS_PER_SUBBLOCK}-tool migration limit`
    )
  }
  return parsed
}

function preferredTriggerValue(
  values: Record<string, unknown>,
  triggerConfig: Record<string, unknown>,
  field: 'signingSecret' | 'botToken'
): string | undefined {
  return nonEmptyString(values[field]) ?? nonEmptyString(triggerConfig[field])
}

export function extractSlackBotSources(block: SlackMigrationBlock): SlackBotSource[] {
  const values = subBlockValues(block.subBlocks)
  const sources: SlackBotSource[] = []

  if (block.blockType === 'slack') {
    if (block.triggerMode) {
      const rawTriggerConfig = values.triggerConfig
      if (
        rawTriggerConfig !== null &&
        rawTriggerConfig !== undefined &&
        !isRecordLike(rawTriggerConfig)
      ) {
        throw new Error('Slack triggerConfig must be an object when present')
      }
      const triggerConfig = isRecordLike(rawTriggerConfig) ? rawTriggerConfig : {}
      const rawSigningSecret = preferredTriggerValue(values, triggerConfig, 'signingSecret')
      const rawBotToken = preferredTriggerValue(values, triggerConfig, 'botToken')
      const existingBotCredentialId = nonEmptyString(values.botCredential)

      if (rawSigningSecret || rawBotToken) {
        sources.push({
          sourceId: `${block.workflowId}:${block.blockId}:trigger`,
          kind: 'trigger',
          blockId: block.blockId,
          blockName: block.blockName,
          workflowId: block.workflowId,
          workflowName: block.workflowName,
          workflowUserId: block.workflowUserId,
          rawSigningSecret,
          rawBotToken,
          existingBotCredentialId,
        })
      }
    } else {
      const authMethod = nonEmptyString(values.authMethod)
      const rawBotToken = nonEmptyString(values.botToken)
      const usesCustomBot = authMethod === 'bot_token' || (!authMethod && Boolean(rawBotToken))

      if (usesCustomBot) {
        sources.push({
          sourceId: `${block.workflowId}:${block.blockId}:action`,
          kind: 'action',
          blockId: block.blockId,
          blockName: block.blockName,
          workflowId: block.workflowId,
          workflowName: block.workflowName,
          workflowUserId: block.workflowUserId,
          rawBotToken,
        })
      }
    }
  }

  for (const subBlockId of TOOL_INPUT_SUBBLOCK_IDS) {
    const tools = parseToolInputValue(values[subBlockId], subBlockId)
    for (const [index, tool] of tools.entries()) {
      if (!isRecordLike(tool)) continue
      if (tool.type !== 'slack') continue

      if (!isRecordLike(tool.params)) continue
      const authMethod = nonEmptyString(tool.params.authMethod)
      const rawBotToken =
        nonEmptyString(tool.params.botToken) ?? nonEmptyString(tool.params.accessToken)
      const usesCustomBot = authMethod === 'bot_token' || (!authMethod && Boolean(rawBotToken))
      if (!usesCustomBot) continue

      sources.push({
        sourceId: `${block.workflowId}:${block.blockId}:${subBlockId}:${index}`,
        kind: 'embedded_tool',
        blockId: block.blockId,
        blockName: block.blockName,
        workflowId: block.workflowId,
        workflowName: block.workflowName,
        workflowUserId: block.workflowUserId,
        toolTitle: nonEmptyString(tool.title) ?? `Slack tool ${index + 1}`,
        rawBotToken,
      })
    }
  }

  return sources
}

export function buildSlackBotDisplayName(
  workflowName: string,
  takenNames: ReadonlySet<string>
): string {
  const base = workflowName.trim()
  if (!base) throw new Error('Slack credential workflow name cannot be empty')

  const first = truncate(base, DISPLAY_NAME_MAX_LENGTH, '')
  if (!takenNames.has(first.toLowerCase())) return first

  for (let index = 2; index < 10_000; index++) {
    const suffix = ` (${index})`
    const candidate = `${truncate(base, DISPLAY_NAME_MAX_LENGTH - suffix.length, '')}${suffix}`
    if (!takenNames.has(candidate.toLowerCase())) return candidate
  }
  throw new Error(`Could not allocate a unique credential name for workflow "${workflowName}"`)
}

export function buildSlackBotDescription(workflowName: string, sources: SlackBotSource[]): string {
  const sourceLabels = [
    ...new Set(
      sources.map((source) =>
        source.toolTitle
          ? `"${source.blockName.trim()}" (${source.toolTitle.trim()})`
          : `"${source.blockName.trim()}"`
      )
    ),
  ].sort((left, right) => left.localeCompare(right))
  const description = `Used by workflow "${workflowName.trim()}". Blocks: ${sourceLabels.join(', ')}.`
  return truncate(description, DESCRIPTION_MAX_LENGTH)
}

function slackCredentialGroupKey(
  workflowId: string,
  botToken: string,
  signingSecret: string | undefined
): string {
  return JSON.stringify([workflowId, botToken, signingSecret ?? null])
}

function slackBotTokenGroupKey(workflowId: string, botToken: string): string {
  return JSON.stringify([workflowId, botToken])
}

export function groupSlackSourcesByWorkflowCredentials(
  resolvedSources: ResolvedSlackBotSource[]
): SlackCredentialGroup[] {
  const groups = new Map<string, SlackCredentialGroup>()
  const signedGroupKeysByBotToken = new Map<string, string[]>()
  const orderedSources = [...resolvedSources].sort((left, right) =>
    left.source.sourceId.localeCompare(right.source.sourceId)
  )

  for (const resolved of orderedSources.filter((candidate) => candidate.signingSecret)) {
    const key = slackCredentialGroupKey(
      resolved.source.workflowId,
      resolved.botToken,
      resolved.signingSecret
    )
    const existing = groups.get(key)
    if (existing) {
      if (existing.workflowName !== resolved.source.workflowName) {
        throw new Error(`Workflow ${resolved.source.workflowId} has inconsistent names`)
      }
      existing.sources.push(resolved.source)
      continue
    }

    groups.set(key, {
      workflowId: resolved.source.workflowId,
      workflowName: resolved.source.workflowName,
      botToken: resolved.botToken,
      signingSecret: resolved.signingSecret,
      sources: [resolved.source],
    })

    const botTokenKey = slackBotTokenGroupKey(resolved.source.workflowId, resolved.botToken)
    const signedGroupKeys = signedGroupKeysByBotToken.get(botTokenKey) ?? []
    signedGroupKeys.push(key)
    signedGroupKeysByBotToken.set(botTokenKey, signedGroupKeys)
  }

  for (const resolved of orderedSources.filter((candidate) => !candidate.signingSecret)) {
    const botTokenKey = slackBotTokenGroupKey(resolved.source.workflowId, resolved.botToken)
    const signedGroupKeys = signedGroupKeysByBotToken.get(botTokenKey) ?? []
    const key =
      signedGroupKeys.length === 1
        ? signedGroupKeys[0]
        : slackCredentialGroupKey(resolved.source.workflowId, resolved.botToken, undefined)
    if (!key) throw new Error(`Could not group Slack source ${resolved.source.sourceId}`)

    const existing = groups.get(key)
    if (existing) {
      if (existing.workflowName !== resolved.source.workflowName) {
        throw new Error(`Workflow ${resolved.source.workflowId} has inconsistent names`)
      }
      existing.sources.push(resolved.source)
      continue
    }

    groups.set(key, {
      workflowId: resolved.source.workflowId,
      workflowName: resolved.source.workflowName,
      botToken: resolved.botToken,
      sources: [resolved.source],
    })
  }

  return [...groups.values()]
}

/** Creates the exact plaintext payload consumed by `getSlackBotCredential`. */
export function buildSlackCustomBotSecretBlob(
  workflowId: string,
  botToken: string,
  signingSecret: string | undefined
): Record<string, unknown> {
  return {
    type: SLACK_CUSTOM_BOT_SECRET_TYPE,
    ...(signingSecret ? { signingSecret } : {}),
    botToken,
    metadata: { migrationWorkflowId: workflowId },
  }
}

function getEncryptionKeyBuffer(encryptionKey: string): Buffer {
  return Buffer.from(encryptionKey, 'hex')
}

function encryptSecret(secret: string, encryptionKey: string): string {
  const iv = randomBytes(16)
  const cipher = createCipheriv('aes-256-gcm', getEncryptionKeyBuffer(encryptionKey), iv, {
    authTagLength: 16,
  })
  let encrypted = cipher.update(secret, 'utf8', 'hex')
  encrypted += cipher.final('hex')
  return `${iv.toString('hex')}:${encrypted}:${cipher.getAuthTag().toString('hex')}`
}

function decryptSecret(encryptedValue: string, encryptionKey: string): string {
  const parts = encryptedValue.split(':')
  if (parts.length !== 3) {
    throw new Error('Invalid encrypted value format. Expected "iv:encrypted:authTag"')
  }
  const [ivHex, encrypted, authTagHex] = parts
  if (!ivHex || !encrypted || !authTagHex) {
    throw new Error('Encrypted value is missing an AES-GCM component')
  }

  const decipher = createDecipheriv(
    'aes-256-gcm',
    getEncryptionKeyBuffer(encryptionKey),
    Buffer.from(ivHex, 'hex'),
    { authTagLength: 16 }
  )
  decipher.setAuthTag(Buffer.from(authTagHex, 'hex'))
  let decrypted = decipher.update(encrypted, 'hex', 'utf8')
  decrypted += decipher.final('utf8')
  return decrypted
}

function assertCryptoRoundTrip(encryptionKey: string): void {
  const sample = 'slack-custom-bot-migration-self-test'
  const roundTrip = decryptSecret(encryptSecret(sample, encryptionKey), encryptionKey)
  if (roundTrip !== sample) {
    throw new Error('Crypto self-test failed; refusing to run migration')
  }
}

function isEnvVariableReference(value: string): boolean {
  return ENV_VAR_PATTERN.test(value)
}

function envVariableName(value: string): string {
  const match = ENV_VAR_PATTERN.exec(value)
  const name = match?.[1]?.trim()
  if (!name) throw new Error(`Invalid environment variable reference: ${value}`)
  return name
}

class MissingEnvironmentVariableError extends Error {
  constructor(fieldName: 'botToken' | 'signingSecret', variableName: string) {
    super(`${fieldName} references missing environment variable ${variableName}`)
    this.name = 'MissingEnvironmentVariableError'
  }
}

class NonOwnerPersonalEnvironmentVariableError extends Error {
  constructor(fieldName: 'botToken' | 'signingSecret', variableName: string) {
    super(
      `${fieldName} uses non-owner personal environment variable ${variableName}; refusing to promote it to a workspace credential`
    )
    this.name = 'NonOwnerPersonalEnvironmentVariableError'
  }
}

function resolveStoredSecret(
  rawValue: string | undefined,
  source: SlackBotSource,
  lookup: EnvironmentLookup,
  fieldName: 'botToken' | 'signingSecret'
): string | undefined {
  if (!rawValue) return undefined
  if (!isEnvVariableReference(rawValue)) return rawValue.trim()

  const variableName = envVariableName(rawValue)
  const workspaceValue = lookup.workspaceVariables[variableName]
  if (workspaceValue) return decryptSecret(workspaceValue, lookup.encryptionKey).trim()

  const personalValue = lookup.personalVariablesByUserId.get(source.workflowUserId)?.[variableName]
  if (!personalValue) {
    throw new MissingEnvironmentVariableError(fieldName, variableName)
  }
  if (source.workflowUserId !== lookup.workspaceOwnerId) {
    throw new NonOwnerPersonalEnvironmentVariableError(fieldName, variableName)
  }
  return decryptSecret(personalValue, lookup.encryptionKey).trim()
}

export function resolveSlackSourceSecrets(
  source: SlackBotSource,
  lookup: EnvironmentLookup
): SlackSourceSecretResolution {
  try {
    const botToken = resolveStoredSecret(source.rawBotToken, source, lookup, 'botToken')
    if (!botToken) {
      return { status: 'unresolved', reason: `Source ${source.sourceId} has no bot token` }
    }

    const signingSecret = resolveStoredSecret(
      source.rawSigningSecret,
      source,
      lookup,
      'signingSecret'
    )
    if (source.kind === 'trigger' && !signingSecret) {
      return {
        status: 'unresolved',
        reason: `Trigger source ${source.sourceId} has no signing secret`,
      }
    }

    return { status: 'ready', botToken, signingSecret }
  } catch (error) {
    if (
      error instanceof MissingEnvironmentVariableError ||
      error instanceof NonOwnerPersonalEnvironmentVariableError
    ) {
      return { status: 'unresolved', reason: error.message }
    }
    throw error
  }
}

function readExistingMigrationCredential(
  credentialId: string,
  encryptedValue: string,
  encryptionKey: string
): StoredMigrationCredential | null {
  const parsed: unknown = JSON.parse(decryptSecret(encryptedValue, encryptionKey))
  if (!isRecordLike(parsed) || !isRecordLike(parsed.metadata)) return null
  const workflowId = nonEmptyString(parsed.metadata.migrationWorkflowId)
  const legacySourceId = nonEmptyString(parsed.metadata.migrationSourceId)
  if (!workflowId && !legacySourceId) return null

  const resolvedWorkflowId = workflowId ?? legacySourceId?.split(':')[0]
  if (!resolvedWorkflowId) {
    throw new Error(`Slack credential ${credentialId} has invalid migration metadata`)
  }

  const botToken = nonEmptyString(parsed.botToken)
  if (!botToken) throw new Error(`Slack credential ${credentialId} has no bot token`)
  const signingSecret = nonEmptyString(parsed.signingSecret)

  return {
    credentialId,
    workflowId: resolvedWorkflowId,
    botToken,
    signingSecret,
    hasSigningSecret: Boolean(signingSecret),
  }
}

async function loadEnvironmentLookup(
  db: MigrationDb,
  workspaceId: string,
  workspaceOwnerId: string,
  sources: SlackBotSource[],
  encryptionKey: string
): Promise<EnvironmentLookup> {
  const needsEnvironmentLookup = sources.some(
    (source) =>
      (source.rawBotToken && isEnvVariableReference(source.rawBotToken)) ||
      (source.rawSigningSecret && isEnvVariableReference(source.rawSigningSecret))
  )
  if (!needsEnvironmentLookup) {
    return {
      workspaceVariables: {},
      personalVariablesByUserId: new Map(),
      workspaceOwnerId,
      encryptionKey,
    }
  }

  const userIds = [...new Set(sources.map((source) => source.workflowUserId))]
  const workspaceRows = await db
    .select({
      variables: sql<unknown>`case when octet_length(${workspaceEnvironment.variables}::text) <= ${MAX_ENVIRONMENT_BYTES} then ${workspaceEnvironment.variables} else null end`,
      variablesBytes: sql<number>`octet_length(${workspaceEnvironment.variables}::text)`,
    })
    .from(workspaceEnvironment)
    .where(eq(workspaceEnvironment.workspaceId, workspaceId))
    .limit(1)

  if ((workspaceRows[0]?.variablesBytes ?? 0) > MAX_ENVIRONMENT_BYTES) {
    throw new Error(
      `Workspace environment exceeds the ${MAX_ENVIRONMENT_BYTES}-byte migration limit`
    )
  }

  const personalRows: { userId: string; variables: unknown; variablesBytes: number }[] = []
  let personalEnvironmentBytes = 0
  for (const userIdChunk of chunkArray(userIds, ENVIRONMENT_USER_QUERY_CHUNK_SIZE)) {
    const remainingEnvironmentBytes =
      MAX_PERSONAL_ENVIRONMENT_BYTES_PER_WORKSPACE - personalEnvironmentBytes
    const rows = await db
      .select({
        userId: environment.userId,
        variables: sql<unknown>`case when octet_length(${environment.variables}::text) <= ${MAX_ENVIRONMENT_BYTES} and sum(coalesce(octet_length(${environment.variables}::text), 0)) over () <= ${remainingEnvironmentBytes} then ${environment.variables} else null end`,
        variablesBytes: sql<number>`octet_length(${environment.variables}::text)`,
        chunkVariablesBytes: sql<number>`sum(coalesce(octet_length(${environment.variables}::text), 0)) over ()`,
      })
      .from(environment)
      .where(inArray(environment.userId, userIdChunk))
      .limit(userIdChunk.length)
    const chunkVariablesBytes = Number(rows[0]?.chunkVariablesBytes ?? 0)
    if (chunkVariablesBytes > remainingEnvironmentBytes) {
      throw new Error(
        `Personal environments exceed the ${MAX_PERSONAL_ENVIRONMENT_BYTES_PER_WORKSPACE}-byte workspace migration limit`
      )
    }
    personalEnvironmentBytes += chunkVariablesBytes
    personalRows.push(...rows)
  }

  const workspaceVariables = isRecordLike(workspaceRows[0]?.variables)
    ? (workspaceRows[0].variables as Record<string, string>)
    : {}
  const personalVariablesByUserId = new Map<string, Record<string, string>>()
  for (const row of personalRows) {
    if (row.variablesBytes > MAX_ENVIRONMENT_BYTES) {
      throw new Error(
        `Personal environment for user ${row.userId} exceeds the ${MAX_ENVIRONMENT_BYTES}-byte migration limit`
      )
    }
    if (!isRecordLike(row.variables)) {
      throw new Error(`Personal environment for user ${row.userId} must be an object`)
    }
    personalVariablesByUserId.set(row.userId, row.variables as Record<string, string>)
  }

  return {
    workspaceVariables,
    personalVariablesByUserId,
    workspaceOwnerId,
    encryptionKey,
  }
}

export function planLegacySlackTriggerLink(
  source: SlackBotSource,
  credential: ExistingMigrationCredential,
  webhookRows: LegacySlackWebhookRow[]
): { updateTriggerBlock: boolean; webhookIdsToUpdate: string[] } {
  if (source.kind !== 'trigger') {
    return { updateTriggerBlock: false, webhookIdsToUpdate: [] }
  }
  if (!credential.hasSigningSecret) {
    throw new Error(
      `Existing credential for trigger source ${source.sourceId} has no signing secret`
    )
  }
  if (
    source.existingBotCredentialId &&
    source.existingBotCredentialId !== credential.credentialId
  ) {
    throw new Error(
      `Trigger source ${source.sourceId} is already linked to a different Slack bot credential`
    )
  }

  const webhookIdsToUpdate: string[] = []
  for (const row of webhookRows) {
    if (!isRecordLike(row.providerConfig)) {
      throw new Error(`Legacy Slack webhook ${row.id} providerConfig must be an object`)
    }
    const persistedTriggerId = row.providerConfig.triggerId
    if (
      persistedTriggerId !== undefined &&
      persistedTriggerId !== null &&
      persistedTriggerId !== 'slack_webhook'
    ) {
      throw new Error(`Legacy Slack webhook ${row.id} does not use trigger slack_webhook`)
    }

    const persistedCredentialId = nonEmptyString(row.providerConfig.credentialId)
    const persistedBotCredential = nonEmptyString(row.providerConfig.botCredential)
    const persistedIngressMode = nonEmptyString(row.providerConfig.ingressMode)
    if (row.routingKey !== null && row.routingKey !== credential.credentialId) {
      throw new Error(`Legacy Slack webhook ${row.id} already has a different routing key`)
    }
    if (persistedCredentialId && persistedCredentialId !== credential.credentialId) {
      throw new Error(`Legacy Slack webhook ${row.id} already has a different credentialId`)
    }
    if (persistedBotCredential && persistedBotCredential !== credential.credentialId) {
      throw new Error(`Legacy Slack webhook ${row.id} already has a different botCredential`)
    }
    if (persistedIngressMode && persistedIngressMode !== LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE) {
      throw new Error(`Legacy Slack webhook ${row.id} already has a different ingress mode`)
    }

    const alreadyMarked =
      persistedTriggerId === 'slack_webhook' &&
      row.routingKey === credential.credentialId &&
      persistedCredentialId === credential.credentialId &&
      persistedBotCredential === credential.credentialId &&
      persistedIngressMode === LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE
    if (!alreadyMarked) webhookIdsToUpdate.push(row.id)
  }

  return {
    updateTriggerBlock: source.existingBotCredentialId !== credential.credentialId,
    webhookIdsToUpdate,
  }
}

async function prepareWorkspaceCredentials(params: {
  db: MigrationDb
  workspaceId: string
  workspaceOwnerId: string
  sources: SlackBotSource[]
  encryptionKey: string
  takenNames: Set<string>
  existingCredentialsByGroupKey: Map<string, StoredMigrationCredential>
  webhookRowsBySourceId: Map<string, LegacySlackWebhookRow[]>
  stats: MigrationStats
}): Promise<PreparedCredential[]> {
  const environmentLookup = await retryTransientDatabaseRead(
    () =>
      loadEnvironmentLookup(
        params.db,
        params.workspaceId,
        params.workspaceOwnerId,
        params.sources,
        params.encryptionKey
      ),
    { operation: 'load workspace environments', workspaceId: params.workspaceId }
  )
  const resolvedSources: ResolvedSlackBotSource[] = []

  for (const source of params.sources) {
    const resolution = resolveSlackSourceSecrets(source, environmentLookup)
    if (resolution.status === 'unresolved') {
      params.stats.skippedUnresolved++
      logger.warn('Skipping Slack bot credential source with unresolved secrets', {
        workspaceId: params.workspaceId,
        workflowId: source.workflowId,
        workflowName: source.workflowName,
        blockId: source.blockId,
        blockName: source.blockName,
        sourceKind: source.kind,
        reason: resolution.reason,
      })
      continue
    }

    resolvedSources.push({
      source,
      botToken: resolution.botToken,
      signingSecret: resolution.signingSecret,
    })
  }

  const prepared: PreparedCredential[] = []

  for (const group of groupSlackSourcesByWorkflowCredentials(resolvedSources)) {
    const groupKey = slackCredentialGroupKey(group.workflowId, group.botToken, group.signingSecret)
    const existingCredential = params.existingCredentialsByGroupKey.get(groupKey)
    const credentialId = existingCredential?.credentialId ?? generateId()
    const credential = {
      credentialId,
      hasSigningSecret: Boolean(group.signingSecret),
    }
    const sourceLinks = group.sources.map((source): PreparedSourceLink => {
      const legacyWebhookRows = params.webhookRowsBySourceId.get(source.sourceId) ?? []
      const link = planLegacySlackTriggerLink(source, credential, legacyWebhookRows)
      return {
        source,
        updateTriggerBlock: link.updateTriggerBlock,
        legacyWebhookCount: legacyWebhookRows.length,
        webhookIdsToUpdate: link.webhookIdsToUpdate,
      }
    })

    if (existingCredential) {
      params.stats.skippedExisting++
      if (
        sourceLinks.some((link) => link.updateTriggerBlock || link.webhookIdsToUpdate.length > 0)
      ) {
        prepared.push({
          workflowId: group.workflowId,
          workflowName: group.workflowName,
          sources: group.sources,
          sourceLinks,
          credentialId: existingCredential.credentialId,
          insertCredential: false,
        })
      }
      continue
    }

    const displayName = buildSlackBotDisplayName(group.workflowName, params.takenNames)
    params.takenNames.add(displayName.toLowerCase())
    if (!group.signingSecret) params.stats.actionOnly++

    prepared.push({
      workflowId: group.workflowId,
      workflowName: group.workflowName,
      sources: group.sources,
      sourceLinks,
      credentialId,
      insertCredential: true,
      displayName,
      description: buildSlackBotDescription(group.workflowName, group.sources),
      botToken: group.botToken,
      signingSecret: group.signingSecret,
    })
  }

  return prepared
}

async function applyPreparedCredential(params: {
  db: MigrationDb
  workspaceId: string
  workspaceOwnerId: string
  memberUserIds: string[]
  encryptionKey: string
  prepared: PreparedCredential
}): Promise<{ triggersLinked: number; webhooksMarked: number }> {
  const now = new Date()
  const { credentialId } = params.prepared
  const encryptedServiceAccountKey = params.prepared.insertCredential
    ? (() => {
        if (!params.prepared.botToken) {
          throw new Error(`Prepared workflow ${params.prepared.workflowId} has no bot token`)
        }
        return encryptSecret(
          JSON.stringify(
            buildSlackCustomBotSecretBlob(
              params.prepared.workflowId,
              params.prepared.botToken,
              params.prepared.signingSecret
            )
          ),
          params.encryptionKey
        )
      })()
    : null

  await params.db.transaction(async (tx) => {
    await tx.execute(
      sql`select set_config('lock_timeout', ${`${TRANSACTION_LOCK_TIMEOUT_MS}ms`}, true), set_config('statement_timeout', ${`${TRANSACTION_STATEMENT_TIMEOUT_MS}ms`}, true)`
    )
    if (params.prepared.insertCredential) {
      if (
        !params.prepared.displayName ||
        !params.prepared.description ||
        !encryptedServiceAccountKey
      ) {
        throw new Error(`Prepared workflow ${params.prepared.workflowId} is incomplete`)
      }
      await tx.insert(credential).values({
        id: credentialId,
        workspaceId: params.workspaceId,
        type: 'service_account',
        displayName: params.prepared.displayName,
        description: params.prepared.description,
        providerId: SLACK_CUSTOM_BOT_PROVIDER_ID,
        encryptedServiceAccountKey,
        createdBy: params.workspaceOwnerId,
        createdAt: now,
        updatedAt: now,
      })

      const memberships = params.memberUserIds.map((userId) => ({
        id: generateId(),
        credentialId,
        userId,
        role: userId === params.workspaceOwnerId ? ('admin' as const) : ('member' as const),
        status: 'active' as const,
        joinedAt: now,
        invitedBy: params.workspaceOwnerId,
        createdAt: now,
        updatedAt: now,
      }))
      for (const chunk of chunkArray(memberships, MEMBERSHIP_INSERT_CHUNK_SIZE)) {
        await tx.insert(credentialMember).values(chunk)
      }
    }

    const triggerLinks = params.prepared.sourceLinks.filter((link) => link.updateTriggerBlock)
    for (const triggerLinkChunk of chunkArray(triggerLinks, TRIGGER_BLOCK_UPDATE_CHUNK_SIZE)) {
      const updatedBlocks = await tx
        .update(workflowBlocks)
        .set({
          subBlocks: sql`jsonb_set(${workflowBlocks.subBlocks}, '{botCredential}', jsonb_build_object('value', ${credentialId}::text), true)`,
          updatedAt: now,
        })
        .where(
          and(
            inArray(
              workflowBlocks.id,
              triggerLinkChunk.map((link) => link.source.blockId)
            ),
            eq(workflowBlocks.workflowId, params.prepared.workflowId),
            sql`(${workflowBlocks.subBlocks}->'botCredential'->>'value' IS NULL OR ${workflowBlocks.subBlocks}->'botCredential'->>'value' = ${credentialId})`
          )
        )
        .returning({ id: workflowBlocks.id })
      if (updatedBlocks.length !== triggerLinkChunk.length) {
        throw new Error(
          `A Slack trigger in workflow ${params.prepared.workflowId} changed while the migration was running`
        )
      }
    }

    const webhookIdsToUpdate = params.prepared.sourceLinks.flatMap(
      (link) => link.webhookIdsToUpdate
    )
    for (const webhookIdChunk of chunkArray(webhookIdsToUpdate, WEBHOOK_UPDATE_CHUNK_SIZE)) {
      const updatedWebhooks = await tx
        .update(webhook)
        .set({
          routingKey: credentialId,
          providerConfig: sql`(coalesce(${webhook.providerConfig}::jsonb, '{}'::jsonb) || jsonb_build_object('triggerId', 'slack_webhook', 'botCredential', ${credentialId}::text, 'credentialId', ${credentialId}::text, 'ingressMode', ${LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE}::text))::json`,
          updatedAt: now,
        })
        .where(
          and(
            inArray(webhook.id, webhookIdChunk),
            eq(webhook.provider, 'slack'),
            isNull(webhook.archivedAt),
            sql`(${webhook.routingKey} IS NULL OR ${webhook.routingKey} = ${credentialId})`,
            sql`(${webhook.providerConfig}->>'credentialId' IS NULL OR ${webhook.providerConfig}->>'credentialId' = ${credentialId})`,
            sql`(${webhook.providerConfig}->>'botCredential' IS NULL OR ${webhook.providerConfig}->>'botCredential' = ${credentialId})`,
            sql`(${webhook.providerConfig}->>'ingressMode' IS NULL OR ${webhook.providerConfig}->>'ingressMode' = ${LEGACY_SLACK_CUSTOM_BOT_INGRESS_MODE})`,
            sql`(${webhook.providerConfig}->>'triggerId' IS NULL OR ${webhook.providerConfig}->>'triggerId' = 'slack_webhook')`
          )
        )
        .returning({ id: webhook.id })
      if (updatedWebhooks.length !== webhookIdChunk.length) {
        throw new Error(
          `A legacy Slack webhook for workflow ${params.prepared.workflowId} changed while the migration was running`
        )
      }
    }
  })

  return {
    triggersLinked: params.prepared.sourceLinks.filter((link) => link.updateTriggerBlock).length,
    webhooksMarked: params.prepared.sourceLinks.reduce(
      (count, link) => count + link.webhookIdsToUpdate.length,
      0
    ),
  }
}

async function processWorkspace(params: {
  db: MigrationDb
  workspaceId: string
  encryptionKey: string
  dryRun: boolean
  index: number
  total: number | null
}): Promise<WorkspaceResult> {
  const stats = emptyStats()
  stats.workspacesProcessed = 1

  try {
    const [
      blockRows,
      workspaceRows,
      permissionRows,
      existingCredentialRows,
      legacySlackWebhookRows,
    ] = await retryTransientDatabaseRead(
      () =>
        Promise.all([
          params.db
            .select({
              blockId: workflowBlocks.id,
              blockName: workflowBlocks.name,
              blockType: workflowBlocks.type,
              triggerMode: workflowBlocks.triggerMode,
              subBlocks: sql<unknown>`case when octet_length(${workflowBlocks.subBlocks}::text) <= ${MAX_SUBBLOCK_BYTES} and sum(octet_length(${workflowBlocks.subBlocks}::text)) over () <= ${MAX_WORKSPACE_SUBBLOCK_BYTES} then ${workflowBlocks.subBlocks} else null end`,
              subBlocksBytes: sql<number>`octet_length(${workflowBlocks.subBlocks}::text)`,
              workspaceSubBlocksBytes: sql<number>`sum(octet_length(${workflowBlocks.subBlocks}::text)) over ()`,
              workflowId: workflow.id,
              workflowName: workflow.name,
              workflowUserId: workflow.userId,
            })
            .from(workflowBlocks)
            .innerJoin(workflow, eq(workflowBlocks.workflowId, workflow.id))
            .where(
              and(
                eq(workflow.workspaceId, params.workspaceId),
                inArray(workflowBlocks.type, [...CANDIDATE_BLOCK_TYPES])
              )
            )
            .limit(MAX_BLOCKS_PER_WORKSPACE + 1),
          params.db
            .select({ ownerId: workspace.ownerId })
            .from(workspace)
            .where(eq(workspace.id, params.workspaceId))
            .limit(1),
          params.db
            .select({ userId: permissions.userId })
            .from(permissions)
            .where(
              and(
                eq(permissions.entityType, 'workspace'),
                eq(permissions.entityId, params.workspaceId)
              )
            )
            .limit(MAX_MEMBERS_PER_WORKSPACE + 1),
          params.db
            .select({
              id: credential.id,
              displayName: credential.displayName,
              encryptedServiceAccountKey: sql<
                string | null
              >`case when octet_length(${credential.encryptedServiceAccountKey}) <= ${MAX_ENCRYPTED_CREDENTIAL_BYTES} and sum(coalesce(octet_length(${credential.encryptedServiceAccountKey}), 0)) over () <= ${MAX_ENCRYPTED_CREDENTIAL_BYTES_PER_WORKSPACE} then ${credential.encryptedServiceAccountKey} else null end`,
              encryptedServiceAccountKeyBytes: sql<
                number | null
              >`octet_length(${credential.encryptedServiceAccountKey})`,
              workspaceEncryptedCredentialBytes: sql<number>`sum(coalesce(octet_length(${credential.encryptedServiceAccountKey}), 0)) over ()`,
            })
            .from(credential)
            .where(
              and(
                eq(credential.workspaceId, params.workspaceId),
                eq(credential.type, 'service_account'),
                eq(credential.providerId, SLACK_CUSTOM_BOT_PROVIDER_ID)
              )
            )
            .limit(MAX_SLACK_CREDENTIALS_PER_WORKSPACE + 1),
          params.db
            .select({
              id: webhook.id,
              workflowId: webhook.workflowId,
              blockId: webhook.blockId,
              routingKey: webhook.routingKey,
              providerConfig: sql<unknown>`case when octet_length(${webhook.providerConfig}::text) <= ${MAX_WEBHOOK_PROVIDER_CONFIG_BYTES} and sum(coalesce(octet_length(${webhook.providerConfig}::text), 0)) over () <= ${MAX_WEBHOOK_PROVIDER_CONFIG_BYTES_PER_WORKSPACE} then ${webhook.providerConfig} else null end`,
              providerConfigBytes: sql<
                number | null
              >`octet_length(${webhook.providerConfig}::text)`,
              workspaceProviderConfigBytes: sql<number>`sum(coalesce(octet_length(${webhook.providerConfig}::text), 0)) over ()`,
            })
            .from(webhook)
            .innerJoin(workflow, eq(webhook.workflowId, workflow.id))
            .where(
              and(
                eq(workflow.workspaceId, params.workspaceId),
                eq(webhook.provider, 'slack'),
                isNull(webhook.archivedAt)
              )
            )
            .limit(MAX_SLACK_WEBHOOKS_PER_WORKSPACE + 1),
        ]),
      { operation: 'load workspace migration snapshot', workspaceId: params.workspaceId }
    )

    const workspaceOwnerId = workspaceRows[0]?.ownerId
    if (!workspaceOwnerId) throw new Error(`Workspace ${params.workspaceId} has no owner`)

    if (blockRows.length > MAX_BLOCKS_PER_WORKSPACE) {
      throw new Error(
        `Workspace ${params.workspaceId} exceeds the ${MAX_BLOCKS_PER_WORKSPACE}-candidate-block migration limit`
      )
    }
    if (Number(blockRows[0]?.workspaceSubBlocksBytes ?? 0) > MAX_WORKSPACE_SUBBLOCK_BYTES) {
      throw new Error(
        `Workspace ${params.workspaceId} exceeds the ${MAX_WORKSPACE_SUBBLOCK_BYTES}-byte candidate-block migration limit`
      )
    }
    if (permissionRows.length > MAX_MEMBERS_PER_WORKSPACE) {
      throw new Error(
        `Workspace ${params.workspaceId} exceeds the ${MAX_MEMBERS_PER_WORKSPACE}-member migration limit`
      )
    }
    if (existingCredentialRows.length > MAX_SLACK_CREDENTIALS_PER_WORKSPACE) {
      throw new Error(
        `Workspace ${params.workspaceId} exceeds the ${MAX_SLACK_CREDENTIALS_PER_WORKSPACE}-Slack-credential migration limit`
      )
    }
    if (
      Number(existingCredentialRows[0]?.workspaceEncryptedCredentialBytes ?? 0) >
      MAX_ENCRYPTED_CREDENTIAL_BYTES_PER_WORKSPACE
    ) {
      throw new Error(
        `Workspace ${params.workspaceId} exceeds the ${MAX_ENCRYPTED_CREDENTIAL_BYTES_PER_WORKSPACE}-byte Slack-credential migration limit`
      )
    }
    if (legacySlackWebhookRows.length > MAX_SLACK_WEBHOOKS_PER_WORKSPACE) {
      throw new Error(
        `Workspace ${params.workspaceId} exceeds the ${MAX_SLACK_WEBHOOKS_PER_WORKSPACE}-Slack-webhook migration limit`
      )
    }
    if (
      Number(legacySlackWebhookRows[0]?.workspaceProviderConfigBytes ?? 0) >
      MAX_WEBHOOK_PROVIDER_CONFIG_BYTES_PER_WORKSPACE
    ) {
      throw new Error(
        `Workspace ${params.workspaceId} exceeds the ${MAX_WEBHOOK_PROVIDER_CONFIG_BYTES_PER_WORKSPACE}-byte Slack-webhook-config migration limit`
      )
    }

    const sources: SlackBotSource[] = []
    for (const row of blockRows) {
      if (row.subBlocksBytes > MAX_SUBBLOCK_BYTES) {
        throw new Error(
          `Workflow block ${row.blockId} exceeds the ${MAX_SUBBLOCK_BYTES}-byte subblock migration limit`
        )
      }
      const blockSources = extractSlackBotSources(row)
      if (sources.length + blockSources.length > MAX_SOURCES_PER_WORKSPACE) {
        throw new Error(
          `Workspace ${params.workspaceId} exceeds the ${MAX_SOURCES_PER_WORKSPACE}-Slack-source migration limit`
        )
      }
      sources.push(...blockSources)
    }
    stats.sourcesFound = sources.length
    if (sources.length === 0) {
      stats.workspacesSkipped = 1
      return { stats, approvedForLiveRun: false }
    }

    const existingCredentialsByGroupKey = new Map<string, StoredMigrationCredential>()
    const takenNames = new Set<string>()
    for (const row of existingCredentialRows) {
      takenNames.add(row.displayName.toLowerCase())
      if ((row.encryptedServiceAccountKeyBytes ?? 0) > MAX_ENCRYPTED_CREDENTIAL_BYTES) {
        throw new Error(
          `Slack credential "${row.displayName}" exceeds the ${MAX_ENCRYPTED_CREDENTIAL_BYTES}-byte encrypted-secret migration limit`
        )
      }
      if (!row.encryptedServiceAccountKey) {
        throw new Error(`Slack credential "${row.displayName}" has no encrypted secret`)
      }
      const existing = readExistingMigrationCredential(
        row.id,
        row.encryptedServiceAccountKey,
        params.encryptionKey
      )
      if (!existing) continue
      const groupKey = slackCredentialGroupKey(
        existing.workflowId,
        existing.botToken,
        existing.signingSecret
      )
      if (existingCredentialsByGroupKey.has(groupKey)) {
        throw new Error(
          `Multiple Slack credentials match the same credentials in workflow ${existing.workflowId}`
        )
      }
      existingCredentialsByGroupKey.set(groupKey, existing)
    }

    const webhookRowsBySourceId = new Map<string, LegacySlackWebhookRow[]>()
    for (const row of legacySlackWebhookRows) {
      if ((row.providerConfigBytes ?? 0) > MAX_WEBHOOK_PROVIDER_CONFIG_BYTES) {
        throw new Error(
          `Legacy Slack webhook ${row.id} exceeds the ${MAX_WEBHOOK_PROVIDER_CONFIG_BYTES}-byte provider-config migration limit`
        )
      }
      if (!row.blockId) continue
      const sourceId = `${row.workflowId}:${row.blockId}:trigger`
      const rows = webhookRowsBySourceId.get(sourceId) ?? []
      rows.push(row)
      webhookRowsBySourceId.set(sourceId, rows)
    }

    const prepared = await prepareWorkspaceCredentials({
      db: params.db,
      workspaceId: params.workspaceId,
      workspaceOwnerId,
      sources,
      encryptionKey: params.encryptionKey,
      takenNames,
      existingCredentialsByGroupKey,
      webhookRowsBySourceId,
      stats,
    })

    if (prepared.length === 0) {
      stats.workspacesSkipped = 1
      return { stats, approvedForLiveRun: false }
    }

    const triggersToLink = prepared.reduce(
      (count, candidate) =>
        count + candidate.sourceLinks.filter((link) => link.updateTriggerBlock).length,
      0
    )
    const undeployedTriggersToLink = prepared.reduce(
      (count, candidate) =>
        count +
        candidate.sourceLinks.filter(
          (link) => link.updateTriggerBlock && link.legacyWebhookCount === 0
        ).length,
      0
    )
    const webhooksToMark = prepared.reduce(
      (count, candidate) =>
        count +
        candidate.sourceLinks.reduce(
          (sourceCount, link) => sourceCount + link.webhookIdsToUpdate.length,
          0
        ),
      0
    )

    logger.info(
      `${params.dryRun ? '[DRY RUN] ' : ''}Workspace ${params.index}${params.total ? `/${params.total}` : ''} ready`,
      {
        workspaceId: params.workspaceId,
        sources: sources.length,
        credentialsToInsert: prepared.filter((candidate) => candidate.insertCredential).length,
        triggersToLink,
        undeployedTriggersToLink,
        webhooksToMark,
      }
    )

    if (params.dryRun) {
      for (const candidate of prepared) {
        const candidateTriggersToLink = candidate.sourceLinks.filter(
          (link) => link.updateTriggerBlock
        ).length
        const candidateWebhooksToMark = candidate.sourceLinks.reduce(
          (count, link) => count + link.webhookIdsToUpdate.length,
          0
        )
        logger.info('[DRY RUN] Would migrate Slack credential', {
          workspaceId: params.workspaceId,
          workflowId: candidate.workflowId,
          blockIds: candidate.sources.map((source) => source.blockId),
          blockNames: [...new Set(candidate.sources.map((source) => source.blockName))],
          sourceKinds: [...new Set(candidate.sources.map((source) => source.kind))],
          displayName: candidate.displayName,
          createCredential: candidate.insertCredential,
          triggersToLink: candidateTriggersToLink,
          deployedTriggersToLink: candidate.sourceLinks.filter(
            (link) => link.updateTriggerBlock && link.legacyWebhookCount > 0
          ).length,
          undeployedTriggersToLink: candidate.sourceLinks.filter(
            (link) => link.updateTriggerBlock && link.legacyWebhookCount === 0
          ).length,
          webhooksToMark: candidateWebhooksToMark,
          actionOnly: candidate.insertCredential && !candidate.signingSecret,
        })
        if (candidate.insertCredential) stats.inserted++
        stats.triggersLinked += candidateTriggersToLink
        stats.webhooksMarked += candidateWebhooksToMark
      }
      return { stats, approvedForLiveRun: true }
    }

    const memberUserIds = [
      ...new Set([workspaceOwnerId, ...permissionRows.map((row) => row.userId)]),
    ]
    for (const candidate of prepared) {
      const applied = await applyPreparedCredential({
        db: params.db,
        workspaceId: params.workspaceId,
        workspaceOwnerId,
        memberUserIds,
        encryptionKey: params.encryptionKey,
        prepared: candidate,
      })
      if (candidate.insertCredential) stats.inserted++
      stats.triggersLinked += applied.triggersLinked
      stats.webhooksMarked += applied.webhooksMarked
      logger.info('Migrated Slack credential', {
        workspaceId: params.workspaceId,
        workflowId: candidate.workflowId,
        blockIds: candidate.sources.map((source) => source.blockId),
        blockNames: [...new Set(candidate.sources.map((source) => source.blockName))],
        sourceKinds: [...new Set(candidate.sources.map((source) => source.kind))],
        displayName: candidate.displayName,
        createdCredential: candidate.insertCredential,
        triggersLinked: applied.triggersLinked,
        webhooksMarked: applied.webhooksMarked,
        actionOnly: candidate.insertCredential && !candidate.signingSecret,
      })
    }

    return { stats, approvedForLiveRun: false }
  } catch (error) {
    stats.errors++
    logger.error('Failed to process Slack bot credentials for workspace', {
      workspaceId: params.workspaceId,
      error: getErrorMessage(error),
    })
    return { stats, approvedForLiveRun: false }
  }
}

async function discoverWorkspaceIdPage(
  db: MigrationDb,
  afterWorkspaceId: string | null
): Promise<string[]> {
  return retryTransientDatabaseRead(
    async () => {
      const rows = await db
        .selectDistinct({ workspaceId: workflow.workspaceId })
        .from(workflowBlocks)
        .innerJoin(workflow, eq(workflowBlocks.workflowId, workflow.id))
        .where(
          and(
            isNotNull(workflow.workspaceId),
            inArray(workflowBlocks.type, [...CANDIDATE_BLOCK_TYPES]),
            afterWorkspaceId ? gt(workflow.workspaceId, afterWorkspaceId) : undefined
          )
        )
        .orderBy(asc(workflow.workspaceId))
        .limit(WORKSPACE_DISCOVERY_PAGE_SIZE)

      return rows.map((row) => {
        if (!row.workspaceId) throw new Error('Workspace discovery returned a null workspace ID')
        return row.workspaceId
      })
    },
    {
      operation: 'discover workspace page',
      workspaceId: afterWorkspaceId ?? undefined,
    }
  )
}

function readWorkspaceAllowlist(path: string): string[] {
  const resolvedPath = resolve(path)
  const size = statSync(resolvedPath).size
  if (size > MAX_ALLOWLIST_BYTES) {
    throw new Error(`Workspace allowlist exceeds the ${MAX_ALLOWLIST_BYTES}-byte migration limit`)
  }

  const workspaceIds = [
    ...new Set(
      readFileSync(resolvedPath, 'utf8')
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
    ),
  ]
  if (workspaceIds.length > MAX_ALLOWLIST_WORKSPACES) {
    throw new Error(
      `Workspace allowlist exceeds the ${MAX_ALLOWLIST_WORKSPACES}-workspace migration limit`
    )
  }
  return workspaceIds
}

async function processWorkspaceIds(params: {
  db: MigrationDb
  workspaceIds: string[]
  encryptionKey: string
  dryRun: boolean
  startIndex: number
  total: number | null
  stats: MigrationStats
  assertLiveRunLock?: () => Promise<void>
}): Promise<string[]> {
  const approvedWorkspaceIds: string[] = []

  for (
    let chunkStart = 0;
    chunkStart < params.workspaceIds.length;
    chunkStart += WORKSPACE_CONCURRENCY
  ) {
    await params.assertLiveRunLock?.()
    const workspaceChunk = params.workspaceIds.slice(chunkStart, chunkStart + WORKSPACE_CONCURRENCY)
    const results = await Promise.all(
      workspaceChunk.map((workspaceId, chunkIndex) =>
        processWorkspace({
          db: params.db,
          workspaceId,
          encryptionKey: params.encryptionKey,
          dryRun: params.dryRun,
          index: params.startIndex + chunkStart + chunkIndex + 1,
          total: params.total,
        })
      )
    )
    await params.assertLiveRunLock?.()
    for (const [resultIndex, result] of results.entries()) {
      mergeStats(params.stats, result.stats)
      if (result.approvedForLiveRun) approvedWorkspaceIds.push(workspaceChunk[resultIndex])
    }
    if (params.stats.errors > 0) {
      throw new Error('Aborting after a workspace failed validation or insertion')
    }
  }

  return approvedWorkspaceIds
}

async function acquireLiveRunLock(lockClient: PostgresClient): Promise<LiveRunLock> {
  const connection = await lockClient.reserve()
  try {
    const [result] = await connection<[{ locked: boolean; backendPid: number }]>`
      SELECT
        pg_try_advisory_lock(${LIVE_LOCK_NAMESPACE}, ${LIVE_LOCK_ID}) AS locked,
        pg_backend_pid() AS "backendPid"
    `
    if (!result?.locked) {
      throw new Error('Another Slack custom-bot migration live run already holds the advisory lock')
    }
    return { connection, backendPid: result.backendPid }
  } catch (error) {
    connection.release()
    throw error
  }
}

async function assertLiveRunLock(lock: LiveRunLock): Promise<void> {
  const [result] = await lock.connection<[{ locked: boolean; backendPid: number }]>`
    SELECT
      pg_backend_pid() AS "backendPid",
      EXISTS (
        SELECT 1
        FROM pg_locks
        WHERE locktype = 'advisory'
          AND pid = pg_backend_pid()
          AND classid = ${LIVE_LOCK_NAMESPACE}::oid
          AND objid = ${LIVE_LOCK_ID}::oid
          AND objsubid = 2
          AND granted
      ) AS locked
  `
  if (!result?.locked || result.backendPid !== lock.backendPid) {
    throw new Error('Slack custom-bot migration advisory lock was lost')
  }
}

async function releaseLiveRunLock(lock: LiveRunLock): Promise<void> {
  try {
    await assertLiveRunLock(lock)
    const [result] = await lock.connection<[{ unlocked: boolean }]>`
      SELECT pg_advisory_unlock(${LIVE_LOCK_NAMESPACE}, ${LIVE_LOCK_ID}) AS unlocked
    `
    if (!result?.unlocked) throw new Error('Slack custom-bot migration advisory lock was not held')
  } finally {
    lock.connection.release()
  }
}

export async function runSlackCustomBotMigration(args = process.argv.slice(2)): Promise<void> {
  const options = parseCliOptions(args)
  const connectionString = process.env.POSTGRES_URL ?? process.env.DATABASE_URL
  if (!connectionString) throw new Error('Missing POSTGRES_URL or DATABASE_URL')

  const encryptionKey = process.env.ENCRYPTION_KEY
  if (!encryptionKey || !/^[0-9a-f]{64}$/i.test(encryptionKey)) {
    throw new Error('ENCRYPTION_KEY must be a 64-character hex string')
  }
  assertCryptoRoundTrip(encryptionKey)

  const postgresClient = postgres(connectionString, {
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 30,
    max: WORKSPACE_CONCURRENCY,
    onnotice: () => {},
    connection: { application_name: 'sim-slack-custom-bot-migration' },
  })
  const db = drizzle(postgresClient)
  const lockClient = options.dryRun
    ? null
    : postgres(connectionString, {
        prepare: false,
        idle_timeout: 0,
        connect_timeout: 30,
        max: 1,
        max_lifetime: null,
        onnotice: () => {},
        connection: { application_name: 'sim-slack-custom-bot-migration-lock' },
      })
  let liveRunLock: LiveRunLock | null = null
  let dryRunPartialPath: string | null = null

  try {
    if (lockClient) {
      liveRunLock = await acquireLiveRunLock(lockClient)
    }

    logger.info('Starting Slack custom-bot migration', {
      mode: options.dryRun ? 'dry-run' : 'live',
      concurrency: WORKSPACE_CONCURRENCY,
    })

    const stats = emptyStats()
    if (options.dryRun) {
      const outputPath = resolve(OUTPUT_FILE)
      dryRunPartialPath = `${outputPath}.${process.pid}.partial`
      writeFileSync(outputPath, '')
      writeFileSync(dryRunPartialPath, '')

      let afterWorkspaceId: string | null = null
      let discoveredWorkspaces = 0
      let approvedWorkspaces = 0
      while (true) {
        const workspaceIds = await discoverWorkspaceIdPage(db, afterWorkspaceId)
        if (workspaceIds.length === 0) break

        discoveredWorkspaces += workspaceIds.length
        if (discoveredWorkspaces > MAX_ALLOWLIST_WORKSPACES) {
          throw new Error(
            `Dry-run discovery exceeds the ${MAX_ALLOWLIST_WORKSPACES}-workspace migration limit`
          )
        }

        const approvedWorkspaceIds = await processWorkspaceIds({
          db,
          workspaceIds,
          encryptionKey,
          dryRun: true,
          startIndex: discoveredWorkspaces - workspaceIds.length,
          total: null,
          stats,
        })
        if (approvedWorkspaceIds.length > 0) {
          appendFileSync(dryRunPartialPath, `${approvedWorkspaceIds.join('\n')}\n`)
          if (statSync(dryRunPartialPath).size > MAX_ALLOWLIST_BYTES) {
            throw new Error(
              `Dry-run workspace allowlist exceeds the ${MAX_ALLOWLIST_BYTES}-byte migration limit`
            )
          }
          approvedWorkspaces += approvedWorkspaceIds.length
        }

        afterWorkspaceId = workspaceIds.at(-1) ?? null
        if (workspaceIds.length < WORKSPACE_DISCOVERY_PAGE_SIZE) break
      }

      if (discoveredWorkspaces === 0) throw new Error('No candidate workspaces found to process')
      renameSync(dryRunPartialPath, outputPath)
      dryRunPartialPath = null
      logger.info('Dry-run workspace allowlist written', {
        outputPath,
        discoveredWorkspaces,
        approvedWorkspaces,
      })
    } else {
      if (!options.fromFile) throw new Error('Live run is missing its workspace allowlist path')
      const workspaceIds = readWorkspaceAllowlist(options.fromFile)
      if (workspaceIds.length === 0) throw new Error('No workspace IDs found to process')
      const activeLiveRunLock = liveRunLock
      if (!activeLiveRunLock) throw new Error('Slack custom-bot migration lock was not acquired')

      logger.info('Loaded live-run workspace allowlist', { workspaces: workspaceIds.length })
      await processWorkspaceIds({
        db,
        workspaceIds,
        encryptionKey,
        dryRun: false,
        startIndex: 0,
        total: workspaceIds.length,
        stats,
        assertLiveRunLock: () => assertLiveRunLock(activeLiveRunLock),
      })
    }

    logger.info('Slack custom-bot migration finished', stats)
    if (stats.errors > 0) {
      throw new Error(`Migration completed with ${stats.errors} workspace error(s)`)
    }
  } finally {
    try {
      if (liveRunLock) await releaseLiveRunLock(liveRunLock)
    } finally {
      await Promise.all([
        lockClient?.end({ timeout: 5 }) ?? Promise.resolve(),
        postgresClient.end({ timeout: 5 }),
      ])
      if (dryRunPartialPath && existsSync(dryRunPartialPath)) unlinkSync(dryRunPartialPath)
    }
  }
}

if ((import.meta as { main?: boolean }).main) {
  try {
    await runSlackCustomBotMigration()
  } catch (error) {
    logger.error('Slack custom-bot migration aborted', { error: getErrorMessage(error) })
    process.exitCode = 1
  }
}
