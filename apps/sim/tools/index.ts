import { createLogger } from '@sim/logger'
import { isLoopbackIp, unwrapIpv6Brackets } from '@sim/security/ssrf'
import { describeError, findCause, getErrorMessage, toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { isPlainRecord, isRecordLike } from '@sim/utils/object'
import { backoffWithJitter, parseRetryAfter } from '@sim/utils/retry'
import { DrizzleQueryError } from 'drizzle-orm/errors'
import { ApiClientError } from '@/lib/api/client/errors'
import { requestJson } from '@/lib/api/client/request'
import type { FunctionExecuteBody } from '@/lib/api/contracts'
import { oauthTokenPostContract } from '@/lib/api/contracts/oauth-connections'
import { getBYOKKey } from '@/lib/api-key/byok'
import type { InternalSandboxProfile } from '@/lib/auth/internal'
import {
  BILLING_ATTRIBUTION_HEADER,
  type BillingAttributionSnapshot,
  serializeBillingAttributionHeader,
} from '@/lib/billing/core/billing-attribution'
import { isHosted } from '@/lib/core/config/env-flags'
import { isRetryableInfrastructureError } from '@/lib/core/errors/retryable-infrastructure'
import {
  createTimeoutAbortController,
  DEFAULT_EXECUTION_TIMEOUT_MS,
  getMaxExecutionTimeout,
} from '@/lib/core/execution-limits'
import { getHostedKeyRateLimiter } from '@/lib/core/rate-limiter'
import {
  secureFetchWithPinnedIP,
  validateAndPinProxyUrl,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { PlatformEvents } from '@/lib/core/telemetry'
import { HttpError } from '@/lib/core/utils/http-error'
import { generateRequestId } from '@/lib/core/utils/request'
import {
  isPayloadSizeLimitError,
  readResponseToBufferWithLimit,
} from '@/lib/core/utils/stream-limits'
import { getBaseUrl, getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { collectUserFilesById, isUserFile } from '@/lib/core/utils/user-file'
import { isSameOrigin } from '@/lib/core/utils/validation'
import { SIM_VIA_HEADER, serializeCallChain } from '@/lib/execution/call-chain'
import {
  INTERNAL_EXECUTION_DEADLINE_HEADER,
  serializeExecutionDeadlineHeader,
} from '@/lib/execution/execution-deadline-header'
import {
  addModelInputProvenanceToRequest,
  createModelInputProvenanceRequestMetadata,
  createPrivateSecretProvenanceRequestMetadata,
  markModelInputProjected,
} from '@/lib/execution/model-input-provenance'
import {
  inspectPrivateToolMetadataEnvelope,
  inspectPrivateToolMetadataResponseCapability,
  MAX_PRIVATE_TOOL_METADATA_OVERHEAD_BYTES,
  PRIVATE_SECRET_PROVENANCE_BUNDLE_V1,
  PRIVATE_SECRET_PROVENANCE_FIELD,
  PRIVATE_SECRET_PROVENANCE_HEADER,
  PRIVATE_TOOL_METADATA_REQUEST_HEADER,
  PRIVATE_TOOL_METADATA_RESPONSE_HEADER,
  type PrivateToolMetadataType,
  RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2,
  RESOLVED_SECRET_NAMES_FIELD,
  RESOLVED_SECRET_NAMES_METADATA_V1,
  RESOLVED_SECRET_PROVENANCE_FIELD,
  RESOLVED_SECRET_PROVENANCE_METADATA_V1,
} from '@/lib/execution/private-tool-metadata'
import { executeFunctionTool } from '@/lib/internal/function/execute'
import { getInternalToolOperationHandler } from '@/lib/internal/tool-operations/registry.server'
import type { InternalToolOperationContext } from '@/lib/internal/tool-operations/types'
import { hostedKeyMetrics } from '@/lib/monitoring/metrics'
import type { CredentialTokenPayload } from '@/lib/oauth/token-resolution'
import { resolveWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { markWorkspaceFileSecretProvenanceUnknown } from '@/lib/uploads/contexts/workspace/workspace-file-secret-provenance'
import { assertPermissionsAllowed } from '@/ee/access-control/utils/permission-check'
import { isCustomTool, isMcpTool } from '@/executor/constants'
import { resolveSkillContent } from '@/executor/handlers/agent/skills-resolver'
import type { ExecutionContext, UserFile } from '@/executor/types'
import { resolveEnvVarReferences } from '@/executor/utils/reference-validation'
import { projectResolvedSecretDiagnosticContent } from '@/executor/utils/resolved-secret-content-projection'
import {
  isResolvedSecretTraceProvenanceV1,
  type ResolvedSecretTraceRegistry,
} from '@/executor/utils/resolved-secret-trace-registry'
import type { ErrorInfo } from '@/tools/error-extractors'
import { extractErrorMessage, redactErrorData } from '@/tools/error-extractors'
import { HostedKeyRateLimitedError, HostedKeyUnavailableError } from '@/tools/errors'
import {
  getOwnEnumerableDataEntries,
  prepareToolRequest,
  projectToolModelInputParams,
} from '@/tools/request-transport'
import type {
  BYOKProviderId,
  ExecutableToolConfig,
  InternalToolConfig,
  ToolConfig,
  ToolDefinition,
  ToolHostingPricing,
  ToolResponse,
  ToolRetryConfig,
} from '@/tools/types'
import { isInternalToolConfig } from '@/tools/types'
import { getTool, validateRequiredParametersAfterMerge } from '@/tools/utils'
import { getToolAsync } from '@/tools/utils.server'

const logger = createLogger('Tools')
const PRIVATE_TOOL_METADATA_ERROR_MESSAGE = 'Internal tool response metadata could not be verified'
const INTERNAL_DATABASE_ERROR_MESSAGE =
  'An internal error occurred while executing the tool. Please try again.'
const PERMISSION_PREFLIGHT_MAX_ATTEMPTS = 3
const PERMISSION_PREFLIGHT_RETRY_BACKOFF = { baseMs: 25, maxMs: 100 } as const

function projectToolLogMetadata(
  metadata: Record<string, unknown>,
  registry: ResolvedSecretTraceRegistry | undefined,
  structuralFallback: Record<string, unknown>,
  structuralOnly = false
): Record<string, unknown> {
  if (structuralOnly) return { ...structuralFallback, redacted: true }
  if (!registry) return metadata

  const projection = projectResolvedSecretDiagnosticContent(metadata, registry)
  return projection.safe && isPlainRecord(projection.value)
    ? projection.value
    : { ...structuralFallback, redacted: true }
}

interface ToolPermissionPreflight {
  userId: string
  workspaceId: string
  toolId: string
  toolKind?: 'skill' | 'custom' | 'mcp'
  ctx?: ExecutionContext
  requestId: string
  signal?: AbortSignal
}

async function assertToolPermissionsWithRetry({
  requestId,
  signal,
  ...permission
}: ToolPermissionPreflight): Promise<void> {
  for (let attempt = 1; ; attempt += 1) {
    signal?.throwIfAborted()
    try {
      await assertPermissionsAllowed(permission)
      return
    } catch (error) {
      signal?.throwIfAborted()
      const isDatabaseQueryError = Boolean(
        findCause(error, (cause): cause is DrizzleQueryError => cause instanceof DrizzleQueryError)
      )
      if (
        attempt >= PERMISSION_PREFLIGHT_MAX_ATTEMPTS ||
        !isDatabaseQueryError ||
        !isRetryableInfrastructureError(error)
      ) {
        throw error
      }

      const delayMs = backoffWithJitter(attempt, null, PERMISSION_PREFLIGHT_RETRY_BACKOFF)
      logger.warn(`[${requestId}] Retrying tool permission preflight after database error`, {
        toolId: permission.toolId,
        attempt,
        maxAttempts: PERMISSION_PREFLIGHT_MAX_ATTEMPTS,
        delayMs,
        cause: describeError(error),
      })
      await sleep(delayMs)
      signal?.throwIfAborted()
    }
  }
}

/**
 * Which environment-variable reference forms a caller's `user-only` params may use.
 *
 * Split out of `copilotToolExecution` because the two questions are not the same
 * one. `explicit-and-bare` also reads a bare identifier as a variable name when a
 * variable by that name exists, which is right for a model that improvises
 * reference syntax and wrong for a caller that types the value: a real credential
 * matching the identifier pattern and colliding with a variable name would be
 * silently swapped for a different secret. A surface picks the form it can
 * defend rather than inheriting the model's.
 */
export type ToolEnvReferenceMode = 'off' | 'explicit' | 'explicit-and-bare'

interface ToolExecutionScope {
  workspaceId?: string
  workflowId?: string
  userId?: string
  executionId?: string
  callChain?: string[]
  isDeployedContext?: boolean
  enforceCredentialAccess?: boolean
  copilotToolExecution?: boolean
  envReferenceMode?: ToolEnvReferenceMode
  billingAttribution?: BillingAttributionSnapshot
}

function resolveToolScope(
  params: Record<string, unknown>,
  executionContext?: ExecutionContext
): ToolExecutionScope {
  const ctx = params._context as Record<string, unknown> | undefined
  return {
    workspaceId: (executionContext?.workspaceId ?? ctx?.workspaceId) as string | undefined,
    workflowId: (executionContext?.workflowId ?? ctx?.workflowId) as string | undefined,
    userId: (executionContext?.userId ?? ctx?.userId) as string | undefined,
    executionId: (executionContext?.executionId ?? ctx?.executionId) as string | undefined,
    callChain: (executionContext?.callChain ?? ctx?.callChain) as string[] | undefined,
    isDeployedContext: (executionContext?.isDeployedContext ?? ctx?.isDeployedContext) as
      | boolean
      | undefined,
    enforceCredentialAccess: (executionContext?.enforceCredentialAccess ??
      ctx?.enforceCredentialAccess) as boolean | undefined,
    copilotToolExecution: (executionContext?.copilotToolExecution ?? ctx?.copilotToolExecution) as
      | boolean
      | undefined,
    /**
     * Defaults to what the surface's other flag already implied, so every
     * existing caller keeps its behavior: Copilot resolves both forms, and a
     * workflow run resolves neither because the executor substitutes variables
     * before a tool ever sees them.
     */
    envReferenceMode:
      (ctx?.envReferenceMode as ToolEnvReferenceMode | undefined) ??
      ((executionContext?.copilotToolExecution ?? ctx?.copilotToolExecution)
        ? 'explicit-and-bare'
        : 'off'),
    billingAttribution: (executionContext?.metadata.billingAttribution ??
      ctx?.billingAttribution) as BillingAttributionSnapshot | undefined,
  }
}

function createInternalToolOperationContext(
  context: ExecutionContext
): InternalToolOperationContext {
  return {
    workflowId: context.workflowId,
    workspaceId: context.workspaceId,
    executionId: context.executionId,
    userId: context.userId,
    executorDelegationOrigin: context.executorDelegationOrigin,
    copilotToolExecution: context.copilotToolExecution,
    billingAttribution: context.metadata.billingAttribution,
    callChain: context.callChain,
    resolvedSecretTraceRegistry: context.resolvedSecretTraceRegistry,
    largeValueExecutionIds: context.largeValueExecutionIds,
    largeValueKeys: context.largeValueKeys,
    fileKeys: context.fileKeys,
    allowLargeValueWorkflowScope: context.allowLargeValueWorkflowScope,
  }
}

function toUserFileFromWorkspaceRecord(record: {
  id: string
  name: string
  path: string
  url?: string
  size: number
  type: string
  key: string
}): UserFile {
  return {
    id: record.id,
    name: record.name,
    url: record.url ?? record.path,
    size: record.size,
    type: record.type,
    key: record.key,
    context: 'workspace',
  }
}

/**
 * Files this execution has already produced or consumed, indexed by id.
 *
 * Seeded from prior block outputs and extended as each tool result is processed,
 * so a file an agent saw earlier in the same turn resolves even though it exists
 * in no block state and no workspace row.
 */
function getExecutionFileIndex(executionContext?: ExecutionContext): Map<string, UserFile> {
  if (!executionContext) return new Map()
  if (!executionContext.executionFilesById) {
    executionContext.executionFilesById = collectUserFilesById(
      Object.fromEntries(executionContext.blockStates ?? new Map())
    )
  }
  return executionContext.executionFilesById
}

/** Registers files a tool just produced so a later call can name them by id. */
function recordExecutionFiles(
  executionContext: ExecutionContext | undefined,
  value: unknown
): void {
  if (!executionContext) return
  const index = getExecutionFileIndex(executionContext)
  for (const [id, file] of collectUserFilesById(value)) {
    // First occurrence wins, matching collectUserFilesById, so a file echoed
    // through several results keeps one record.
    if (!index.has(id)) index.set(id, file)
  }
}

async function resolveFileReference(
  value: unknown,
  scope: ToolExecutionScope,
  paramId: string,
  executionContext?: ExecutionContext
): Promise<UserFile | unknown> {
  if (isUserFile(value)) {
    return value
  }

  const referenceId =
    typeof value === 'string'
      ? value
      : value &&
          typeof value === 'object' &&
          typeof (value as Record<string, unknown>).id === 'string'
        ? ((value as Record<string, unknown>).id as string)
        : null

  if (!referenceId) {
    return value
  }

  // Tried before the workspace lookup because an execution-scoped file — a tool
  // result from earlier in this run — has no workspace row to find.
  const executionFile = getExecutionFileIndex(executionContext).get(referenceId)
  if (executionFile) {
    return executionFile
  }

  if (!scope.workspaceId) {
    throw new Error(`Missing workspaceId while resolving file parameter "${paramId}"`)
  }

  const fileRecord = await resolveWorkspaceFileReference(scope.workspaceId, referenceId)
  if (!fileRecord) {
    throw new Error(
      `Could not resolve file reference "${referenceId}" for parameter "${paramId}". Pass a file id from an earlier tool result, or a canonical workspace file id.`
    )
  }

  const resolvedFile = toUserFileFromWorkspaceRecord(fileRecord)
  if (!value || typeof value !== 'object') {
    return resolvedFile
  }

  const candidate = value as Record<string, unknown>
  return {
    ...resolvedFile,
    context: typeof candidate.context === 'string' ? candidate.context : resolvedFile.context,
    base64: typeof candidate.base64 === 'string' ? candidate.base64 : undefined,
  }
}

/**
 * Hydrates file params supplied by reference into full file objects.
 *
 * Runs on every surface, not just Copilot: a model cannot synthesize the `key`
 * and `url` a file object carries, so by-reference is the only way any model can
 * pass one. Resolution merely selects a file — the read itself is still
 * authorized downstream, so naming an id grants nothing on its own.
 */
async function normalizeFileParams(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  scope: ToolExecutionScope,
  executionContext?: ExecutionContext
): Promise<void> {
  for (const [paramId, paramDef] of Object.entries(tool.params || {})) {
    const paramType = paramDef?.type
    const currentValue = params[paramId]
    if (currentValue === undefined || currentValue === null) {
      continue
    }

    if (paramType === 'file') {
      params[paramId] = await resolveFileReference(currentValue, scope, paramId, executionContext)
      continue
    }

    if (paramType === 'file[]') {
      const values = Array.isArray(currentValue) ? currentValue : [currentValue]
      params[paramId] = await Promise.all(
        values.map((item) => resolveFileReference(item, scope, paramId, executionContext))
      )
    }
  }
}

/**
 * Resolves whole-value {{ENV_VAR}} references in user-only params, for the
 * surfaces whose {@link ToolEnvReferenceMode} asks for it.
 *
 * Neither surface that uses it should be holding the secret. Chat agents never
 * see secret values (the workspace VFS exposes env var names only), and an API
 * caller writing a tool call into a script or a CI step would otherwise put a
 * live credential on the command line. Workflow runs resolve these in the
 * executor, and this is the equivalent step for direct tool calls, delegating
 * to the executor's resolver so every path shares one set of reference
 * semantics. Resolution is deliberately restricted to params declared
 * `visibility: 'user-only'` (API keys and other operator-supplied secrets) and
 * to values that are exactly one reference, so LLM-writable params (URLs,
 * headers, bodies) can never be used to extract secret values.
 *
 * Mutates only the given params object — callers pass the per-execution copy,
 * never the copilot-side tool-call state, so decrypted values cannot leak
 * into failure logs or persisted chat state.
 */
async function resolveToolEnvReferences(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  scope: ToolExecutionScope,
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
): Promise<void> {
  const mode = scope.envReferenceMode ?? 'off'
  if (mode === 'off') {
    return
  }

  // `{{NAME}}` is the one explicit reference form, so a missing variable is a
  // hard error. Anything else is a literal and goes upstream verbatim, which is
  // what lets a caller pass a real secret in the same field.
  //
  // Models improvise reference syntax: after `{{NAME}}`, the bare variable name
  // is the common fallback — it previously went upstream as the literal
  // credential and failed with an undiagnosable 401. So under
  // `explicit-and-bare` a bare name is a reference too, but only when a variable
  // by that exact name exists (`soft`), since plenty of real API keys match the
  // identifier pattern. `$NAME` is deliberately NOT a reference — real
  // credentials can start with `$`, and a secret must never be reinterpreted as
  // a lookup.
  const pending: Array<{ paramId: string; value: string; soft?: boolean }> = []
  for (const [paramId, paramDef] of Object.entries(tool.params || {})) {
    if (paramDef?.visibility !== 'user-only') continue
    const value = params[paramId]
    if (typeof value !== 'string') continue
    if (value.startsWith('{{') && value.endsWith('}}')) {
      pending.push({ paramId, value })
      continue
    }
    if (mode === 'explicit-and-bare' && /^[A-Za-z_][A-Za-z0-9_]*$/.test(value)) {
      pending.push({ paramId, value: `{{${value}}}`, soft: true })
    }
  }

  if (pending.length === 0) {
    return
  }

  if (!scope.userId) {
    throw new Error(
      `Cannot resolve environment variable reference in parameter "${pending[0].paramId}" without an authenticated user context.`
    )
  }

  const completePendingActivation = resolvedSecretTraceRegistry?.beginPendingActivation()
  try {
    const { getEffectiveDecryptedEnv } = await import('@/lib/environment/utils')
    const envVars = await getEffectiveDecryptedEnv(scope.userId, scope.workspaceId)

    for (const { paramId, value, soft } of pending) {
      const missingKeys: string[] = []
      const resolved = resolveEnvVarReferences(value, envVars, {
        allowEmbedded: false,
        missingKeys,
        onResolved: (name, resolvedValue) => {
          resolvedSecretTraceRegistry?.recordResolvedAtInputPath(name, resolvedValue, [paramId], {
            propagated: true,
          })
        },
      })
      if (missingKeys.length > 0) {
        // A bare name that matches no variable is treated as the literal
        // credential it probably is; only explicit reference forms error.
        if (soft) continue
        const scopeHint = scope.workspaceId
          ? ''
          : ' (no workspace context — only personal variables are available here)'
        throw new Error(
          `Environment variable "${missingKeys[0]}" referenced by parameter "${paramId}" was not found${scopeHint}. ` +
            `Check environment/variables.json for available variable names.`
        )
      }
      params[paramId] = resolved as string
      resolvedSecretTraceRegistry?.recordResolvedInputProjection(
        [paramId],
        resolved as string,
        value
      )
    }
  } finally {
    completePendingActivation?.()
  }
}

function readExplicitCredentialSelector(params: Record<string, unknown>): string | undefined {
  for (const key of ['credentialId', 'oauthCredential', 'credential'] as const) {
    const value = params[key]
    if (typeof value === 'string' && value.trim().length > 0) {
      return value.trim()
    }
  }
  return undefined
}

function normalizeCopilotCredentialParams(params: Record<string, unknown>): void {
  const credentialId = typeof params.credentialId === 'string' ? params.credentialId.trim() : ''
  if (credentialId && !params.credential && !params.oauthCredential) {
    params.credential = credentialId
  }
}

function enforceCopilotCredentialSelection(
  toolId: string,
  tool: ToolDefinition,
  params: Record<string, unknown>,
  scope: ToolExecutionScope
): void {
  if (!scope.copilotToolExecution || !tool.oauth?.required) {
    return
  }

  if (readExplicitCredentialSelector(params)) {
    return
  }

  const toolLabel = tool.name || toolId
  throw new Error(
    `Copilot must pass credentialId for ${toolLabel}. Read environment/credentials.json and pass the exact credentialId for provider "${tool.oauth.provider}".`
  )
}

/** Protects only the account secrets resolved for this Assistant call, including provider reflections. */
async function registerAssistantCredentialSecrets(
  registry: ResolvedSecretTraceRegistry | undefined,
  tokens: readonly (string | undefined)[]
): Promise<void> {
  if (typeof window !== 'undefined' || !registry) {
    throw new Error('Assistant credential use requires a trusted secret projection registry')
  }
  const { encryptSecret } = await import('@/lib/core/security/encryption')
  const secrets = [...new Set(tokens.filter((token): token is string => Boolean(token)))]
  const entries = await Promise.all(
    secrets.map(async (token) => ({ encryptedValue: (await encryptSecret(token)).encrypted }))
  )
  const imported = await registry.importProvenance(
    { version: 1, complete: true, entries },
    { trusted: true, anonymous: true, origin: 'tools.assistantCredentials' }
  )
  if (!imported || !registry.isComplete()) {
    throw new Error('Assistant account secrets could not be protected before execution')
  }
}

/** Result from hosted key injection */
interface HostedKeyInjectionResult {
  isUsingHostedKey: boolean
  envVarName?: string
}

/**
 * Inject hosted API key if tool supports it and user didn't provide one.
 * Checks BYOK workspace keys first, then uses the HostedKeyRateLimiter for round-robin key selection.
 * Returns whether a hosted (billable) key was injected and which env var it came from.
 */
async function injectHostedKeyIfNeeded(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  executionContext: ExecutionContext | undefined,
  requestId: string
): Promise<HostedKeyInjectionResult> {
  if (!tool.hosting) return { isUsingHostedKey: false }
  if (!isHosted) return { isUsingHostedKey: false }
  if (tool.hosting.enabled && !tool.hosting.enabled(params)) {
    return { isUsingHostedKey: false }
  }

  const { envKeyPrefix, apiKeyParam, byokProviderId, rateLimit } = tool.hosting
  const userProvidedKey = params[apiKeyParam]
  if (typeof userProvidedKey === 'string' && userProvidedKey.trim().length > 0) {
    return { isUsingHostedKey: false }
  }

  const { workspaceId, userId, workflowId } = resolveToolScope(params, executionContext)

  // Check BYOK workspace key first
  if (byokProviderId && workspaceId) {
    try {
      const byokResult = await getBYOKKey(workspaceId, byokProviderId as BYOKProviderId)
      if (byokResult) {
        params[apiKeyParam] = byokResult.apiKey
        logger.info(`[${requestId}] Using BYOK key for ${tool.id}`)
        return { isUsingHostedKey: false } // Don't bill - user's own key
      }
    } catch (error) {
      logger.error(`[${requestId}] Failed to get BYOK key for ${tool.id}:`, error)
      // Fall through to hosted key
    }
  }

  const rateLimiter = getHostedKeyRateLimiter()
  const provider = byokProviderId || tool.id
  const billingActorId = workspaceId

  if (!billingActorId) {
    logger.error(`[${requestId}] No workspace ID available for hosted key rate limiting`)
    return { isUsingHostedKey: false }
  }

  const acquireResult = await rateLimiter.acquireKey(
    provider,
    envKeyPrefix,
    rateLimit,
    billingActorId,
    executionContext?.abortSignal
  )

  if (!acquireResult.success && acquireResult.billingActorRateLimited) {
    logger.warn(`[${requestId}] Billing actor ${billingActorId} rate limited for ${tool.id}`, {
      provider,
      retryAfterMs: acquireResult.retryAfterMs,
    })

    PlatformEvents.hostedKeyUserThrottled({
      toolId: tool.id,
      reason: 'billing_actor_limit',
      provider,
      retryAfterMs: acquireResult.retryAfterMs ?? 0,
      userId,
      workspaceId,
      workflowId,
    })

    throw new HostedKeyRateLimitedError(
      acquireResult.error || `Rate limit exceeded for ${tool.id}`,
      acquireResult.retryAfterMs
    )
  }

  // Handle no keys configured (503)
  if (!acquireResult.success) {
    logger.error(`[${requestId}] No hosted keys configured for ${tool.id}: ${acquireResult.error}`)
    throw new HostedKeyUnavailableError(
      acquireResult.error || `No hosted keys configured for ${tool.id}`
    )
  }

  params[apiKeyParam] = acquireResult.key
  params.__usingHostedKey = true
  logger.info(`[${requestId}] Using hosted key for ${tool.id} (${acquireResult.envVarName})`, {
    keyIndex: acquireResult.keyIndex,
    provider,
  })

  return {
    isUsingHostedKey: true,
    envVarName: acquireResult.envVarName,
  }
}

/**
 * Re-acquire a hosted key after upstream-429 retries have been exhausted. Calls
 * `acquireKey` (which now blocks on the per-workspace bucket) and re-injects the
 * fresh key into `params`. Returns false if no key could be obtained — caller
 * should re-throw the original upstream 429.
 *
 * Does not consult BYOK. We only enter this path from inside the hosted-key
 * branch of `executeTool`, so BYOK has already been ruled out for this call.
 */
async function reacquireHostedKey(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  executionContext: ExecutionContext | undefined,
  requestId: string
): Promise<string | null> {
  if (!tool.hosting) return null
  const { envKeyPrefix, apiKeyParam, byokProviderId, rateLimit } = tool.hosting
  const { workspaceId } = resolveToolScope(params, executionContext)
  if (!workspaceId) return null

  const provider = byokProviderId || tool.id
  const acquireResult = await getHostedKeyRateLimiter().acquireKey(
    provider,
    envKeyPrefix,
    rateLimit,
    workspaceId,
    executionContext?.abortSignal
  )

  if (!acquireResult.success || !acquireResult.key) {
    logger.warn(
      `[${requestId}] Re-acquire of hosted key for ${tool.id} failed: ${acquireResult.error ?? 'unknown'}`
    )
    return null
  }

  params[apiKeyParam] = acquireResult.key
  logger.info(
    `[${requestId}] Re-acquired hosted key for ${tool.id} (${acquireResult.envVarName}) after upstream throttling`
  )
  return acquireResult.envVarName ?? 'unknown'
}

/**
 * Check if an error is a rate limit (throttling) or quota exhaustion error.
 * Some providers (e.g. Perplexity) return 401/403 with "insufficient_quota"
 * instead of the standard 429, so we also inspect the error message.
 */
function isRateLimitError(error: unknown): boolean {
  if (error && typeof error === 'object') {
    const status = (error as { status?: number }).status
    if (status === 429 || status === 503) return true

    if (status === 401 || status === 403) {
      const message = ((error as { message?: string }).message || '').toLowerCase()
      if (message.includes('quota') || message.includes('rate limit')) {
        return true
      }
    }
  }
  return false
}

/**
 * Map a thrown tool error to a hosted-key failure reason for metrics. Mirrors
 * `isRateLimitError`: some providers signal quota/rate-limit via 401/403 with a
 * descriptive message, so those count as `rate_limited`, not `auth`.
 */
function classifyHostedKeyFailure(error: unknown): 'rate_limited' | 'auth' | 'other' {
  const status = (error as { status?: number } | null)?.status
  if (status === 429 || status === 503) return 'rate_limited'
  if (status === 401 || status === 403) {
    const message = ((error as { message?: string } | null)?.message ?? '').toLowerCase()
    if (message.includes('quota') || message.includes('rate limit')) return 'rate_limited'
    return 'auth'
  }
  return 'other'
}

/** Context for retry with rate limit tracking */
interface RetryContext {
  requestId: string
  toolId: string
  provider: string
  envVarName: string
  executionContext?: ExecutionContext
  /**
   * Optional callback invoked after the local exponential backoff has been exhausted by
   * upstream 429s. Should re-enter the per-workspace hosted-key queue (which now blocks
   * on the bucket) and return a fresh execution thunk bound to the newly acquired key.
   * If the callback returns null, we give up and re-throw the last error.
   */
  reacquireAfterRetriesExhausted?: () => Promise<(() => Promise<unknown>) | null>
}

/**
 * Execute a function with exponential backoff retry for rate limiting errors.
 * Only used for hosted key requests. Tracks rate limit events via telemetry.
 *
 * On terminal upstream 429, optionally re-enters the hosted-key queue (which waits for
 * the per-workspace bucket to refill) and retries once with a freshly acquired key.
 * This handles the case where the upstream provider's limit is tighter than ours — we
 * re-queue the call instead of surfacing the error.
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  context: RetryContext,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  const {
    requestId,
    toolId,
    provider,
    envVarName,
    executionContext,
    reacquireAfterRetriesExhausted,
  } = context
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (!isRateLimitError(error) || attempt === maxRetries) {
        if (isRateLimitError(error) && attempt === maxRetries) {
          if (reacquireAfterRetriesExhausted) {
            try {
              const requeued = await reacquireAfterRetriesExhausted()
              if (requeued) {
                logger.warn(
                  `[${requestId}] Upstream retries exhausted for ${toolId} (${envVarName}); re-queued and retrying once with fresh key`
                )
                return (await requeued()) as T
              }
            } catch (requeueError) {
              logger.error(
                `[${requestId}] Re-queue after exhausted upstream retries failed for ${toolId}`,
                { error: toError(requeueError).message }
              )
            }
          }

          PlatformEvents.hostedKeyUserThrottled({
            toolId,
            reason: 'upstream_retries_exhausted',
            provider,
            userId: executionContext?.userId,
            workspaceId: executionContext?.workspaceId,
            workflowId: executionContext?.workflowId,
          })
        }
        throw error
      }

      const delayMs = backoffWithJitter(attempt + 1, null, { baseMs: baseDelayMs })

      // Track throttling event via telemetry
      PlatformEvents.hostedKeyRateLimited({
        toolId,
        envVarName,
        attempt: attempt + 1,
        maxRetries,
        delayMs,
        userId: executionContext?.userId,
        workspaceId: executionContext?.workspaceId,
        workflowId: executionContext?.workflowId,
      })

      logger.warn(
        `[${requestId}] Rate limited for ${toolId} (${envVarName}), retrying in ${delayMs}ms (attempt ${attempt + 1}/${maxRetries})`
      )
      await sleep(delayMs)
    }
  }

  throw lastError
}

/** Result from cost calculation */
interface ToolCostResult {
  cost: number
  metadata?: Record<string, unknown>
}

/**
 * Rejects a cost that cannot be billed. `NaN` would silently vanish from every
 * downstream sum and `Infinity` would poison the ledger, so a pricing bug must
 * surface as a metering failure instead of a corrupt charge.
 */
function assertBillableCost(cost: unknown, toolId: string): number {
  if (typeof cost !== 'number' || !Number.isFinite(cost) || cost < 0) {
    throw new Error(`Hosted-key pricing for ${toolId} produced an unusable cost: ${String(cost)}`)
  }
  return cost
}

/**
 * Calculate cost based on pricing model
 */
function calculateToolCost(
  pricing: ToolHostingPricing,
  params: Record<string, unknown>,
  response: Record<string, unknown>,
  toolId: string
): ToolCostResult {
  switch (pricing.type) {
    case 'per_request':
      return { cost: assertBillableCost(pricing.cost, toolId) }

    case 'custom': {
      const result = pricing.getCost(params, response)
      if (typeof result === 'number') {
        return { cost: assertBillableCost(result, toolId) }
      }
      return { ...result, cost: assertBillableCost(result.cost, toolId) }
    }

    default: {
      const exhaustiveCheck: never = pricing
      throw new Error(`Unknown pricing type: ${(exhaustiveCheck as ToolHostingPricing).type}`)
    }
  }
}

interface HostedKeyCostResult {
  cost: number
  metadata?: Record<string, unknown>
}

/**
 * Calculate hosted-key cost for a tool execution.
 *
 * Returns the cost and its metadata for the caller to attach to the tool
 * output. It does NOT write a usage-ledger row: the only `usageLog` insert is
 * `recordUsage` in `lib/billing/core/usage-log.ts`, which nothing on this path
 * calls. Cost reaches the ledger only through the `_serviceCost` field
 * `applyHostedKeyCostToResult` emits under `copilotToolExecution`, so any new
 * caller of `executeTool` that is not Copilot must arrange its own metering.
 */
async function processHostedKeyCost(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  response: Record<string, unknown>,
  executionContext: ExecutionContext | undefined,
  requestId: string
): Promise<HostedKeyCostResult> {
  if (!tool.hosting?.pricing) {
    return { cost: 0 }
  }

  const { cost, metadata } = calculateToolCost(tool.hosting.pricing, params, response, tool.id)

  if (cost <= 0) return { cost: 0 }

  logger.debug(
    `[${requestId}] Hosted key cost for ${tool.id}: $${cost}`,
    metadata ? { metadata } : {}
  )

  return { cost, metadata }
}

/**
 * Report custom dimension usage after successful hosted-key tool execution.
 * Only applies to tools with `custom` rate limit mode. Fires and logs;
 * failures here do not block the response since execution already succeeded.
 */
async function reportCustomDimensionUsage(
  tool: ToolDefinition,
  params: Record<string, unknown>,
  response: Record<string, unknown>,
  executionContext: ExecutionContext | undefined,
  requestId: string
): Promise<void> {
  if (tool.hosting?.rateLimit.mode !== 'custom') return
  const { workspaceId: billingActorId } = resolveToolScope(params, executionContext)
  if (!billingActorId) return

  const rateLimiter = getHostedKeyRateLimiter()
  const provider = tool.hosting.byokProviderId || tool.id

  try {
    const result = await rateLimiter.reportUsage(
      provider,
      billingActorId,
      tool.hosting.rateLimit,
      params,
      response
    )

    for (const dim of result.dimensions) {
      if (!dim.allowed) {
        logger.warn(`[${requestId}] Dimension ${dim.name} overdrawn after ${tool.id} execution`, {
          consumed: dim.consumed,
          tokensRemaining: dim.tokensRemaining,
        })
      }
    }
  } catch (error) {
    logger.error(`[${requestId}] Failed to report custom dimension usage for ${tool.id}:`, error)
  }
}

/**
 * Strips internal fields (keys starting with `__`) from tool output before
 * returning to users. The double-underscore prefix is reserved for transient
 * data (e.g. `__costDollars`) and will never collide with legitimate API
 * fields like `_id`.
 */
function stripInternalFields(output: Record<string, unknown>): Record<string, unknown> {
  if (typeof output !== 'object' || output === null || Array.isArray(output)) {
    return output
  }
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(output)) {
    if (!key.startsWith('__')) {
      result[key] = value
    }
  }
  return result
}

export function postProcessToolOutput(toolId: string, output: Record<string, unknown>) {
  return isCustomTool(toolId) ? output : stripInternalFields(output)
}

/**
 * Apply post-execution hosted-key cost tracking to a successful tool result.
 * Reports custom dimension usage, calculates cost, and merges it into the output.
 *
 * Billing capture differs by caller:
 * - Workflow executions bill `output.cost.total` through trace spans and the
 *   execution ledger (`recordUsage`), so the `cost` field alone suffices.
 * - Copilot tool executions have no execution ledger. Their only billing hook
 *   is Go's `extractServiceCost`, which reads a top-level `_serviceCost` field
 *   from the tool result and charges it through the per-round update-cost
 *   callback (the same path the media tools use). Without it, hosted-key spend
 *   from copilot-dispatched integration tools is never charged.
 */
async function applyHostedKeyCostToResult(
  finalResult: ToolResponse,
  tool: ToolDefinition,
  params: Record<string, unknown>,
  executionContext: ExecutionContext | undefined,
  requestId: string,
  envVarName: string | undefined
): Promise<void> {
  await reportCustomDimensionUsage(tool, params, finalResult.output, executionContext, requestId)

  const provider = tool.hosting?.byokProviderId || tool.id
  const key = envVarName ?? 'unknown'

  let hostedKeyCost = 0
  let metadata: Record<string, unknown> | undefined

  try {
    ;({ cost: hostedKeyCost, metadata } = await processHostedKeyCost(
      tool,
      params,
      finalResult.output,
      executionContext,
      requestId
    ))
  } catch (error) {
    // The provider already ran and already charged Sim's key. Failing the
    // execution here would destroy the caller's result without recovering the
    // spend, so the run stands and the gap is raised for reconciliation.
    logger.error(
      `[${requestId}] Hosted-key metering failed for ${tool.id}; execution succeeded unbilled`,
      { provider, error: getErrorMessage(error) }
    )
    hostedKeyMetrics.recordFailed({ provider, tool: tool.id, key, reason: 'metering' })
  }

  hostedKeyMetrics.recordUsed({ provider, tool: tool.id, key })
  hostedKeyMetrics.recordCostCharged(hostedKeyCost, { provider, tool: tool.id })

  if (hostedKeyCost > 0) {
    const { copilotToolExecution } = resolveToolScope(params, executionContext)
    finalResult.output = {
      ...finalResult.output,
      cost: {
        ...metadata,
        total: hostedKeyCost,
      },
      // Copilot-only: workflow runs must not emit _serviceCost or the cost
      // would be billed twice (execution ledger + Go service charge).
      ...(copilotToolExecution ? { _serviceCost: { service: provider, cost: hostedKeyCost } } : {}),
    }
  }
}

import { normalizeToolId } from '@/tools/normalize'

/**
 * Maximum request body size in bytes before we warn/error about size limits.
 * Next.js 16 has a default middleware/proxy body limit of 10MB.
 */
const MAX_REQUEST_BODY_SIZE_BYTES = 10 * 1024 * 1024 // 10MB
const MAX_TOOL_RESPONSE_BODY_BYTES = 10 * 1024 * 1024 // 10MB

/**
 * User-friendly error message for body size limit exceeded
 */
const BODY_SIZE_LIMIT_ERROR_MESSAGE =
  'Request body size limit exceeded (10MB). The workflow data is too large to process. Try reducing the size of variables, inputs, or data being passed between blocks.'

const RESPONSE_SIZE_LIMIT_ERROR_MESSAGE =
  'Tool response size limit exceeded (10MB). The response is too large to keep in workflow data. Reduce the response size or return a file reference instead.'
const SAME_ORIGIN_EXTERNAL_TOOL_ERROR_MESSAGE =
  'External integration tools cannot target this Sim instance; use an internal operation'

/**
 * Validates request body size and throws a user-friendly error if exceeded
 * @param body - The request body string to check
 * @param requestId - Request ID for logging
 * @param context - Context string for logging (e.g., toolId)
 * @throws Error if body size exceeds the limit
 */
function validateRequestBodySize(
  body: string | undefined,
  requestId: string,
  context: string
): void {
  if (!body) return

  const bodySize = Buffer.byteLength(body, 'utf8')
  if (bodySize > MAX_REQUEST_BODY_SIZE_BYTES) {
    const bodySizeMB = (bodySize / (1024 * 1024)).toFixed(2)
    const maxSizeMB = (MAX_REQUEST_BODY_SIZE_BYTES / (1024 * 1024)).toFixed(0)
    logger.error(`[${requestId}] Request body size exceeds limit for ${context}:`, {
      bodySize,
      bodySizeMB: `${bodySizeMB}MB`,
      maxSize: MAX_REQUEST_BODY_SIZE_BYTES,
      maxSizeMB: `${maxSizeMB}MB`,
    })
    throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
  }
}

/**
 * Checks if an error message indicates a body size limit issue
 * @param errorMessage - The error message to check
 * @returns true if the error is related to body size limits
 */
function isBodySizeLimitError(errorMessage: string): boolean {
  const lowerMessage = errorMessage.toLowerCase()
  return (
    lowerMessage.includes('body size') ||
    lowerMessage.includes('payload too large') ||
    lowerMessage.includes('entity too large') ||
    lowerMessage.includes('request entity too large') ||
    lowerMessage.includes('body_not_allowed') ||
    lowerMessage.includes('request body larger than')
  )
}

/**
 * Handles body size limit errors by logging and throwing a user-friendly error
 * @param error - The original error
 * @param requestId - Request ID for logging
 * @param context - Context string for logging (e.g., toolId)
 * @throws Error with user-friendly message if it's a size limit error
 * @returns false if not a size limit error (caller should continue handling)
 */
function handleBodySizeLimitError(
  error: unknown,
  requestId: string,
  context: string,
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry,
  structuralOnlyWithoutRegistry = false
): boolean {
  const errorMessage = toError(error).message

  if (isBodySizeLimitError(errorMessage)) {
    logger.error(
      `[${requestId}] Request body size limit exceeded for ${context}:`,
      projectToolLogMetadata(
        { originalError: errorMessage },
        resolvedSecretTraceRegistry,
        {
          hasOriginalError: errorMessage.length > 0,
        },
        structuralOnlyWithoutRegistry
      )
    )
    throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
  }

  return false
}

function handleResponseSizeLimitError(error: unknown, requestId: string, context: string): boolean {
  if (!isPayloadSizeLimitError(error)) return false

  logger.error(`[${requestId}] Response body size limit exceeded for ${context}:`, {
    label: error.label,
    maxBytes: error.maxBytes,
    observedBytes: error.observedBytes,
  })
  throw new Error(RESPONSE_SIZE_LIMIT_ERROR_MESSAGE)
}

function cloneResponseHeaders(headers: Headers | HeadersInit | undefined): Headers {
  const clonedHeaders = new Headers()
  if (!headers) return clonedHeaders

  if (typeof (headers as Headers).forEach === 'function') {
    ;(headers as Headers).forEach((value, key) => {
      clonedHeaders.set(key, value)
    })
    return clonedHeaders
  }

  return new Headers(headers)
}

async function readToolResponseBody(
  response: {
    ok?: boolean
    headers?: { get(name: string): string | null }
    body?: ReadableStream<Uint8Array> | null
    arrayBuffer?: () => Promise<ArrayBuffer>
    text?: () => Promise<string>
  },
  options: {
    requestId: string
    toolId: string
    signal?: AbortSignal
    maxBytes?: number
  }
): Promise<Buffer> {
  try {
    return await readResponseToBufferWithLimit(response, {
      maxBytes: options.maxBytes ?? MAX_TOOL_RESPONSE_BODY_BYTES,
      label: `${options.toolId} response body`,
      signal: options.signal,
      allowNoBodyFallback: true,
    })
  } catch (error) {
    if (isPayloadSizeLimitError(error) || response.ok !== false) {
      throw error
    }

    logger.warn(
      `[${options.requestId}] Failed to read non-OK response body for ${options.toolId}`,
      {
        errorName: toError(error).name,
      }
    )
    return Buffer.alloc(0)
  }
}

/**
 * Create an Error instance from errorInfo and attach useful context
 * Uses the error extractor registry to find the best error message
 */
function createTransformedErrorFromErrorInfo(errorInfo?: ErrorInfo, extractorId?: string): Error {
  const message = extractErrorMessage(errorInfo, extractorId)
  const transformed = new Error(message)
  Object.assign(transformed, {
    status: errorInfo?.status,
    statusText: errorInfo?.statusText,
    data: redactErrorData(errorInfo, extractorId),
  })
  return transformed
}

/**
 * Process file outputs for a tool result if execution context is available
 * Uses dynamic imports to avoid client-side bundling issues
 */
async function processFileOutputs(
  result: ToolResponse,
  tool: ToolDefinition,
  executionContext?: ExecutionContext
): Promise<ToolResponse> {
  // Skip file processing if no execution context or not successful
  if (!executionContext || !result.success) {
    return result
  }

  // Skip file processing on client-side (no Node.js modules available)
  if (typeof window !== 'undefined') {
    return result
  }

  try {
    // Dynamic import to avoid client-side bundling issues
    const { FileToolProcessor } = await import('@/executor/utils/file-tool-processor')

    // Check if tool has file outputs
    if (!FileToolProcessor.hasFileOutputs(tool)) {
      return result
    }

    const processedOutput = await FileToolProcessor.processToolOutputs(
      result.output,
      tool,
      executionContext
    )

    // Indexed so a later tool call in this run can name any of these by id.
    recordExecutionFiles(executionContext, processedOutput)

    return {
      ...result,
      output: processedOutput,
    }
  } catch (error) {
    const normalizedError = toError(error)
    logger.error(
      `Error processing file outputs for tool ${tool.id}:`,
      projectToolLogMetadata(
        {
          error: normalizedError.message,
          stack: error instanceof Error ? error.stack : undefined,
        },
        executionContext.resolvedSecretTraceRegistry,
        {
          errorName: normalizedError.name,
          hasStack: Boolean(error instanceof Error && error.stack),
        },
        tool.id === 'function_execute' || isCustomTool(tool.id)
      )
    )
    // Falling back to the original result leaves the raw file payload in place:
    // the caller would see success while the declared file objects are actually
    // undelivered bytes, which then flow into logs and any downstream model
    // prompt. Reporting the failure is the only honest outcome.
    return {
      ...result,
      success: false,
      error: `Failed to store file outputs for ${tool.id}: ${normalizedError.message}`,
      output: {},
    }
  }
}

export interface ExecuteToolOptions {
  skipPostProcess?: boolean
  executionContext?: ExecutionContext
  signal?: AbortSignal
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  /** Trusted base image claim for an internal Function execution. */
  internalSandboxProfile?: InternalSandboxProfile
  /** Trusted runtime scope for callers that execute a tool outside the workflow engine. */
  operationContext?: InternalToolOperationContext
}

interface PrivateToolResponseMetadataResult {
  response: Response
}

interface PrivateToolMetadataPolicy {
  type: PrivateToolMetadataType
  incomplete: 'reject' | 'propagate'
}

type PrivateToolMetadataConsumption = 'verified' | 'incomplete' | 'invalid'

function getFunctionExportedWorkspaceFileIds(payload: Record<string, unknown>): string[] {
  const ids = new Set<string>()
  const addId = (value: unknown): void => {
    if (typeof value === 'string' && value.length > 0) ids.add(value)
  }
  const output = isPlainRecord(payload.output) ? payload.output : undefined
  const result = output && isPlainRecord(output.result) ? output.result : undefined
  if (result) {
    addId(result.fileId)
    if (Array.isArray(result.files)) {
      for (const file of result.files) {
        if (isPlainRecord(file)) addId(file.fileId)
      }
    }
  }
  if (Array.isArray(payload.resources)) {
    for (const resource of payload.resources) {
      if (isPlainRecord(resource) && resource.type === 'file') addId(resource.id)
    }
  }
  return [...ids]
}

function consumeResolvedSecretNames(
  payload: unknown,
  params: Record<string, any>,
  registry?: ResolvedSecretTraceRegistry
): boolean {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false

  const response = payload as Record<string, unknown>
  if (!Object.hasOwn(response, RESOLVED_SECRET_NAMES_FIELD)) return false

  const names = response[RESOLVED_SECRET_NAMES_FIELD]
  response[RESOLVED_SECRET_NAMES_FIELD] = undefined
  if (!Array.isArray(names) || !names.every((name) => typeof name === 'string')) {
    return false
  }

  const envVars = params.envVars
  if (!envVars || typeof envVars !== 'object' || Array.isArray(envVars)) {
    return false
  }

  const targetRegistry = registry?.forkForToolCall()
  for (const name of names) {
    const value = (envVars as Record<string, unknown>)[name]
    if (typeof value !== 'string') return false
    if (targetRegistry && !targetRegistry.recordResolved(name, value, { propagated: true })) {
      return false
    }
  }
  if (registry && targetRegistry) registry.mergeToolCallRegistry(targetRegistry)
  return true
}

async function consumeResolvedSecretProvenance(
  payload: unknown,
  registry: ResolvedSecretTraceRegistry | undefined,
  toolId: string
): Promise<boolean> {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return false

  const response = payload as Record<string, unknown>
  if (!Object.hasOwn(response, RESOLVED_SECRET_PROVENANCE_FIELD)) return false

  const provenance = response[RESOLVED_SECRET_PROVENANCE_FIELD]
  response[RESOLVED_SECRET_PROVENANCE_FIELD] = undefined
  if (!isResolvedSecretTraceProvenanceV1(provenance)) return false
  if (!registry) return true

  const targetRegistry = registry.forkForToolCall()
  const imported = await targetRegistry.importCrossingProvenance(provenance, response, {
    trusted: true,
    origin: `tool.${toolId}`,
  })
  if (!imported) return false
  registry.mergeToolCallRegistry(targetRegistry)
  return true
}

function rebuildResponseWithoutPrivateToolMetadata(
  response: Response,
  payload: Record<string, unknown>
): Response {
  payload[RESOLVED_SECRET_NAMES_FIELD] = undefined
  payload[RESOLVED_SECRET_PROVENANCE_FIELD] = undefined
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete(PRIVATE_TOOL_METADATA_RESPONSE_HEADER)
  return new Response(JSON.stringify(payload), {
    status: response.status,
    statusText: response.statusText,
    headers,
  })
}

function rebuildSafePrivateToolResponse(response: Response): Response {
  const hasHttpErrorStatus = response.status >= 400 && response.status <= 599
  const status = hasHttpErrorStatus ? response.status : 502
  const error = hasHttpErrorStatus
    ? `Internal tool request failed (HTTP ${response.status})`
    : PRIVATE_TOOL_METADATA_ERROR_MESSAGE
  const headers = new Headers({ 'content-type': 'application/json' })
  return new Response(
    JSON.stringify({
      success: false,
      error,
    }),
    {
      status,
      ...(!hasHttpErrorStatus ? { statusText: 'Bad Gateway' } : {}),
      headers,
    }
  )
}

async function consumePrivateToolPayloadMetadata(
  payload: unknown,
  headers: Headers,
  requestedType: PrivateToolMetadataType | undefined,
  params: Record<string, any>,
  registry: ResolvedSecretTraceRegistry | undefined,
  toolId: string
): Promise<PrivateToolMetadataConsumption> {
  if (!requestedType) return 'verified'

  const inspection = inspectPrivateToolMetadataEnvelope(headers, payload, requestedType)
  const record = isRecordLike(payload) ? (payload as Record<string, unknown>) : undefined

  if (requestedType === RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2 && record) {
    const capability = inspectPrivateToolMetadataResponseCapability(headers, requestedType)
    const isLegacyNamesProducer =
      capability.status === 'mismatched' &&
      capability.receivedType === RESOLVED_SECRET_NAMES_METADATA_V1
    if (capability.status === 'unsupported' || isLegacyNamesProducer) {
      if (isLegacyNamesProducer) {
        const legacyInspection = inspectPrivateToolMetadataEnvelope(
          headers,
          record,
          RESOLVED_SECRET_NAMES_METADATA_V1
        )
        if (legacyInspection.status !== 'verified') return 'invalid'
        if (!consumeResolvedSecretNames(record, params, registry)) return 'invalid'
      } else {
        if (inspection.status !== 'unsupported') return 'invalid'
      }

      const fileIds = getFunctionExportedWorkspaceFileIds(record)
      if (fileIds.length > 0) {
        const workspaceId =
          typeof params.workspaceId === 'string'
            ? params.workspaceId
            : typeof params._context?.workspaceId === 'string'
              ? params._context.workspaceId
              : undefined
        if (!workspaceId) return 'invalid'
        await markWorkspaceFileSecretProvenanceUnknown(workspaceId, fileIds)
      }
      record[RESOLVED_SECRET_NAMES_FIELD] = undefined
      return registry?.isPermanentlyIncomplete() ? 'incomplete' : 'verified'
    }
  }

  if (inspection.status === 'unsupported') {
    return 'verified'
  }

  if (inspection.status === 'invalid' || !record) {
    return 'invalid'
  }

  try {
    if (
      requestedType === RESOLVED_SECRET_NAMES_METADATA_V1 ||
      requestedType === RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2
    ) {
      if (!consumeResolvedSecretNames(record, params, registry)) return 'invalid'
    } else {
      if (!(await consumeResolvedSecretProvenance(record, registry, toolId))) return 'invalid'
    }
  } catch {
    return 'invalid'
  }

  record[RESOLVED_SECRET_NAMES_FIELD] = undefined
  record[RESOLVED_SECRET_PROVENANCE_FIELD] = undefined
  return registry?.isPermanentlyIncomplete() ? 'incomplete' : 'verified'
}

async function consumePrivateToolResponseMetadata(
  response: Response,
  requestedType: PrivateToolMetadataType | undefined,
  params: Record<string, any>,
  registry: ResolvedSecretTraceRegistry | undefined,
  toolId: string
): Promise<PrivateToolResponseMetadataResult> {
  if (!requestedType) return { response }

  let payload: unknown
  try {
    payload = await response.clone().json()
  } catch {
    const inspection = inspectPrivateToolMetadataEnvelope(
      response.headers,
      undefined,
      requestedType
    )
    if (inspection.status === 'invalid') {
      return { response: rebuildSafePrivateToolResponse(response) }
    }
    return { response }
  }

  const consumption = await consumePrivateToolPayloadMetadata(
    payload,
    response.headers,
    requestedType,
    params,
    registry,
    toolId
  )
  if (consumption === 'invalid') {
    return { response: rebuildSafePrivateToolResponse(response) }
  }

  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
    return { response }
  }
  return {
    response: rebuildResponseWithoutPrivateToolMetadata(
      response,
      payload as Record<string, unknown>
    ),
  }
}

function getPrivateToolMetadataPolicy(toolId: string): PrivateToolMetadataPolicy | undefined {
  const normalizedToolId = normalizeToolId(toolId)
  if (normalizedToolId === 'file_get_content' || isMcpTool(normalizedToolId)) {
    return { type: RESOLVED_SECRET_PROVENANCE_METADATA_V1, incomplete: 'reject' }
  }
  if (normalizedToolId === 'function_execute' || isCustomTool(normalizedToolId)) {
    return { type: RESOLVED_SECRET_NAMES_DURABLE_FILES_METADATA_V2, incomplete: 'reject' }
  }
  const configuredTool = getTool(normalizedToolId)
  const configured = configuredTool
    ? isInternalToolConfig(configuredTool)
      ? configuredTool.operation.secretProvenance?.response
      : configuredTool.request.secretProvenance?.response
    : undefined
  if (configured) {
    return { type: RESOLVED_SECRET_PROVENANCE_METADATA_V1, incomplete: configured.incomplete }
  }
  return undefined
}

/**
 * Resolves a credential token from the browser through `POST /api/auth/oauth/token`,
 * authenticated by the session cookie. Server-side execution resolves in-process
 * through `resolveExecutorCredentialToken` instead; this HTTP path exists only
 * because the browser holds no server credentials.
 */
async function fetchCredentialTokenFromRoute(params: {
  requestId: string
  toolId: string
  toolLabel: string
  credentialId: string
  workflowId?: string
  impersonateEmail?: string
  scopes?: string[]
  callerUserId?: string
}): Promise<CredentialTokenPayload> {
  const { requestId, toolId, toolLabel, credentialId, workflowId } = params

  try {
    return await requestJson(oauthTokenPostContract, {
      query: { userId: params.callerUserId },
      headers: {},
      body: {
        credentialId,
        toolId,
        ...(workflowId ? { workflowId } : {}),
        ...(params.impersonateEmail ? { impersonateEmail: params.impersonateEmail } : {}),
        ...(params.scopes ? { scopes: params.scopes } : {}),
      },
    })
  } catch (error: unknown) {
    const status = error instanceof ApiClientError ? error.status : undefined
    logger.error(`[${requestId}] Token fetch failed for ${toolId}:`, {
      status,
      error: getErrorMessage(error),
    })
    throw new Error(`Failed to obtain credential for ${toolLabel}: ${getErrorMessage(error)}`)
  }
}

/**
 * Runs private-provenance tools against an isolated registry. Unavailable authenticated lineage
 * marks the parent unknown without replacing the tool's functional result; malformed metadata is
 * rejected inside the transport consumer and never committed to the parent.
 */
export async function executeTool(
  toolId: string,
  params: Record<string, any>,
  options: ExecuteToolOptions = {}
): Promise<ToolResponse> {
  const parentRegistry =
    options.resolvedSecretTraceRegistry ??
    options.executionContext?.resolvedSecretTraceRegistry ??
    options.operationContext?.resolvedSecretTraceRegistry
  const privateMetadataPolicy = getPrivateToolMetadataPolicy(toolId)
  if (!parentRegistry || !privateMetadataPolicy) {
    return executeToolImplementation(toolId, params, options)
  }
  if (privateMetadataPolicy.incomplete === 'propagate') {
    return executeToolImplementation(toolId, params, options)
  }

  const paramEntries = getOwnEnumerableDataEntries(params)
  const toolRegistry = paramEntries
    ? parentRegistry.forkForInputPaths(paramEntries.map(([key]) => [key] as const))
    : parentRegistry.forkForToolCall()
  if (!paramEntries) toolRegistry.markIncomplete('tool-input-not-enumerable')
  const executionContext = options.executionContext
    ? {
        ...options.executionContext,
        /**
         * Materialized on the source before the spread so both objects hold the
         * same `Map` instance. The index is lazily built on first access, and
         * this clone is discarded when the call returns — so letting it be
         * created here would record every file a tool produced onto a throwaway,
         * and the next call in the run would rebuild an index that never saw
         * them.
         */
        executionFilesById: getExecutionFileIndex(options.executionContext),
        resolvedSecretTraceRegistry: toolRegistry,
      }
    : undefined
  const operationContext = options.operationContext
    ? { ...options.operationContext, resolvedSecretTraceRegistry: toolRegistry }
    : undefined
  let result: ToolResponse
  try {
    result = await executeToolImplementation(toolId, params, {
      ...options,
      ...(executionContext ? { executionContext } : {}),
      ...(operationContext ? { operationContext } : {}),
      resolvedSecretTraceRegistry: toolRegistry,
    })
  } catch (error) {
    parentRegistry.mergeToolCallRegistry(toolRegistry)
    throw error
  }

  parentRegistry.mergeToolCallRegistry(toolRegistry)
  return result
}

/** Executes a tool through its declared in-process or external boundary. */
async function executeToolImplementation(
  toolId: string,
  params: Record<string, any>,
  options: ExecuteToolOptions = {}
): Promise<ToolResponse> {
  const {
    skipPostProcess = false,
    executionContext: suppliedExecutionContext,
    signal,
    resolvedSecretTraceRegistry: explicitResolvedSecretTraceRegistry,
    internalSandboxProfile,
    operationContext: suppliedOperationContext,
  } = options
  /** A nested operation cannot replace the Assistant's person with workflow execution authority. */
  const executionContext =
    suppliedOperationContext?.requestMode === 'assistant' ? undefined : suppliedExecutionContext
  const resolvedSecretTraceRegistry =
    explicitResolvedSecretTraceRegistry ??
    executionContext?.resolvedSecretTraceRegistry ??
    suppliedOperationContext?.resolvedSecretTraceRegistry
  const effectiveSignal = signal ?? executionContext?.abortSignal
  const operationContext = executionContext
    ? createInternalToolOperationContext(executionContext)
    : suppliedOperationContext
      ? { ...suppliedOperationContext, resolvedSecretTraceRegistry }
      : undefined
  const executeNestedTool: typeof executeTool = (nestedToolId, nestedParams, nestedOptions = {}) =>
    executeTool(nestedToolId, nestedParams, {
      ...nestedOptions,
      ...(operationContext?.requestMode === 'assistant' ? { operationContext } : {}),
      executionContext:
        operationContext?.requestMode === 'assistant'
          ? undefined
          : (nestedOptions.executionContext ?? executionContext),
      signal: nestedOptions.signal ?? effectiveSignal,
      resolvedSecretTraceRegistry:
        nestedOptions.resolvedSecretTraceRegistry ?? resolvedSecretTraceRegistry,
    })
  // Capture start time for precise timing
  const startTime = new Date()
  const startTimeISO = startTime.toISOString()
  const requestId = generateRequestId()
  const normalizedToolId = normalizeToolId(toolId)
  const privateToolMetadataPolicy = resolvedSecretTraceRegistry
    ? getPrivateToolMetadataPolicy(toolId)
    : undefined
  const structuralOnlyToolLogs =
    normalizedToolId === 'function_execute' ||
    isCustomTool(toolId) ||
    privateToolMetadataPolicy !== undefined

  // Hoisted so the outer catch can attribute a thrown failure to the chosen key.
  let hostedKeyForMetrics: { provider: string; tool: string; key: string } | undefined
  let completePendingSecretActivation: (() => void) | undefined

  try {
    let tool: ExecutableToolConfig | undefined

    // Preserve direct-call compatibility with legacy resource-suffixed tool ids.
    if (internalSandboxProfile && normalizedToolId !== 'function_execute') {
      throw new Error('An internal sandbox profile may only be used with function_execute')
    }

    const scope = resolveToolScope(params, executionContext)
    if (operationContext?.requestMode === 'assistant') {
      const { assertAssistantIntegrationCall } = await import('@/lib/copilot/assistant/tool-policy')
      const { getToolMetadata } = await import('@/tools/metadata')
      const { _context, ...modelParams } = params
      assertAssistantIntegrationCall(getToolMetadata(toolId), modelParams)
      scope.envReferenceMode = 'off'
      scope.userId = operationContext.userId
      scope.workspaceId = operationContext.workspaceId
      scope.copilotToolExecution = true
      scope.enforceCredentialAccess = true
    }

    const toolKind: 'skill' | 'custom' | 'mcp' | undefined =
      normalizedToolId === 'load_skill'
        ? 'skill'
        : isCustomTool(normalizedToolId)
          ? 'custom'
          : isMcpTool(normalizedToolId)
            ? 'mcp'
            : undefined
    const privateToolMetadataType = privateToolMetadataPolicy?.type

    if (resolvedSecretTraceRegistry && privateToolMetadataType) {
      completePendingSecretActivation = resolvedSecretTraceRegistry.beginPendingActivation()
    }

    // Runs for ALL tools (not just kinded ones) so the per-tool `deniedTools`
    // denylist is enforced alongside the existing mcp/custom/skill gates.
    if (scope.userId && scope.workspaceId) {
      await assertToolPermissionsWithRetry({
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        toolId: normalizedToolId,
        toolKind,
        ctx: executionContext,
        requestId,
        signal: effectiveSignal,
      })
    }

    if (normalizedToolId === 'load_skill') {
      const skillName = params.skill_name
      if (!skillName || !scope.workspaceId) {
        return {
          success: false,
          output: { error: 'Missing skill_name or workspace context' },
          error: 'Missing skill_name or workspace context',
        }
      }
      const content = await resolveSkillContent(skillName, scope.workspaceId)
      if (!content) {
        return {
          success: false,
          output: { error: `Skill "${skillName}" not found` },
          error: `Skill "${skillName}" not found`,
        }
      }
      return {
        success: true,
        output: { content },
      }
    }

    if (isCustomTool(normalizedToolId)) {
      tool = await getToolAsync(normalizedToolId, {
        executionContext,
        operationContext,
        signal: effectiveSignal,
      })
      if (!tool) {
        logger.error(`[${requestId}] Custom tool not found: ${normalizedToolId}`)
      }
    } else if (isMcpTool(normalizedToolId)) {
      return await executeMcpTool(
        normalizedToolId,
        params,
        operationContext,
        requestId,
        startTimeISO,
        effectiveSignal
      )
    } else {
      // For built-in tools, use the synchronous version
      tool = getTool(normalizedToolId)
      if (!tool) {
        logger.error(`[${requestId}] Built-in tool not found: ${normalizedToolId}`)
      }
    }

    // Ensure context is preserved if it exists
    const contextParams = { ...params }
    for (const paramId of tool?.oauth?.authoritativeParams ?? []) {
      contextParams[paramId] = undefined
    }
    if (scope.billingAttribution) {
      contextParams._context = {
        ...(contextParams._context as Record<string, unknown> | undefined),
        billingAttribution: scope.billingAttribution,
      }
    }

    // Validate the tool and its parameters
    validateRequiredParametersAfterMerge(toolId, tool, contextParams)

    // After validation, we know tool exists
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    await normalizeFileParams(tool, contextParams, scope, executionContext)
    normalizeCopilotCredentialParams(contextParams)
    enforceCopilotCredentialSelection(toolId, tool, contextParams, scope)
    await resolveToolEnvReferences(tool, contextParams, scope, resolvedSecretTraceRegistry)

    // Inject hosted API key if tool supports it and user didn't provide one
    const hostedKeyInfo = await injectHostedKeyIfNeeded(
      tool,
      contextParams,
      executionContext,
      requestId
    )

    if (hostedKeyInfo.isUsingHostedKey) {
      hostedKeyForMetrics = {
        provider: tool.hosting?.byokProviderId || tool.id,
        tool: tool.id,
        key: hostedKeyInfo.envVarName ?? 'unknown',
      }
    }

    // If we have a credential parameter, fetch the access token
    if (contextParams.oauthCredential) {
      contextParams.credential = contextParams.oauthCredential
    }
    if (operationContext?.requestMode === 'assistant' && tool.personalToken) {
      if (typeof window !== 'undefined' || !operationContext.workspaceId) {
        throw new Error('Personal tokens require a trusted workspace execution context')
      }
      const [{ executeCopilotCredentialUseCase }, { resolvePersonalToken }] = await Promise.all([
        import('@/lib/copilot/application/execute-credential-use-case'),
        import('@/lib/credentials/application/resolve-personal-token'),
      ])
      const token = await executeCopilotCredentialUseCase(operationContext, resolvePersonalToken, {
        credentialId: String(contextParams.credential),
        assertedWorkspaceId: operationContext.workspaceId,
        expectedProviderId: tool.personalToken.provider,
      })
      await registerAssistantCredentialSecrets(resolvedSecretTraceRegistry, [token.accessToken])
      contextParams[tool.personalToken.tokenParam] = token.accessToken
      contextParams[tool.personalToken.hostParam] = token.instanceUrl
      contextParams.credential = undefined
      contextParams.credentialId = undefined
      contextParams.oauthCredential = undefined
    }
    if (contextParams.credential) {
      logger.info(`[${requestId}] Resolving tool access token`, { toolId: normalizedToolId })
      try {
        const workflowId = scope.workflowId
        const userId = scope.userId
        const credentialId = contextParams.credential as string
        const toolLabel = tool?.name || toolId
        const impersonateEmail = contextParams.impersonateUserEmail as string | undefined

        let providerScopes: string[] | undefined
        if (tool?.oauth?.provider) {
          const scopesForProvider =
            tool.oauth.requiredScopes ??
            (await import('@/lib/oauth/utils')).getCanonicalScopesForProvider(tool.oauth.provider)
          if (scopesForProvider.length > 0) {
            providerScopes = scopesForProvider
          }
        }

        /**
         * The acting user asserted alongside the credential. Only asserted when the
         * run enforces credential access — it never widens access, it only pins the
         * assertion to the authenticated subject.
         */
        const enforceCredentialAccess = Boolean(contextParams._context?.enforceCredentialAccess)

        let data: CredentialTokenPayload
        if (typeof window === 'undefined') {
          /**
           * Dynamic import for the same client-bundle reason as the workflow_executor
           * runner below: the resolver pulls the db/audit dependency graph, which must
           * never enter the client-bundled tool registry.
           */
          const { resolveExecutorCredentialToken } = await import(
            '@/executor/utils/credential-token'
          )
          data = await resolveExecutorCredentialToken({
            requestId,
            credentialId,
            userId,
            workflowId,
            toolId,
            toolLabel,
            scopes: providerScopes,
            impersonateEmail,
            enforceCredentialAccess,
            executorDelegationOrigin: executionContext?.executorDelegationOrigin,
            ...(operationContext?.copilotToolExecution
              ? { copilotExecutionContext: operationContext }
              : {}),
          })
        } else {
          data = await fetchCredentialTokenFromRoute({
            requestId,
            toolId,
            toolLabel,
            credentialId,
            workflowId,
            impersonateEmail,
            scopes: providerScopes,
            callerUserId: userId && enforceCredentialAccess ? userId : undefined,
          })
        }

        if (tool.oauth?.credentialKind) {
          const actualCredentialKind =
            data.credentialType === 'service_account'
              ? 'service-account'
              : data.credentialType === 'oauth' || data.credentialType === 'managed_oauth'
                ? 'oauth'
                : null
          if (actualCredentialKind !== tool.oauth.credentialKind) {
            throw new Error(`${tool.name} requires a ${tool.oauth.credentialKind} credential`)
          }
        }

        if (operationContext?.requestMode === 'assistant') {
          await registerAssistantCredentialSecrets(resolvedSecretTraceRegistry, [
            data.accessToken,
            data.idToken,
          ])
        }
        contextParams.accessToken = data.accessToken
        if (data.credentialType && tool.oauth?.authoritativeParams?.includes('credentialType')) {
          contextParams.credentialType = data.credentialType
        }
        if (data.idToken) {
          contextParams.idToken = data.idToken
        }
        if (data.instanceUrl) {
          contextParams.instanceUrl = data.instanceUrl
        }
        if (data.apiDomain && !contextParams.apiDomain) {
          contextParams.apiDomain = data.apiDomain
        }
        if (data.cloudId && !contextParams.cloudId) {
          contextParams.cloudId = data.cloudId
        }
        if (data.domain && !contextParams.domain) {
          contextParams.domain = data.domain
        }
        if (data.realmId && tool.oauth?.authoritativeParams?.includes('realmId')) {
          contextParams.realmId = data.realmId
        }
        if (
          data.quickBooksEnvironment &&
          tool.oauth?.authoritativeParams?.includes('quickBooksEnvironment')
        ) {
          contextParams.quickBooksEnvironment = data.quickBooksEnvironment
        }
        if (data.authStyle && !contextParams.authStyle) {
          contextParams.authStyle = data.authStyle
        }

        logger.info(`[${requestId}] Successfully got access token for ${toolId}`)

        // Preserve credential for downstream transforms while removing it from request payload
        // so we don't leak it to external services.
        if (contextParams.credential) {
          ;(contextParams as any)._credentialId = contextParams.credential
        }
        if (workflowId) {
          ;(contextParams as any)._workflowId = workflowId
        }
        // Clean up params we don't need to pass to the actual tool
        contextParams.credential = undefined
        contextParams.impersonateUserEmail = undefined
        if (contextParams.workflowId) contextParams.workflowId = undefined
      } catch (error: any) {
        logger.error(`[${requestId}] Error fetching access token for ${toolId}:`, {
          error: toError(error).message,
        })
        throw error
      }
    }

    // Custom blocks (deploy-as-block) run in-process through WorkflowBlockHandler.
    // The runner is dynamic-imported from a server-only module so the client-bundled
    // tool registry never pulls in the executor/db dependency graph (a static or
    // dynamic executor import in the tool descriptor itself would break the client
    // build — and with it `getTool('workflow_executor')`).
    // Workflow-as-agent-tool runs in-process through WorkflowBlockHandler —
    // the same invocation boundary canvas child workflows use. Replaces the
    // historical HTTP hop to /api/workflows/{id}/execute (double admission
    // slot + duplicate top-level log row); billing/observability now match the
    // canvas workflow block.
    if (normalizedToolId === 'workflow_executor') {
      logger.info(`[${requestId}] Running workflow tool ${toolId} in-process`)
      const { runWorkflowTool } = await import('@/executor/handlers/workflow/workflow-tool-runner')
      const result = await runWorkflowTool(
        {
          ...contextParams,
          _context: {
            ...(contextParams._context as Record<string, unknown> | undefined),
            ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
            ...(scope.workflowId ? { workflowId: scope.workflowId } : {}),
            ...(scope.userId ? { userId: scope.userId } : {}),
            ...(scope.executionId ? { executionId: scope.executionId } : {}),
            ...(scope.callChain ? { callChain: scope.callChain } : {}),
            ...(scope.isDeployedContext !== undefined
              ? { isDeployedContext: scope.isDeployedContext }
              : {}),
            ...(scope.billingAttribution ? { billingAttribution: scope.billingAttribution } : {}),
          },
        },
        {
          abortSignal: effectiveSignal,
          resolvedSecretTraceRegistry,
          executorDelegationOrigin: executionContext?.executorDelegationOrigin,
          principal: executionContext?.principal,
          // Trusted `executionContext`, never `_context` — that bag spreads
          // model-reachable `contextParams._context` first, so a model could otherwise
          // inject its own env map or disable redaction.
          // Copied, not aliased: the child holds this map for its whole run, and a
          // write through it would corrupt the parent's env and every later sibling
          // tool call. Every other consumer of `ctx.environmentVariables` already
          // copies (`normalizeStringRecord`); this boundary is the longest-lived one.
          environmentVariables: { ...executionContext?.environmentVariables },
          piiBlockOutputRedaction: executionContext?.piiBlockOutputRedaction,
        }
      )
      const endTime = new Date()
      return {
        ...result,
        output: postProcessToolOutput(normalizedToolId, result.output ?? {}),
        timing: {
          startTime: startTimeISO,
          endTime: endTime.toISOString(),
          duration: endTime.getTime() - startTime.getTime(),
        },
      }
    }

    if (normalizedToolId === 'deployed_block_executor') {
      logger.info(`[${requestId}] Running custom block tool ${toolId}`)
      const { runCustomBlockTool } = await import(
        '@/executor/handlers/workflow/custom-block-tool-runner'
      )
      // Forward the INVOKING run's identifiers so the child's log correlation
      // names a real execution instead of a freshly-minted phantom id. Taken
      // from the server-resolved scope, never from model-supplied params.
      const result = await runCustomBlockTool(
        {
          ...contextParams,
          _context: {
            ...(contextParams._context as Record<string, unknown> | undefined),
            ...(scope.workspaceId ? { workspaceId: scope.workspaceId } : {}),
            ...(scope.workflowId ? { workflowId: scope.workflowId } : {}),
            ...(scope.userId ? { userId: scope.userId } : {}),
            ...(scope.executionId ? { executionId: scope.executionId } : {}),
            ...(scope.callChain ? { callChain: scope.callChain } : {}),
            ...(scope.isDeployedContext !== undefined
              ? { isDeployedContext: scope.isDeployedContext }
              : {}),
            ...(scope.billingAttribution ? { billingAttribution: scope.billingAttribution } : {}),
            requestId,
          },
        },
        {
          abortSignal: effectiveSignal,
          resolvedSecretTraceRegistry,
          principal: executionContext?.principal,
        }
      )
      const endTime = new Date()
      return {
        ...result,
        // Strip internal `__`-prefixed fields the same way every other tool path does,
        // so child-workflow internals never reach the agent's tool result.
        output: postProcessToolOutput(normalizedToolId, result.output ?? {}),
        timing: {
          startTime: startTimeISO,
          endTime: endTime.toISOString(),
          duration: endTime.getTime() - startTime.getTime(),
        },
      }
    }

    if (tool.operation) {
      const result = await executeDeclaredInternalOperation({
        toolId: normalizedToolId,
        tool,
        params: contextParams,
        context: operationContext,
        signal: effectiveSignal,
        requestId,
        privateToolMetadataType,
        resolvedSecretTraceRegistry,
        internalSandboxProfile,
      })

      let finalResult = result
      if (tool.postProcess && result.success && !skipPostProcess) {
        try {
          finalResult = await tool.postProcess(result, contextParams, executeNestedTool)
        } catch (error) {
          logger.error(`[${requestId}] Post-processing error for ${toolId}`, {
            errorName: toError(error).name,
          })
        }
      }
      finalResult = await processFileOutputs(finalResult, tool, executionContext)

      if (hostedKeyInfo.isUsingHostedKey && finalResult.success) {
        await applyHostedKeyCostToResult(
          finalResult,
          tool,
          contextParams,
          executionContext,
          requestId,
          hostedKeyInfo.envVarName
        )
      } else if (hostedKeyForMetrics) {
        hostedKeyMetrics.recordFailed({ ...hostedKeyForMetrics, reason: 'other' })
      }

      const endTime = new Date()
      return {
        ...finalResult,
        output: postProcessToolOutput(normalizedToolId, finalResult.output ?? {}),
        timing: {
          startTime: startTimeISO,
          endTime: endTime.toISOString(),
          duration: endTime.getTime() - startTime.getTime(),
        },
      }
    }

    // Wrap external requests with hosted-key retry and reacquisition.
    const result = hostedKeyInfo.isUsingHostedKey
      ? await executeWithRetry(
          () =>
            executeToolRequest(
              toolId,
              tool,
              contextParams,
              effectiveSignal,
              resolvedSecretTraceRegistry
            ),
          {
            requestId,
            toolId,
            provider: tool.hosting?.byokProviderId || tool.id,
            envVarName: hostedKeyInfo.envVarName!,
            executionContext,
            reacquireAfterRetriesExhausted: async () => {
              const reacquiredEnvVar = await reacquireHostedKey(
                tool,
                contextParams,
                executionContext,
                requestId
              )
              if (!reacquiredEnvVar) return null
              // Re-point metric labels at the freshly acquired key.
              hostedKeyInfo.envVarName = reacquiredEnvVar
              if (hostedKeyForMetrics) hostedKeyForMetrics.key = reacquiredEnvVar
              return () =>
                executeToolRequest(
                  toolId,
                  tool,
                  contextParams,
                  effectiveSignal,
                  resolvedSecretTraceRegistry
                )
            },
          }
        )
      : await executeToolRequest(
          toolId,
          tool,
          contextParams,
          effectiveSignal,
          resolvedSecretTraceRegistry
        )

    // Apply post-processing if available and not skipped
    let finalResult = result
    if (tool.postProcess && result.success && !skipPostProcess) {
      try {
        finalResult = await tool.postProcess(result, contextParams, executeNestedTool)
      } catch (error) {
        const normalizedError = toError(error)
        logger.error(
          `[${requestId}] Post-processing error for ${toolId}:`,
          projectToolLogMetadata(
            { error: normalizedError.message },
            resolvedSecretTraceRegistry,
            {
              errorName: normalizedError.name,
            },
            structuralOnlyToolLogs
          )
        )
        finalResult = result
      }
    }

    // Process file outputs if execution context is available
    finalResult = await processFileOutputs(finalResult, tool, executionContext)

    // Add timing data to the result
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - startTime.getTime()

    if (hostedKeyInfo.isUsingHostedKey && finalResult.success) {
      await applyHostedKeyCostToResult(
        finalResult,
        tool,
        contextParams,
        executionContext,
        requestId,
        hostedKeyInfo.envVarName
      )
    } else if (hostedKeyForMetrics) {
      hostedKeyMetrics.recordFailed({ ...hostedKeyForMetrics, reason: 'other' })
    }

    const strippedOutput = postProcessToolOutput(normalizedToolId, finalResult.output ?? {})

    return {
      ...finalResult,
      output: strippedOutput,
      timing: {
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      },
    }
  } catch (error: any) {
    const normalizedError = toError(error)
    const databaseQueryError = findCause(
      error,
      (cause): cause is DrizzleQueryError => cause instanceof DrizzleQueryError
    )
    const databaseErrorCause = databaseQueryError ? describeError(error) : undefined
    logger.error(
      `[${requestId}] Error executing tool ${toolId}:`,
      projectToolLogMetadata(
        {
          ...(databaseErrorCause
            ? { cause: databaseErrorCause }
            : {
                error: normalizedError.message,
                stack: error instanceof Error ? error.stack : undefined,
              }),
        },
        resolvedSecretTraceRegistry,
        {
          errorName: normalizedError.name,
          hasStack: !databaseErrorCause && Boolean(error instanceof Error && error.stack),
          ...(databaseErrorCause ? { cause: databaseErrorCause } : {}),
        },
        structuralOnlyToolLogs
      )
    )

    if (hostedKeyForMetrics) {
      hostedKeyMetrics.recordFailed({
        ...hostedKeyForMetrics,
        reason: classifyHostedKeyFailure(error),
      })
    }

    // Default error handling
    let errorMessage = 'Unknown error occurred'
    let errorDetails = {}

    if (error instanceof Error) {
      errorMessage = databaseQueryError
        ? INTERNAL_DATABASE_ERROR_MESSAGE
        : error.message || `Error executing tool ${toolId}`
      // HTTP errors are thrown as Error instances carrying `status`/`statusText`/
      // `data` (see createTransformedErrorFromErrorInfo). Surface them on the
      // output so callers can branch on the status (e.g. treat 404 as a clean
      // no-match) — the object branch below only ran for non-Error throws.
      const httpStatus = (error as { status?: unknown }).status
      if (typeof httpStatus === 'number') {
        errorDetails = {
          status: httpStatus,
          statusText: (error as { statusText?: string }).statusText,
          data: (error as { data?: unknown }).data,
        }
      }
    } else if (typeof error === 'string') {
      errorMessage = error
    } else if (error && typeof error === 'object') {
      // Handle HTTP response errors
      if (error.status) {
        errorMessage = `HTTP ${error.status}: ${error.statusText || 'Request failed'}`

        if (error.data) {
          if (typeof error.data === 'string') {
            errorMessage = `${errorMessage} - ${error.data}`
          } else if (error.data.message) {
            errorMessage = `${errorMessage} - ${error.data.message}`
          } else if (error.data.error) {
            errorMessage = `${errorMessage} - ${
              typeof error.data.error === 'string'
                ? error.data.error
                : JSON.stringify(error.data.error)
            }`
          }
        }

        errorDetails = {
          status: error.status,
          statusText: error.statusText,
          data: error.data,
        }
      }
      // Handle other errors with messages
      else if (error.message) {
        // Don't pass along "undefined (undefined)" messages
        if (error.message === 'undefined (undefined)') {
          errorMessage = `Error executing tool ${toolId}`
          // Add status if available
          if (error.status) {
            errorMessage += ` (Status: ${error.status})`
          }
        } else {
          errorMessage = error.message
        }

        if ((error as any).cause) {
          errorMessage = `${errorMessage} (${(error as any).cause})`
        }
      }
    }

    // Add timing data even for errors
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - startTime.getTime()
    const rawResponseData =
      error instanceof Error && 'data' in error ? (error as { data?: unknown }).data : undefined
    const responseData = isRecordLike(rawResponseData) ? rawResponseData : undefined
    const functionSandboxCost =
      normalizedToolId === 'function_execute' ? readFunctionSandboxCost(responseData) : undefined
    return {
      success: false,
      output: {
        ...errorDetails,
        ...(functionSandboxCost ? { cost: functionSandboxCost } : {}),
      },
      error: errorMessage,
      ...(responseData?.retryable === false ? { retryable: false } : {}),
      // Sim's own status (hosted-key 429/503) survives the flattening from a
      // thrown error into a result object; an upstream provider's status stays
      // on `output` where it cannot be mistaken for ours.
      ...(error instanceof HttpError ? { statusCode: error.statusCode } : {}),
      timing: {
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      },
    }
  } finally {
    completePendingSecretActivation?.()
  }
}

/**
 * Determines if a response or result represents an error condition
 */
function isErrorResponse(
  response: Response | any,
  data?: any
): { isError: boolean; errorInfo?: { status?: number; statusText?: string; data?: any } } {
  // HTTP Response object
  if (response && typeof response === 'object' && 'ok' in response) {
    if (!response.ok) {
      return {
        isError: true,
        errorInfo: {
          status: response.status,
          statusText: response.statusText,
          data: data,
        },
      }
    }
    return { isError: false }
  }

  // ToolResponse object
  if (response && typeof response === 'object' && 'success' in response) {
    return {
      isError: !response.success,
      errorInfo: response.success ? undefined : { data: response },
    }
  }

  // Check for error indicators in data
  if (data && typeof data === 'object') {
    if (data.error || data.success === false) {
      return {
        isError: true,
        errorInfo: { data: data },
      }
    }
  }

  return { isError: false }
}

/**
 * Checks whether a fully resolved URL points back to this Sim instance.
 * Loopback aliases are equivalent when protocol and port match because they
 * address the same self-hosted listener even when their origin strings differ.
 * Used to propagate cycle-detection headers on API blocks that target
 * the platform's own workflow execution endpoints via absolute URL.
 */
function isSelfOriginUrl(url: string): boolean {
  return [getBaseUrl(), getInternalApiBaseUrl()].some((baseUrl) => {
    if (isSameOrigin(url, baseUrl)) return true

    try {
      const target = new URL(url)
      const base = new URL(baseUrl)
      if (target.protocol !== base.protocol || target.port !== base.port) return false

      const targetHostname = unwrapIpv6Brackets(target.hostname.toLowerCase())
      const baseHostname = unwrapIpv6Brackets(base.hostname.toLowerCase())
      const targetIsLoopback = targetHostname === 'localhost' || isLoopbackIp(targetHostname)
      const baseIsLoopback = baseHostname === 'localhost' || isLoopbackIp(baseHostname)
      return targetIsLoopback && baseIsLoopback
    } catch {
      return false
    }
  })
}

interface ResolvedRetryConfig {
  maxRetries: number
  initialDelayMs: number
  maxDelayMs: number
}

function getRetryConfig(
  retry: ToolRetryConfig | undefined,
  params: Record<string, any>,
  method: string
): ResolvedRetryConfig | null {
  if (!retry?.enabled) return null

  const isIdempotent = ['GET', 'HEAD', 'PUT', 'DELETE'].includes(method.toUpperCase())
  if (retry.retryIdempotentOnly && !isIdempotent && !params.retryNonIdempotent) {
    return null
  }

  const maxRetries = Math.min(10, Math.max(0, Number(params.retries) || retry.maxRetries || 0))
  if (maxRetries === 0) return null

  return {
    maxRetries,
    initialDelayMs: Number(params.retryDelayMs) || retry.initialDelayMs || 500,
    maxDelayMs: Number(params.retryMaxDelayMs) || retry.maxDelayMs || 30000,
  }
}

function isRetryableFailure(error: unknown, status?: number): boolean {
  if (status === 429 || (status && status >= 500 && status <= 599)) return true
  if (error instanceof Error) {
    const code = (error as NodeJS.ErrnoException).code
    if (code === 'ETIMEDOUT' || code === 'ECONNRESET' || code === 'ECONNABORTED') {
      return true
    }
    const msg = error.message.toLowerCase()
    if (isBodySizeLimitError(msg)) return false
    return msg.includes('timeout') || msg.includes('timed out')
  }
  return false
}

function shouldRetryWithoutReadingBody(
  status: number,
  headers: { get(name: string): string | null },
  retryConfig: ResolvedRetryConfig | null | undefined,
  isLastAttempt: boolean
): boolean {
  if (!retryConfig || isLastAttempt || !isRetryableFailure(null, status)) {
    return false
  }
  return (
    (parseRetryAfter(headers.get('retry-after'), Number.POSITIVE_INFINITY) ?? 0) <=
    retryConfig.maxDelayMs
  )
}

interface ExecuteDeclaredInternalOperationInput {
  toolId: string
  tool: InternalToolConfig
  params: Record<string, any>
  context?: InternalToolOperationContext
  signal?: AbortSignal
  requestId: string
  privateToolMetadataType?: PrivateToolMetadataType
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
  internalSandboxProfile?: InternalSandboxProfile
}

function isFunctionExecuteBody(value: unknown): value is FunctionExecuteBody {
  return isPlainRecord(value) && typeof value.code === 'string'
}

interface FunctionSandboxCost {
  input: number
  output: number
  total: number
}

function readFunctionSandboxCost(value: unknown): FunctionSandboxCost | undefined {
  if (!isRecordLike(value) || !isRecordLike(value.output) || !isRecordLike(value.output.cost)) {
    return undefined
  }
  const { input, output, total } = value.output.cost
  if (
    typeof input !== 'number' ||
    !Number.isFinite(input) ||
    input < 0 ||
    typeof output !== 'number' ||
    !Number.isFinite(output) ||
    output < 0 ||
    typeof total !== 'number' ||
    !Number.isFinite(total) ||
    total < 0
  ) {
    return undefined
  }
  return { input, output, total }
}

function isToolResponse(value: unknown): value is ToolResponse {
  return isRecordLike(value) && typeof value.success === 'boolean' && isRecordLike(value.output)
}

async function executeDeclaredInternalOperation({
  toolId,
  tool,
  params,
  context,
  signal,
  requestId,
  privateToolMetadataType,
  resolvedSecretTraceRegistry,
  internalSandboxProfile,
}: ExecuteDeclaredInternalOperationInput): Promise<ToolResponse> {
  if (
    !context?.workspaceId ||
    (!context.executorDelegationOrigin && !context.userId && !context.copilotToolExecution)
  ) {
    throw new Error('Internal tool execution requires trusted execution scope')
  }

  const operationParams = projectToolModelInputParams(tool, params, resolvedSecretTraceRegistry)
  let operationInput = tool.operation.input(operationParams)
  const isRegisteredCustomTool = isCustomTool(toolId)
  const isFunctionOperation = toolId === 'function_execute' || isRegisteredCustomTool
  if (isFunctionOperation) {
    if (!isFunctionExecuteBody(operationInput)) {
      throw new Error('Function operation input must be an object')
    }
    operationInput = { ...operationInput, isCustomTool: isRegisteredCustomTool }
  }
  if (
    isRegisteredCustomTool &&
    isFunctionExecuteBody(operationInput) &&
    'schema' in operationInput &&
    'params' in operationInput
  ) {
    validateClientSideParams(
      operationInput.params as Record<string, any>,
      operationInput.schema as {
        type: string
        properties: Record<string, any>
        required?: string[]
      }
    )
  }

  const headers = new Headers()
  const modelInput = tool.operation.modelInput
  const selectedModelInputPaths =
    modelInput?.mode === 'private-provenance'
      ? modelInput.inputPaths(operationParams)
      : modelInput?.mode === 'project'
        ? modelInput.privateInputPaths?.(operationParams)
        : undefined
  const modelInputMetadata = selectedModelInputPaths
    ? createModelInputProvenanceRequestMetadata(
        resolvedSecretTraceRegistry,
        selectedModelInputPaths
      )
    : undefined
  const secretProvenanceMetadata = tool.operation.secretProvenance?.request
    ? createPrivateSecretProvenanceRequestMetadata(
        resolvedSecretTraceRegistry,
        tool.operation.secretProvenance.request(operationParams)
      )
    : undefined
  if (modelInputMetadata || secretProvenanceMetadata) {
    if (!isPlainRecord(operationInput)) {
      throw new Error('Internal operation provenance requires an object input')
    }
    operationInput = addModelInputProvenanceToRequest(
      addModelInputProvenanceToRequest(operationInput, headers, modelInputMetadata),
      headers,
      secretProvenanceMetadata
    )
    if (modelInputMetadata && modelInput?.mode === 'project') {
      markModelInputProjected(headers)
    }
  }
  if (isPlainRecord(operationInput) && operationInput[PRIVATE_SECRET_PROVENANCE_FIELD]) {
    headers.set(PRIVATE_SECRET_PROVENANCE_HEADER, PRIVATE_SECRET_PROVENANCE_BUNDLE_V1)
  }
  if (privateToolMetadataType) {
    headers.set(PRIVATE_TOOL_METADATA_REQUEST_HEADER, privateToolMetadataType)
  }
  validateRequestBodySize(JSON.stringify(operationInput), requestId, toolId)
  const deadline = serializeExecutionDeadlineHeader(signal)
  if (deadline) headers.set(INTERNAL_EXECUTION_DEADLINE_HEADER, deadline)
  const billingAttribution = context.billingAttribution
  if (billingAttribution) {
    headers.set(BILLING_ATTRIBUTION_HEADER, serializeBillingAttributionHeader(billingAttribution))
  }
  if (context.callChain?.length) {
    headers.set(SIM_VIA_HEADER, serializeCallChain(context.callChain))
  }

  let response: Response
  if (isFunctionOperation) {
    if (!isFunctionExecuteBody(operationInput)) {
      throw new Error('Function operation input must be an object')
    }
    response = await executeFunctionTool({
      body: operationInput,
      headers,
      context: {
        ...context,
        userId: context.userId,
        workspaceId: context.workspaceId,
      },
      requestId,
      ...(signal ? { signal } : {}),
      ...(internalSandboxProfile ? { sandboxProfile: internalSandboxProfile } : {}),
    })
  } else {
    const handler = await getInternalToolOperationHandler(toolId)
    if (!handler) throw new Error(`No internal operation registered for ${toolId}`)
    const requestedTimeout = Number(params.timeout)
    const operationTimeout =
      Number.isFinite(requestedTimeout) && requestedTimeout > 0
        ? Math.min(requestedTimeout, getMaxExecutionTimeout())
        : signal
          ? getMaxExecutionTimeout()
          : DEFAULT_EXECUTION_TIMEOUT_MS
    const operationController = createTimeoutAbortController(operationTimeout, signal)
    try {
      response = await handler({
        toolId,
        input: operationInput,
        headers,
        context,
        requestId,
        signal: operationController.signal,
      })
    } finally {
      operationController.cleanup()
    }
  }

  const responseBody = await readToolResponseBody(response, {
    requestId,
    toolId,
    signal,
    ...(privateToolMetadataType
      ? { maxBytes: MAX_TOOL_RESPONSE_BODY_BYTES + MAX_PRIVATE_TOOL_METADATA_OVERHEAD_BYTES }
      : {}),
  })
  response = new Response(new Uint8Array(responseBody), {
    status: response.status,
    statusText: response.statusText,
    headers: cloneResponseHeaders(response.headers),
  })

  const privateMetadata = await consumePrivateToolResponseMetadata(
    response,
    privateToolMetadataType,
    params,
    resolvedSecretTraceRegistry,
    toolId
  )
  response = privateMetadata.response

  if (!response.ok) {
    let errorData: unknown
    const errorText = await response.text()
    try {
      errorData = JSON.parse(errorText)
    } catch {
      errorData = errorText
    }
    throw createTransformedErrorFromErrorInfo(
      { status: response.status, statusText: response.statusText, data: errorData },
      tool.errorExtractor
    )
  }

  if (tool.transformResponse) return tool.transformResponse(response, params)
  const responseData = await response.json()
  if (isToolResponse(responseData)) return responseData
  return {
    success: true,
    output:
      isRecordLike(responseData) && isRecordLike(responseData.output)
        ? responseData.output
        : (responseData as Record<string, any>),
  }
}

/** Executes one external tool request with DNS validation and IP pinning. */
async function executeToolRequest(
  toolId: string,
  tool: ToolConfig,
  params: Record<string, any>,
  signal?: AbortSignal,
  resolvedSecretTraceRegistry?: ResolvedSecretTraceRegistry
): Promise<ToolResponse> {
  const requestId = generateRequestId()
  const structuralOnlyToolLogs = false
  try {
    const requestParams = prepareToolRequest(tool, params, resolvedSecretTraceRegistry)
    const { headers } = requestParams
    const fullUrl = new URL(requestParams.url).toString()
    const targetsThisSimInstance = isSelfOriginUrl(fullUrl)

    if (targetsThisSimInstance && tool.request.allowSameOrigin !== true) {
      throw new Error(SAME_ORIGIN_EXTERNAL_TOOL_ERROR_MESSAGE)
    }

    if (targetsThisSimInstance) {
      const callChain = params._context?.callChain as string[] | undefined
      if (callChain && callChain.length > 0) {
        headers.set(SIM_VIA_HEADER, serializeCallChain(callChain))
      }
    }

    // Check request body size before sending to detect potential size limit issues
    validateRequestBodySize(requestParams.body, requestId, toolId)

    // Convert Headers to plain object for secureFetchWithPinnedIP
    const headersRecord: Record<string, string> = {}
    headers.forEach((value, key) => {
      headersRecord[key] = value
    })

    const retryConfig = getRetryConfig(tool.request.retry, params, requestParams.method)
    const maxAttempts = retryConfig ? 1 + retryConfig.maxRetries : 1

    let response: Response | undefined
    let lastError: unknown
    const nullBodyStatuses = new Set([101, 204, 205, 304])

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const isLastAttempt = attempt === maxAttempts - 1

      try {
        const urlValidation = await validateUrlWithDNS(fullUrl, 'toolUrl', 'requestTarget')
        if (!urlValidation.isValid) {
          throw new Error(`Invalid tool URL: ${urlValidation.error}`)
        }

        let proxyOption: string | undefined
        if (requestParams.proxyUrl) {
          const proxyValidation = await validateAndPinProxyUrl(requestParams.proxyUrl)
          if (!proxyValidation.isValid) {
            throw new Error(`Invalid proxy URL: ${proxyValidation.error}`)
          }
          proxyOption = proxyValidation.pinnedProxyUrl
        }

        const secureResponse = await secureFetchWithPinnedIP(fullUrl, urlValidation.resolvedIP, {
          profile: 'requestTarget',
          method: requestParams.method,
          headers: headersRecord,
          body: requestParams.body ?? undefined,
          timeout: requestParams.timeout,
          maxResponseBytes: MAX_TOOL_RESPONSE_BODY_BYTES,
          signal,
          proxyUrl: proxyOption,
          stripAuthOnRedirect: requestParams.stripAuthOnRedirect,
          redirectPolicy: requestParams.redirectPolicy,
          assertRedirectTarget:
            tool.request.allowSameOrigin === true
              ? undefined
              : (redirectUrl) => {
                  if (isSelfOriginUrl(redirectUrl)) {
                    throw new Error(SAME_ORIGIN_EXTERNAL_TOOL_ERROR_MESSAGE)
                  }
                },
        })

        const responseHeaders = new Headers(secureResponse.headers.toRecord())

        if (
          nullBodyStatuses.has(secureResponse.status) ||
          shouldRetryWithoutReadingBody(
            secureResponse.status,
            responseHeaders,
            retryConfig,
            isLastAttempt
          )
        ) {
          secureResponse.body?.cancel().catch(() => {})
          response = new Response(null, {
            status: secureResponse.status,
            statusText: secureResponse.statusText,
            headers: responseHeaders,
          })
        } else {
          const bodyBuffer = await readToolResponseBody(secureResponse, {
            requestId,
            toolId,
            signal,
          })
          response = new Response(new Uint8Array(bodyBuffer), {
            status: secureResponse.status,
            statusText: secureResponse.statusText,
            headers: responseHeaders,
          })
        }
      } catch (error) {
        lastError = error
        if (signal?.aborted || !retryConfig || isLastAttempt || !isRetryableFailure(error)) {
          throw error
        }
        const delayMs = backoffWithJitter(attempt + 1, null, {
          baseMs: retryConfig.initialDelayMs,
          maxMs: retryConfig.maxDelayMs,
        })
        logger.warn(
          `[${requestId}] Retrying ${toolId} after error (attempt ${attempt + 1}/${maxAttempts})`,
          { delayMs }
        )
        await sleep(delayMs)
        continue
      }

      if (
        retryConfig &&
        !isLastAttempt &&
        response &&
        !response.ok &&
        isRetryableFailure(null, response.status)
      ) {
        const retryAfterMs = parseRetryAfter(
          response.headers.get('retry-after'),
          Number.POSITIVE_INFINITY
        )
        if (retryAfterMs !== null && retryAfterMs > retryConfig.maxDelayMs) {
          logger.warn(
            `[${requestId}] Retry-After (${retryAfterMs}ms) exceeds maxDelayMs (${retryConfig.maxDelayMs}ms), skipping retry`
          )
          break
        }
        try {
          await response.arrayBuffer()
        } catch {
          // Ignore errors when consuming body
        }
        const delayMs = backoffWithJitter(attempt + 1, retryAfterMs, {
          baseMs: retryConfig.initialDelayMs,
          maxMs: retryConfig.maxDelayMs,
        })
        logger.warn(
          `[${requestId}] Retrying ${toolId} after HTTP ${response.status} (attempt ${attempt + 1}/${maxAttempts})`,
          { delayMs }
        )
        await sleep(delayMs)
        continue
      }

      break
    }

    if (!response) {
      throw lastError ?? new Error(`Request failed for ${toolId}`)
    }

    if (!response.ok) {
      let errorData: any
      try {
        const errorText = await response.text()
        try {
          errorData = JSON.parse(errorText)
        } catch {
          errorData = errorText
        }
      } catch {
        logger.error(`[${requestId}] Failed to read response body for ${toolId}`)
        errorData = null
      }

      const errorInfo: ErrorInfo = {
        status: response.status,
        statusText: response.statusText,
        data: errorData,
      }

      const errorToTransform = createTransformedErrorFromErrorInfo(errorInfo, tool.errorExtractor)
      const hasStructuredErrorPayload =
        isRecordLike(errorData) && ('error' in errorData || 'message' in errorData)

      if (response.status === 413 && !hasStructuredErrorPayload) {
        logger.error(
          `[${requestId}] Request body too large for ${toolId} (HTTP 413):`,
          projectToolLogMetadata(
            {
              status: response.status,
              statusText: response.statusText,
              errorData,
            },
            resolvedSecretTraceRegistry,
            {
              status: response.status,
              statusText: response.statusText,
              hasErrorData: errorData !== null,
            },
            structuralOnlyToolLogs
          )
        )
        throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
      }

      logger.error(
        `[${requestId}] External tool error for ${toolId}:`,
        projectToolLogMetadata(
          {
            status: errorInfo.status,
            errorData: errorInfo.data,
          },
          resolvedSecretTraceRegistry,
          {
            status: errorInfo.status,
            hasErrorData: errorInfo.data !== null,
          },
          structuralOnlyToolLogs
        )
      )

      throw errorToTransform
    }

    let responseData
    const status = response.status
    if (status === 202 || status === 204 || status === 205) {
      responseData = { status }
    } else {
      if (tool.transformResponse) {
        responseData = null
      } else {
        try {
          responseData = await response.json()
        } catch (jsonError) {
          const normalizedError = toError(jsonError)
          logger.error(
            `[${requestId}] JSON parse error for ${toolId}:`,
            projectToolLogMetadata(
              { error: normalizedError.message },
              resolvedSecretTraceRegistry,
              { errorName: normalizedError.name },
              structuralOnlyToolLogs
            )
          )
          throw new Error(`Failed to parse response from ${toolId}: ${jsonError}`)
        }
      }
    }

    // Check for error conditions
    const { isError, errorInfo } = isErrorResponse(response, responseData)

    if (isError) {
      // Handle error case
      const errorToTransform = createTransformedErrorFromErrorInfo(errorInfo, tool.errorExtractor)

      logger.error(
        `[${requestId}] External tool error for ${toolId}:`,
        projectToolLogMetadata(
          {
            status: errorInfo?.status,
            errorData: errorInfo?.data,
          },
          resolvedSecretTraceRegistry,
          {
            status: errorInfo?.status,
            hasErrorData: errorInfo?.data !== null && errorInfo?.data !== undefined,
          },
          structuralOnlyToolLogs
        )
      )

      throw errorToTransform
    }

    // Success case: use transformResponse if available
    if (tool.transformResponse) {
      try {
        // Forward the real body stream. Some transformResponse helpers (e.g. TikTok)
        // read via readResponseTextWithLimit, which requires `.body` (or Content-Length)
        // and otherwise mis-reports a false "response exceeded maximum size" error.
        const mockResponse = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          url: fullUrl,
          body: response.body,
          json: () => response.json(),
          text: () => response.text(),
          arrayBuffer: () => response.arrayBuffer(),
          blob: () => response.blob(),
        } as Response

        const data = await tool.transformResponse(mockResponse, params)
        return data
      } catch (transformError) {
        const normalizedError = toError(transformError)
        logger.error(
          `[${requestId}] Transform response error for ${toolId}:`,
          projectToolLogMetadata(
            { error: normalizedError.message },
            resolvedSecretTraceRegistry,
            {
              errorName: normalizedError.name,
            },
            structuralOnlyToolLogs
          )
        )
        throw transformError
      }
    }

    // Default success response handling
    return {
      success: true,
      output: responseData.output || responseData,
      error: undefined,
    }
  } catch (error: any) {
    handleResponseSizeLimitError(error, requestId, toolId)

    // Check if this is a body size limit error and throw user-friendly message
    handleBodySizeLimitError(
      error,
      requestId,
      toolId,
      resolvedSecretTraceRegistry,
      structuralOnlyToolLogs
    )

    const normalizedError = toError(error)
    logger.error(
      `[${requestId}] External request error for ${toolId}:`,
      projectToolLogMetadata(
        { error: normalizedError.message },
        resolvedSecretTraceRegistry,
        {
          errorName: normalizedError.name,
        },
        structuralOnlyToolLogs
      )
    )

    // Let the error bubble up to be handled in the main executeTool function
    throw error
  }
}

