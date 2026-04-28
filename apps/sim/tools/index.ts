import { createLogger } from '@sim/logger'
import { toError } from '@sim/utils/errors'
import { sleep } from '@sim/utils/helpers'
import { getBYOKKey } from '@/lib/api-key/byok'
import { generateInternalToken } from '@/lib/auth/internal'
import { isHosted } from '@/lib/core/config/feature-flags'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/core/execution-limits'
import { getHostedKeyRateLimiter } from '@/lib/core/rate-limiter'
import {
  secureFetchWithPinnedIP,
  validateUrlWithDNS,
} from '@/lib/core/security/input-validation.server'
import { PlatformEvents } from '@/lib/core/telemetry'
import { generateRequestId } from '@/lib/core/utils/request'
import { getBaseUrl, getInternalApiBaseUrl } from '@/lib/core/utils/urls'
import { isUserFile } from '@/lib/core/utils/user-file'
import { SIM_VIA_HEADER, serializeCallChain } from '@/lib/execution/call-chain'
import { parseMcpToolId } from '@/lib/mcp/utils'
import { resolveWorkspaceFileReference } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { assertPermissionsAllowed } from '@/ee/access-control/utils/permission-check'
import { isCustomTool, isMcpTool } from '@/executor/constants'
import { resolveSkillContent } from '@/executor/handlers/agent/skills-resolver'
import type { ExecutionContext, UserFile } from '@/executor/types'
import type { ErrorInfo } from '@/tools/error-extractors'
import { extractErrorMessage } from '@/tools/error-extractors'
import type {
  BYOKProviderId,
  OAuthTokenPayload,
  ToolConfig,
  ToolHostingPricing,
  ToolResponse,
  ToolRetryConfig,
} from '@/tools/types'
import { formatRequestParams, getTool, validateRequiredParametersAfterMerge } from '@/tools/utils'
import * as toolsUtilsServer from '@/tools/utils.server'

const logger = createLogger('Tools')

interface ToolExecutionScope {
  workspaceId?: string
  workflowId?: string
  userId?: string
  executionId?: string
  callChain?: string[]
  isDeployedContext?: boolean
  enforceCredentialAccess?: boolean
  copilotToolExecution?: boolean
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

async function resolveCopilotFileReference(
  value: unknown,
  workspaceId: string,
  paramId: string
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

  const fileRecord = await resolveWorkspaceFileReference(workspaceId, referenceId)
  if (!fileRecord) {
    throw new Error(
      `Could not resolve workspace file reference "${referenceId}" for parameter "${paramId}"`
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

async function normalizeCopilotFileParams(
  tool: ToolConfig,
  params: Record<string, unknown>,
  scope: ToolExecutionScope
): Promise<void> {
  if (!scope.copilotToolExecution) {
    return
  }

  for (const [paramId, paramDef] of Object.entries(tool.params || {})) {
    const paramType = paramDef?.type
    const currentValue = params[paramId]
    if (currentValue === undefined || currentValue === null) {
      continue
    }

    if (paramType === 'file') {
      if (!scope.workspaceId) {
        throw new Error(`Missing workspaceId while resolving file parameter "${paramId}"`)
      }
      params[paramId] = await resolveCopilotFileReference(currentValue, scope.workspaceId, paramId)
      continue
    }

    if (paramType === 'file[]') {
      if (!scope.workspaceId) {
        throw new Error(`Missing workspaceId while resolving file parameter "${paramId}"`)
      }

      const values = Array.isArray(currentValue) ? currentValue : [currentValue]
      params[paramId] = await Promise.all(
        values.map((item) => resolveCopilotFileReference(item, scope.workspaceId!, paramId))
      )
    }
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
  tool: ToolConfig,
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
  tool: ToolConfig,
  params: Record<string, unknown>,
  executionContext: ExecutionContext | undefined,
  requestId: string
): Promise<HostedKeyInjectionResult> {
  if (!tool.hosting) return { isUsingHostedKey: false }
  if (!isHosted) return { isUsingHostedKey: false }

  const { envKeyPrefix, apiKeyParam, byokProviderId, rateLimit } = tool.hosting

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
    billingActorId
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

    const error = new Error(acquireResult.error || `Rate limit exceeded for ${tool.id}`)
    ;(error as any).status = 429
    ;(error as any).retryAfterMs = acquireResult.retryAfterMs
    throw error
  }

  // Handle no keys configured (503)
  if (!acquireResult.success) {
    logger.error(`[${requestId}] No hosted keys configured for ${tool.id}: ${acquireResult.error}`)
    const error = new Error(acquireResult.error || `No hosted keys configured for ${tool.id}`)
    ;(error as any).status = 503
    throw error
  }

  params[apiKeyParam] = acquireResult.key
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

/** Context for retry with rate limit tracking */
interface RetryContext {
  requestId: string
  toolId: string
  envVarName: string
  executionContext?: ExecutionContext
}

/**
 * Execute a function with exponential backoff retry for rate limiting errors.
 * Only used for hosted key requests. Tracks rate limit events via telemetry.
 */
async function executeWithRetry<T>(
  fn: () => Promise<T>,
  context: RetryContext,
  maxRetries = 3,
  baseDelayMs = 1000
): Promise<T> {
  const { requestId, toolId, envVarName, executionContext } = context
  let lastError: unknown

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn()
    } catch (error) {
      lastError = error

      if (!isRateLimitError(error) || attempt === maxRetries) {
        if (isRateLimitError(error) && attempt === maxRetries) {
          PlatformEvents.hostedKeyUserThrottled({
            toolId,
            reason: 'upstream_retries_exhausted',
            userId: executionContext?.userId,
            workspaceId: executionContext?.workspaceId,
            workflowId: executionContext?.workflowId,
          })
        }
        throw error
      }

      const delayMs = baseDelayMs * 2 ** attempt

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
 * Calculate cost based on pricing model
 */
function calculateToolCost(
  pricing: ToolHostingPricing,
  params: Record<string, unknown>,
  response: Record<string, unknown>
): ToolCostResult {
  switch (pricing.type) {
    case 'per_request':
      return { cost: pricing.cost }

    case 'custom': {
      const result = pricing.getCost(params, response)
      if (typeof result === 'number') {
        return { cost: result }
      }
      return result
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
 * Calculate and log hosted key cost for a tool execution.
 * Logs to usageLog for audit trail and returns cost + metadata for output.
 */
async function processHostedKeyCost(
  tool: ToolConfig,
  params: Record<string, unknown>,
  response: Record<string, unknown>,
  executionContext: ExecutionContext | undefined,
  requestId: string
): Promise<HostedKeyCostResult> {
  if (!tool.hosting?.pricing) {
    return { cost: 0 }
  }

  const { cost, metadata } = calculateToolCost(tool.hosting.pricing, params, response)

  if (cost <= 0) return { cost: 0 }

  const { userId } = resolveToolScope(params, executionContext)

  if (!userId) return { cost, metadata }

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
  tool: ToolConfig,
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
 */
async function applyHostedKeyCostToResult(
  finalResult: ToolResponse,
  tool: ToolConfig,
  params: Record<string, unknown>,
  executionContext: ExecutionContext | undefined,
  requestId: string
): Promise<void> {
  await reportCustomDimensionUsage(tool, params, finalResult.output, executionContext, requestId)

  const { cost: hostedKeyCost, metadata } = await processHostedKeyCost(
    tool,
    params,
    finalResult.output,
    executionContext,
    requestId
  )
  if (hostedKeyCost > 0) {
    finalResult.output = {
      ...finalResult.output,
      cost: {
        ...metadata,
        total: hostedKeyCost,
      },
    }
  }
}

/**
 * Normalizes a tool ID by stripping resource ID suffix (UUID/tableId).
 * Workflow tools: 'workflow_executor_<uuid>' -> 'workflow_executor'
 * Knowledge tools: 'knowledge_search_<uuid>' -> 'knowledge_search'
 * Table tools: 'table_query_rows_<tableId>' -> 'table_query_rows'
 */
function normalizeToolId(toolId: string): string {
  if (toolId.startsWith('workflow_executor_') && toolId.length > 'workflow_executor_'.length) {
    return 'workflow_executor'
  }

  const knowledgeOps = ['knowledge_search', 'knowledge_upload_chunk', 'knowledge_create_document']
  for (const op of knowledgeOps) {
    if (toolId.startsWith(`${op}_`) && toolId.length > op.length + 1) {
      return op
    }
  }

  const tableOps = [
    'table_query_rows',
    'table_insert_row',
    'table_batch_insert_rows',
    'table_update_row',
    'table_update_rows_by_filter',
    'table_delete_rows_by_filter',
    'table_upsert_row',
    'table_get_row',
    'table_delete_row',
    'table_get_schema',
  ]
  for (const op of tableOps) {
    if (toolId.startsWith(`${op}_`) && toolId.length > op.length + 1) {
      return op
    }
  }

  return toolId
}

/**
 * Maximum request body size in bytes before we warn/error about size limits.
 * Next.js 16 has a default middleware/proxy body limit of 10MB.
 */
const MAX_REQUEST_BODY_SIZE_BYTES = 10 * 1024 * 1024 // 10MB

/**
 * User-friendly error message for body size limit exceeded
 */
const BODY_SIZE_LIMIT_ERROR_MESSAGE =
  'Request body size limit exceeded (10MB). The workflow data is too large to process. Try reducing the size of variables, inputs, or data being passed between blocks.'

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
function handleBodySizeLimitError(error: unknown, requestId: string, context: string): boolean {
  const errorMessage = toError(error).message

  if (isBodySizeLimitError(errorMessage)) {
    logger.error(`[${requestId}] Request body size limit exceeded for ${context}:`, {
      originalError: errorMessage,
    })
    throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
  }

  return false
}

/**
 * System parameters that should be filtered out when extracting tool arguments
 * These are internal parameters used by the execution framework, not tool inputs
 */
const MCP_SYSTEM_PARAMETERS = new Set([
  'serverId',
  'serverUrl',
  'toolName',
  'serverName',
  '_context',
  'envVars',
  'workflowVariables',
  'blockData',
  'blockNameMapping',
  '_toolSchema',
])

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
    data: errorInfo?.data,
  })
  return transformed
}

/**
 * Process file outputs for a tool result if execution context is available
 * Uses dynamic imports to avoid client-side bundling issues
 */
async function processFileOutputs(
  result: ToolResponse,
  tool: ToolConfig,
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

    return {
      ...result,
      output: processedOutput,
    }
  } catch (error) {
    logger.error(`Error processing file outputs for tool ${tool.id}:`, error)
    // Return original result if file processing fails
    return result
  }
}

/**
 * Execute a tool by making the appropriate HTTP request
 * All requests go directly - internal routes use regular fetch, external use SSRF-protected fetch
 */
export async function executeTool(
  toolId: string,
  params: Record<string, any>,
  skipPostProcess = false,
  executionContext?: ExecutionContext
): Promise<ToolResponse> {
  // Capture start time for precise timing
  const startTime = new Date()
  const startTimeISO = startTime.toISOString()
  const requestId = generateRequestId()

  try {
    let tool: ToolConfig | undefined

    // Normalize tool ID to strip resource suffixes (e.g., workflow_executor_<uuid> -> workflow_executor)
    const normalizedToolId = normalizeToolId(toolId)

    const scope = resolveToolScope(params, executionContext)

    const toolKind: 'skill' | 'custom' | 'mcp' | undefined =
      normalizedToolId === 'load_skill'
        ? 'skill'
        : isCustomTool(normalizedToolId)
          ? 'custom'
          : isMcpTool(normalizedToolId)
            ? 'mcp'
            : undefined

    if (toolKind && scope.userId && scope.workspaceId) {
      await assertPermissionsAllowed({
        userId: scope.userId,
        workspaceId: scope.workspaceId,
        toolKind,
        ctx: executionContext,
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
      tool = await toolsUtilsServer.getToolAsync(normalizedToolId, {
        workflowId: scope.workflowId,
        userId: scope.userId,
        workspaceId: scope.workspaceId,
      })
      if (!tool) {
        logger.error(`[${requestId}] Custom tool not found: ${normalizedToolId}`)
      }
    } else if (isMcpTool(normalizedToolId)) {
      return await executeMcpTool(
        normalizedToolId,
        params,
        executionContext,
        requestId,
        startTimeISO
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

    // Validate the tool and its parameters
    validateRequiredParametersAfterMerge(toolId, tool, contextParams)

    // After validation, we know tool exists
    if (!tool) {
      throw new Error(`Tool not found: ${toolId}`)
    }

    await normalizeCopilotFileParams(tool, contextParams, scope)
    normalizeCopilotCredentialParams(contextParams)
    enforceCopilotCredentialSelection(toolId, tool, contextParams, scope)

    // Inject hosted API key if tool supports it and user didn't provide one
    const hostedKeyInfo = await injectHostedKeyIfNeeded(
      tool,
      contextParams,
      executionContext,
      requestId
    )

    // If we have a credential parameter, fetch the access token
    if (contextParams.oauthCredential) {
      contextParams.credential = contextParams.oauthCredential
    }
    if (contextParams.credential) {
      logger.info(
        `[${requestId}] Tool ${toolId} needs access token for credential: ${contextParams.credential}`
      )
      try {
        const baseUrl = getInternalApiBaseUrl()

        const workflowId = contextParams._context?.workflowId
        const userId = contextParams._context?.userId

        const tokenPayload: OAuthTokenPayload = {
          credentialId: contextParams.credential as string,
        }
        if (workflowId) {
          tokenPayload.workflowId = workflowId
        }
        if (contextParams.impersonateUserEmail) {
          tokenPayload.impersonateEmail = contextParams.impersonateUserEmail as string
        }
        if (tool?.oauth?.provider) {
          const { getCanonicalScopesForProvider } = await import('@/lib/oauth/utils')
          const providerScopes = getCanonicalScopesForProvider(tool.oauth.provider)
          if (providerScopes.length > 0) {
            tokenPayload.scopes = providerScopes
          }
        }

        logger.info(`[${requestId}] Fetching access token from ${baseUrl}/api/auth/oauth/token`)

        const tokenUrlObj = new URL('/api/auth/oauth/token', baseUrl)
        if (workflowId) {
          tokenUrlObj.searchParams.set('workflowId', workflowId)
        }
        if (userId && contextParams._context?.enforceCredentialAccess) {
          tokenUrlObj.searchParams.set('userId', userId)
        }

        // Always send Content-Type; add internal auth on server-side runs
        const tokenHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
        if (typeof window === 'undefined') {
          try {
            const internalToken = await generateInternalToken(userId)
            tokenHeaders.Authorization = `Bearer ${internalToken}`
          } catch (_e) {
            // Swallow token generation errors; the request will fail and be reported upstream
          }
        }

        const response = await fetch(tokenUrlObj.toString(), {
          method: 'POST',
          headers: tokenHeaders,
          body: JSON.stringify(tokenPayload),
        })

        if (!response.ok) {
          const errorText = await response.text()
          logger.error(`[${requestId}] Token fetch failed for ${toolId}:`, {
            status: response.status,
            error: errorText,
          })
          let parsedError = errorText
          try {
            const parsed = JSON.parse(errorText)
            if (parsed.error) parsedError = parsed.error
          } catch {
            // Use raw text
          }
          const toolLabel = tool?.name || toolId
          throw new Error(`Failed to obtain credential for ${toolLabel}: ${parsedError}`)
        }

        const data = await response.json()
        contextParams.accessToken = data.accessToken
        if (data.idToken) {
          contextParams.idToken = data.idToken
        }
        if (data.instanceUrl) {
          contextParams.instanceUrl = data.instanceUrl
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

    // Check for direct execution (no HTTP request needed)
    if (tool.directExecution) {
      logger.info(`[${requestId}] Using directExecution for ${toolId}`)
      const result = await tool.directExecution(contextParams)

      // Apply post-processing if available and not skipped
      let finalResult = result
      if (tool.postProcess && result.success && !skipPostProcess) {
        try {
          finalResult = await tool.postProcess(result, contextParams, executeTool)
        } catch (error) {
          logger.error(`[${requestId}] Post-processing error for ${toolId}:`, {
            error: toError(error).message,
          })
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
          requestId
        )
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
    }

    // Execute the tool request directly (internal routes use regular fetch, external use SSRF-protected fetch)
    // Wrap with retry logic for hosted keys to handle rate limiting due to higher usage
    const result = hostedKeyInfo.isUsingHostedKey
      ? await executeWithRetry(() => executeToolRequest(toolId, tool, contextParams), {
          requestId,
          toolId,
          envVarName: hostedKeyInfo.envVarName!,
          executionContext,
        })
      : await executeToolRequest(toolId, tool, contextParams)

    // Apply post-processing if available and not skipped
    let finalResult = result
    if (tool.postProcess && result.success && !skipPostProcess) {
      try {
        finalResult = await tool.postProcess(result, contextParams, executeTool)
      } catch (error) {
        logger.error(`[${requestId}] Post-processing error for ${toolId}:`, {
          error: toError(error).message,
        })
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
        requestId
      )
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
    logger.error(`[${requestId}] Error executing tool ${toolId}:`, {
      error: toError(error).message,
      stack: error instanceof Error ? error.stack : undefined,
    })

    // Default error handling
    let errorMessage = 'Unknown error occurred'
    let errorDetails = {}

    if (error instanceof Error) {
      errorMessage = error.message || `Error executing tool ${toolId}`
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
    return {
      success: false,
      output: errorDetails,
      error: errorMessage,
      timing: {
        startTime: startTimeISO,
        endTime: endTimeISO,
        duration,
      },
    }
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
 * Used to propagate cycle-detection headers on API blocks that target
 * the platform's own workflow execution endpoints via absolute URL.
 */
function isSelfOriginUrl(url: string): boolean {
  try {
    const targetOrigin = new URL(url).origin
    const publicOrigin = new URL(getBaseUrl()).origin
    if (targetOrigin === publicOrigin) return true

    const internalOrigin = new URL(getInternalApiBaseUrl()).origin
    if (targetOrigin === internalOrigin) return true
  } catch {
    return false
  }
  return false
}

/**
 * Add internal authentication token to headers if running on server
 * @param headers - Headers object to modify
 * @param isInternalRoute - Whether the target URL is an internal route
 * @param requestId - Request ID for logging
 * @param context - Context string for logging (e.g., toolId or 'proxy')
 */
async function addInternalAuthIfNeeded(
  headers: Headers | Record<string, string>,
  isInternalRoute: boolean,
  requestId: string,
  context: string,
  userId?: string
): Promise<void> {
  if (typeof window === 'undefined') {
    if (isInternalRoute) {
      try {
        const internalToken = await generateInternalToken(userId)
        if (headers instanceof Headers) {
          headers.set('Authorization', `Bearer ${internalToken}`)
        } else {
          headers.Authorization = `Bearer ${internalToken}`
        }
        logger.info(`[${requestId}] Added internal auth token for ${context}`)
      } catch (error) {
        logger.error(`[${requestId}] Failed to generate internal token for ${context}:`, error)
      }
    } else {
      logger.info(`[${requestId}] Skipping internal auth token for external URL: ${context}`)
    }
  }
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

function calculateBackoff(attempt: number, initialDelayMs: number, maxDelayMs: number): number {
  const base = Math.min(initialDelayMs * 2 ** attempt, maxDelayMs)
  return Math.round(base / 2 + Math.random() * (base / 2))
}

function parseRetryAfterHeader(header: string | null): number {
  if (!header) return 0
  const trimmed = header.trim()
  if (/^\d+$/.test(trimmed)) {
    const seconds = Number.parseInt(trimmed, 10)
    return seconds > 0 ? seconds * 1000 : 0
  }
  const date = new Date(trimmed)
  if (!Number.isNaN(date.getTime())) {
    const deltaMs = date.getTime() - Date.now()
    return deltaMs > 0 ? deltaMs : 0
  }
  return 0
}

/**
 * Execute a tool request directly
 * Internal routes (/api/...) use regular fetch
 * External URLs use SSRF-protected fetch with DNS validation and IP pinning
 */
async function executeToolRequest(
  toolId: string,
  tool: ToolConfig,
  params: Record<string, any>
): Promise<ToolResponse> {
  const requestId = generateRequestId()

  const requestParams = formatRequestParams(tool, params)

  try {
    const endpointUrl =
      typeof tool.request.url === 'function' ? tool.request.url(params) : tool.request.url
    const isInternalRoute = endpointUrl.startsWith('/api/')
    const baseUrl = isInternalRoute ? getInternalApiBaseUrl() : getBaseUrl()

    const fullUrlObj = new URL(endpointUrl, baseUrl)

    if (isInternalRoute) {
      const workflowId = params._context?.workflowId
      if (workflowId) {
        fullUrlObj.searchParams.set('workflowId', workflowId)
      }
      const userId = params._context?.userId
      if (userId) {
        fullUrlObj.searchParams.set('userId', userId)
      }
    }

    const fullUrl = fullUrlObj.toString()

    if (isCustomTool(toolId) && tool.request.body) {
      const requestBody = tool.request.body(params)
      if (
        typeof requestBody === 'object' &&
        requestBody !== null &&
        'schema' in requestBody &&
        'params' in requestBody
      ) {
        try {
          validateClientSideParams(
            requestBody.params as Record<string, any>,
            requestBody.schema as {
              type: string
              properties: Record<string, any>
              required?: string[]
            }
          )
        } catch (validationError) {
          logger.error(`[${requestId}] Custom tool validation failed for ${toolId}:`, {
            error: toError(validationError).message,
          })
          throw validationError
        }
      }
    }

    const headers = new Headers(requestParams.headers)
    await addInternalAuthIfNeeded(
      headers,
      isInternalRoute,
      requestId,
      toolId,
      params._context?.userId
    )

    const shouldPropagateCallChain = isInternalRoute || isSelfOriginUrl(fullUrl)
    if (shouldPropagateCallChain) {
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

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      const isLastAttempt = attempt === maxAttempts - 1

      try {
        if (isInternalRoute) {
          const controller = new AbortController()
          const timeout = requestParams.timeout || DEFAULT_EXECUTION_TIMEOUT_MS
          const timeoutId = setTimeout(
            () => controller.abort(`timeout:internal_tool_fetch:${timeout}ms`),
            timeout
          )

          try {
            response = await fetch(fullUrl, {
              method: requestParams.method,
              headers: headers,
              body: requestParams.body,
              signal: controller.signal,
            })
          } catch (error) {
            if (error instanceof Error && error.name === 'AbortError') {
              throw new Error(`Request timed out after ${timeout}ms`)
            }
            throw error
          } finally {
            clearTimeout(timeoutId)
          }
        } else {
          const urlValidation = await validateUrlWithDNS(fullUrl, 'toolUrl')
          if (!urlValidation.isValid) {
            throw new Error(`Invalid tool URL: ${urlValidation.error}`)
          }

          const secureResponse = await secureFetchWithPinnedIP(fullUrl, urlValidation.resolvedIP!, {
            method: requestParams.method,
            headers: headersRecord,
            body: requestParams.body ?? undefined,
            timeout: requestParams.timeout,
          })

          const responseHeaders = new Headers(secureResponse.headers.toRecord())
          const nullBodyStatuses = new Set([101, 204, 205, 304])

          if (nullBodyStatuses.has(secureResponse.status)) {
            response = new Response(null, {
              status: secureResponse.status,
              statusText: secureResponse.statusText,
              headers: responseHeaders,
            })
          } else {
            const bodyBuffer = await secureResponse.arrayBuffer()
            response = new Response(bodyBuffer, {
              status: secureResponse.status,
              statusText: secureResponse.statusText,
              headers: responseHeaders,
            })
          }
        }
      } catch (error) {
        lastError = error
        if (!retryConfig || isLastAttempt || !isRetryableFailure(error)) {
          throw error
        }
        const delayMs = calculateBackoff(
          attempt,
          retryConfig.initialDelayMs,
          retryConfig.maxDelayMs
        )
        logger.warn(
          `[${requestId}] Retrying ${toolId} after error (attempt ${attempt + 1}/${maxAttempts})`,
          { delayMs }
        )
        await new Promise((r) => setTimeout(r, delayMs))
        continue
      }

      if (
        retryConfig &&
        !isLastAttempt &&
        response &&
        !response.ok &&
        isRetryableFailure(null, response.status)
      ) {
        const retryAfterMs = parseRetryAfterHeader(response.headers.get('retry-after'))
        if (retryAfterMs > retryConfig.maxDelayMs) {
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
        const backoffMs = calculateBackoff(
          attempt,
          retryConfig.initialDelayMs,
          retryConfig.maxDelayMs
        )
        const delayMs = Math.max(backoffMs, retryAfterMs)
        logger.warn(
          `[${requestId}] Retrying ${toolId} after HTTP ${response.status} (attempt ${attempt + 1}/${maxAttempts})`,
          { delayMs }
        )
        await new Promise((r) => setTimeout(r, delayMs))
        continue
      }

      break
    }

    if (!response) {
      throw lastError ?? new Error(`Request failed for ${toolId}`)
    }

    // For non-OK responses, attempt JSON first; if parsing fails, fall back to text
    if (!response.ok) {
      // Check for 413 (Entity Too Large) - body size limit exceeded
      if (response.status === 413) {
        logger.error(`[${requestId}] Request body too large for ${toolId} (HTTP 413):`, {
          status: response.status,
          statusText: response.statusText,
        })
        throw new Error(BODY_SIZE_LIMIT_ERROR_MESSAGE)
      }

      let errorData: any
      try {
        errorData = await response.json()
      } catch (jsonError) {
        // JSON parsing failed, fall back to reading as text for error extraction
        logger.warn(`[${requestId}] Response is not JSON for ${toolId}, reading as text`)
        try {
          errorData = await response.text()
        } catch (textError) {
          logger.error(`[${requestId}] Failed to read response body for ${toolId}`)
          errorData = null
        }
      }

      const errorInfo: ErrorInfo = {
        status: response.status,
        statusText: response.statusText,
        data: errorData,
      }

      const errorToTransform = createTransformedErrorFromErrorInfo(errorInfo, tool.errorExtractor)

      logger.error(`[${requestId}] Internal API error for ${toolId}:`, {
        status: errorInfo.status,
        errorData: errorInfo.data,
      })

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
          logger.error(`[${requestId}] JSON parse error for ${toolId}:`, {
            error: toError(jsonError).message,
          })
          throw new Error(`Failed to parse response from ${toolId}: ${jsonError}`)
        }
      }
    }

    // Check for error conditions
    const { isError, errorInfo } = isErrorResponse(response, responseData)

    if (isError) {
      // Handle error case
      const errorToTransform = createTransformedErrorFromErrorInfo(errorInfo, tool.errorExtractor)

      logger.error(`[${requestId}] Internal API error for ${toolId}:`, {
        status: errorInfo?.status,
        errorData: errorInfo?.data,
      })

      throw errorToTransform
    }

    // Success case: use transformResponse if available
    if (tool.transformResponse) {
      try {
        // Create a mock response object that provides the methods transformResponse needs
        const mockResponse = {
          ok: response.ok,
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
          url: fullUrl,
          json: () => response.json(),
          text: () => response.text(),
          arrayBuffer: () => response.arrayBuffer(),
          blob: () => response.blob(),
        } as Response

        const data = await tool.transformResponse(mockResponse, params)
        return data
      } catch (transformError) {
        logger.error(`[${requestId}] Transform response error for ${toolId}:`, {
          error: toError(transformError).message,
        })
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
    // Check if this is a body size limit error and throw user-friendly message
    handleBodySizeLimitError(error, requestId, toolId)

    logger.error(`[${requestId}] Internal request error for ${toolId}:`, {
      error: toError(error).message,
    })

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
 * Execute an MCP tool via the server-side MCP endpoint
 *
 * @param toolId - MCP tool ID in format "mcp-serverId-toolName"
 * @param params - Tool parameters
 * @param executionContext - Execution context
 * @param requestId - Request ID for logging
 * @param startTimeISO - Start time for timing
 */
async function executeMcpTool(
  toolId: string,
  params: Record<string, any>,
  executionContext?: ExecutionContext,
  requestId?: string,
  startTimeISO?: string
): Promise<ToolResponse> {
  const actualRequestId = requestId || generateRequestId()
  const actualStartTime = startTimeISO || new Date().toISOString()

  try {
    logger.info(`[${actualRequestId}] Executing MCP tool: ${toolId}`)

    const { serverId, toolName } = parseMcpToolId(toolId)

    const baseUrl = getInternalApiBaseUrl()

    const mcpScope = resolveToolScope(params, executionContext)

    const headers: Record<string, string> = { 'Content-Type': 'application/json' }

    if (typeof window === 'undefined') {
      try {
        const internalToken = await generateInternalToken(mcpScope.userId)
        headers.Authorization = `Bearer ${internalToken}`
      } catch (error) {
        logger.error(`[${actualRequestId}] Failed to generate internal token:`, error)
      }
    }

    // Handle two different parameter structures:
    // 1. Direct MCP blocks: arguments are stored as JSON string in 'arguments' field
    // 2. Agent blocks: arguments are passed directly as top-level parameters
    let toolArguments = {}

    // First check if we have the 'arguments' field (direct MCP block usage)
    if (params.arguments) {
      if (typeof params.arguments === 'string') {
        try {
          toolArguments = JSON.parse(params.arguments)
        } catch (error) {
          logger.warn(`[${actualRequestId}] Failed to parse MCP arguments JSON:`, params.arguments)
          toolArguments = {}
        }
      } else {
        toolArguments = params.arguments
      }
    } else {
      // Agent block usage: extract MCP-specific arguments by filtering out system parameters
      toolArguments = Object.fromEntries(
        Object.entries(params).filter(([key]) => !MCP_SYSTEM_PARAMETERS.has(key))
      )
    }

    if (mcpScope.callChain && mcpScope.callChain.length > 0) {
      headers[SIM_VIA_HEADER] = serializeCallChain(mcpScope.callChain)
    }

    if (!mcpScope.workspaceId) {
      return {
        success: false,
        output: {},
        error: `Missing workspaceId in execution context for MCP tool ${toolName}`,
        timing: {
          startTime: actualStartTime,
          endTime: new Date().toISOString(),
          duration: Date.now() - new Date(actualStartTime).getTime(),
        },
      }
    }

    // Get tool schema if provided (from agent block's cached schema)
    const toolSchema = params._toolSchema

    const requestBody: Record<string, any> = {
      serverId,
      toolName,
      arguments: toolArguments,
      workflowId: mcpScope.workflowId,
      workspaceId: mcpScope.workspaceId,
    }

    // Include schema to skip discovery on execution
    if (toolSchema) {
      requestBody.toolSchema = toolSchema
    }

    const body = JSON.stringify(requestBody)

    // Check request body size before sending
    validateRequestBodySize(body, actualRequestId, `mcp:${toolId}`)

    logger.info(`[${actualRequestId}] Making MCP tool request to ${toolName} on ${serverId}`, {
      hasWorkspaceId: !!mcpScope.workspaceId,
      hasWorkflowId: !!mcpScope.workflowId,
      hasToolSchema: !!toolSchema,
    })

    const mcpUrl = new URL('/api/mcp/tools/execute', baseUrl)
    if (mcpScope.userId) {
      mcpUrl.searchParams.set('userId', mcpScope.userId)
    }

    const response = await fetch(mcpUrl.toString(), {
      method: 'POST',
      headers,
      body,
    })

    const endTime = new Date()
    const endTimeISO = endTime.toISOString()
    const duration = endTime.getTime() - new Date(actualStartTime).getTime()

    if (!response.ok) {
      // Check for 413 (Entity Too Large) - body size limit exceeded
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

      let errorMessage = `MCP tool execution failed: ${response.status} ${response.statusText}`

      try {
        const errorData = await response.json()
        if (errorData.error) {
          errorMessage = errorData.error
        }
      } catch {
        // Failed to parse error response, use default message
      }

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

    const result = await response.json()

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

    // Check if this is a body size limit error
    const errorMsg = toError(error).message
    if (isBodySizeLimitError(errorMsg)) {
      logger.error(`[${actualRequestId}] Request body size limit exceeded for mcp:${toolId}:`, {
        originalError: errorMsg,
      })
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

    logger.error(`[${actualRequestId}] Error executing MCP tool ${toolId}:`, error)

    const errorMessage =
      error instanceof Error ? error.message : `Failed to execute MCP tool ${toolId}`

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