/**
 * Validates parameters on the client side before sending to the execute endpoint
 */
function validateClientSideParams(
  params: Record<string, any>,
  schema: {
    type: string
    properties: Record<string, any>
    required?: string[]
  }
) {
  if (!schema || schema.type !== 'object') {
    throw new Error('Invalid schema format')
  }

  // Internal parameters that should be excluded from validation
  const internalParamSet = new Set([
    '_context',
    '_toolSchema',
    'workflowId',
    'envVars',
    'workflowVariables',
    'blockData',
    'blockNameMapping',
  ])

  // Check required parameters
  if (schema.required) {
    for (const requiredParam of schema.required) {
      if (!(requiredParam in params)) {
        throw new Error(`Required parameter missing: ${requiredParam}`)
      }
    }
  }

  // Check parameter types (basic validation)
  for (const [paramName, paramValue] of Object.entries(params)) {
    // Skip validation for internal parameters
    if (internalParamSet.has(paramName)) {
      continue
    }

    const paramSchema = schema.properties[paramName]
    if (!paramSchema) {
      throw new Error(`Unknown parameter: ${paramName}`)
    }

    // Basic type checking
    const type = paramSchema.type
    if (type === 'string' && typeof paramValue !== 'string') {
      throw new Error(`Parameter ${paramName} should be a string`)
    }
    if (type === 'number' && typeof paramValue !== 'number') {
      throw new Error(`Parameter ${paramName} should be a number`)
    }
    if (type === 'boolean' && typeof paramValue !== 'boolean') {
      throw new Error(`Parameter ${paramName} should be a boolean`)
    }
    if (type === 'array' && !Array.isArray(paramValue)) {
      throw new Error(`Parameter ${paramName} should be an array`)
    }
    if (type === 'object' && (typeof paramValue !== 'object' || paramValue === null)) {
      throw new Error(`Parameter ${paramName} should be an object`)
    }
  }
}

/**
 * Execute a dynamic MCP tool through the in-process operation registry.
 *
 * @param toolId - MCP tool ID in format "mcp-serverId-toolName"
 * @param params - Tool parameters
 * @param context - Trusted operation context
 * @param requestId - Request ID for logging
 * @param startTimeISO - Start time for timing
 */
async function executeMcpTool(
  toolId: string,
  params: Record<string, any>,
  context?: InternalToolOperationContext,
  requestId?: string,
  startTimeISO?: string,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const actualRequestId = requestId || generateRequestId()
  const actualStartTime = startTimeISO || new Date().toISOString()

  try {
    logger.info(`[${actualRequestId}] Executing MCP tool: ${toolId}`)
    validateRequestBodySize(JSON.stringify(params), actualRequestId, `mcp:${toolId}`)
    const handler = await getInternalToolOperationHandler(toolId)
    if (!handler) throw new Error(`No internal operation registered for ${toolId}`)
    const response = await handler({
      toolId,
      input: params,
      headers: new Headers(),
      context: context ?? { workflowId: '' },
      requestId: actualRequestId,
      signal,
    })
    const responseBody = await readToolResponseBody(response, {
      requestId: actualRequestId,
      toolId,
      signal,
    })
    const result = JSON.parse(responseBody.toString('utf8')) as {
      success?: boolean
      data?: { output?: Record<string, unknown> }
      output?: Record<string, unknown>
      error?: string
    }

    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - new Date(actualStartTime).getTime()

    if (!response.ok) {
      if (response.status === 413) {
        logger.error(`[${actualRequestId}] Request body too large for mcp:${toolId} (HTTP 413)`)
        return {
          success: false,
          output: {},
          error: BODY_SIZE_LIMIT_ERROR_MESSAGE,
          timing: {
            startTime: actualStartTime,
            endTime: endTimeISO,
            duration,
          },
        }
      }

      const errorMessage =
        result.error || `MCP tool execution failed: ${response.status} ${response.statusText}`

      return {
        success: false,
        output: {},
        error: errorMessage,
        timing: {
          startTime: actualStartTime,
          endTime: endTimeISO,
          duration,
        },
      }
    }

    if (!result.success) {
      return {
        success: false,
        output: {},
        error: result.error || 'MCP tool execution failed',
        timing: {
          startTime: actualStartTime,
          endTime: endTimeISO,
          duration,
        },
      }
    }

    logger.info(`[${actualRequestId}] MCP tool ${toolId} executed successfully`)

    return {
      success: true,
      output: result.data?.output || result.output || result.data || {},
      timing: {
        startTime: actualStartTime,
        endTime: endTimeISO,
        duration,
      },
    }
  } catch (error) {
    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - new Date(actualStartTime).getTime()

    const errorMsg = toError(error).message
    if (isBodySizeLimitError(errorMsg)) {
      logger.error(
        `[${actualRequestId}] Request body size limit exceeded for mcp:${toolId}:`,
        projectToolLogMetadata({ originalError: errorMsg }, context?.resolvedSecretTraceRegistry, {
          hasOriginalError: errorMsg.length > 0,
        })
      )
      return {
        success: false,
        output: {},
        error: BODY_SIZE_LIMIT_ERROR_MESSAGE,
        timing: {
          startTime: actualStartTime,
          endTime: endTimeISO,
          duration,
        },
      }
    }

    const normalizedError = toError(error)
    logger.error(
      `[${actualRequestId}] Error executing MCP tool ${toolId}:`,
      projectToolLogMetadata(
        {
          error: normalizedError.message,
          stack: error instanceof Error ? error.stack : undefined,
        },
        context?.resolvedSecretTraceRegistry,
        {
          errorName: normalizedError.name,
          hasStack: Boolean(error instanceof Error && error.stack),
        }
      )
    )

    const errorMessage = getErrorMessage(error, `Failed to execute MCP tool ${toolId}`)

    return {
      success: false,
      output: {},
      error: errorMessage,
      timing: {
        startTime: actualStartTime,
        endTime: endTimeISO,
        duration,
      },
    }
  }
}
