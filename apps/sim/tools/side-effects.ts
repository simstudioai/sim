/**
 * Where a run's side-effect policy (a dry run, or a workflow test's unmocked writes) meets a tool
 * call: `executeTool` asks {@link unsentWriteFor} about every call not declared `read` before a
 * hosted key is drawn for it, and answers an unsent one with {@link answerUnsentWrite} after
 * credentials resolve and before anything is sent.
 */
import { createLogger } from '@sim/logger'
import { isPlainRecord, toRecord } from '@sim/utils/object'
import {
  isSensitiveKey,
  REDACTED_MARKER,
  redactExactSensitiveValues,
} from '@/lib/core/security/redaction'
import { redactObjectStrings } from '@/lib/logs/execution/pii-redaction'
import { parseMcpToolArguments, RUN_CONTEXT_PARAMS } from '@/lib/mcp/tool-arguments'
import { getBlock, getBlockByToolName, getBlockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { isCustomTool } from '@/executor/constants'
import type { SideEffectPolicy, SideEffectSite } from '@/executor/execution/types'
import type { ExecutionContext } from '@/executor/types'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { stripCloneSuffixes } from '@/executor/utils/subflow-node-id-codec'
import { prepareToolRequest } from '@/tools/request-transport'
import { type ExecutableToolConfig, isInternalToolConfig, type ToolResponse } from '@/tools/types'

const logger = createLogger('ToolSideEffects')

/** The block of the executing workflow that made a tool call, from its server-set `_context`. */
function sideEffectSite(
  executionContext: ExecutionContext,
  params: Record<string, unknown>
): SideEffectSite {
  const calledFrom = toRecord(params._context).blockId
  const blockId = typeof calledFrom === 'string' ? stripCloneSuffixes(calledFrom) : null
  const block = blockId
    ? executionContext.workflow?.blocks.find((candidate) => candidate.id === blockId)
    : undefined
  return {
    workflowId: executionContext.workflowId,
    blockId,
    blockName: block?.metadata?.name ?? blockId,
    blockType: block?.metadata?.id ?? null,
  }
}

/** A write tool call the run's policy answers instead of sending. */
interface UnsentWrite {
  policy: SideEffectPolicy
  executionContext: ExecutionContext
  call: SideEffectSite & { toolId: string }
}

/**
 * The write the run's side-effect policy will not send, decided before anything is drawn for it
 * (a hosted key's rate-limit slot); null when the run has no policy or the policy sends the call.
 */
export function unsentWriteFor(input: {
  toolId: string
  params: Record<string, unknown>
  executionContext: ExecutionContext | undefined
}): UnsentWrite | null {
  const { executionContext } = input
  const policy = executionContext?.sideEffects
  if (!executionContext || !policy) return null
  const call = { ...sideEffectSite(executionContext, input.params), toolId: input.toolId }
  return policy.decideWrite(call) === 'stub' ? { policy, executionContext, call } : null
}

/** A string body as the JSON it carries, when it carries JSON. */
function readBody(body: string | undefined): unknown {
  if (body === undefined) return undefined
  try {
    return JSON.parse(body)
  } catch {
    return body
  }
}

/** What an MCP tool call would send its server: only the arguments it was given. */
export function describeMcpToolRequest(params: Record<string, unknown>): unknown {
  return { arguments: parseMcpToolArguments(params) }
}

/**
 * What a call to `tool` would send. A custom tool runs the workspace's own code with the run's
 * environment, so it is described by the arguments it was given; any other tool by an in-process
 * operation's input, or an HTTP request's method, URL and body. Headers are never kept, since
 * they carry the credentials.
 */
export function describeToolRequest(
  tool: ExecutableToolConfig,
  params: Record<string, unknown>
): unknown {
  if (isCustomTool(tool.id)) {
    return {
      arguments: Object.fromEntries(
        Object.entries(params).filter(([key]) => Object.hasOwn(tool.params, key))
      ),
    }
  }
  if (isInternalToolConfig(tool)) {
    return tool.operation.input(params)
  }
  const prepared = prepareToolRequest(tool, params)
  return { method: prepared.method, url: prepared.url, body: readBody(prepared.body) }
}

/** Nesting a secret scan follows before it refuses to vouch for a payload. */
const MAX_SCAN_DEPTH = 100

class SecretScanDepthError extends Error {
  constructor() {
    super('Side-effect payload is nested too deeply to scan for secrets')
    this.name = 'SecretScanDepthError'
  }
}

function checkScanDepth(depth: number): void {
  if (depth > MAX_SCAN_DEPTH) throw new SecretScanDepthError()
}

/** Every credential-named field masked, and each credential value masked wherever it reappears. */
function redactCredentials(value: unknown, credentials: string[], depth = 0): unknown {
  checkScanDepth(depth)
  if (typeof value === 'string') return redactExactSensitiveValues(value, credentials)
  if (Array.isArray(value)) {
    return value.map((item) => redactCredentials(item, credentials, depth + 1))
  }
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? REDACTED_MARKER : redactCredentials(item, credentials, depth + 1),
    ])
  )
}

/** The params a block's password fields fill: each field's id and canonical param. */
function passwordParamsOf(block: BlockConfig | undefined): ReadonlySet<string> {
  const params = new Set<string>()
  for (const subBlock of block?.subBlocks ?? []) {
    if (!subBlock.password) continue
    params.add(subBlock.id)
    if (subBlock.canonicalParamId) params.add(subBlock.canonicalParamId)
  }
  return params
}

/** The static block registry's password params, per block type a run's unsent writes named. */
const registryPasswordParams = new Map<string, ReadonlySet<string>>()

/** A block type's password params; a custom block's config is per workspace, so it is read live. */
function passwordParamsFor(blockType: string): ReadonlySet<string> {
  const cached = registryPasswordParams.get(blockType)
  if (cached) return cached
  const params = passwordParamsOf(getBlock(blockType))
  if (Object.hasOwn(getBlockRegistry(), blockType)) registryPasswordParams.set(blockType, params)
  return params
}

/**
 * The values in `params` that are secrets: every string under a credential-named field at any
 * depth (an access token, a hosted key, an MCP argument named `apiKey`), and whatever was typed
 * into a password field of the blocks `blockTypes` names, whatever the field is called.
 */
function secretValues(params: Record<string, unknown>, blockTypes: string[]): string[] {
  const passwordParams = blockTypes.map(passwordParamsFor)
  const found = new Set<string>()
  const collectStrings = (value: unknown, depth: number): void => {
    checkScanDepth(depth)
    if (typeof value === 'string') {
      if (value !== '') found.add(value)
    } else if (Array.isArray(value)) {
      for (const item of value) collectStrings(item, depth + 1)
    } else if (isPlainRecord(value)) {
      for (const item of Object.values(value)) collectStrings(item, depth + 1)
    }
  }
  const visit = (value: unknown, depth: number): void => {
    checkScanDepth(depth)
    if (Array.isArray(value)) {
      for (const item of value) visit(item, depth + 1)
      return
    }
    if (!isPlainRecord(value)) return
    for (const [key, item] of Object.entries(value)) {
      const isPasswordParam = depth === 0 && passwordParams.some((fields) => fields.has(key))
      if (isSensitiveKey(key) || isPasswordParam) collectStrings(item, depth + 1)
      else visit(item, depth + 1)
    }
  }
  visit(params, 0)
  return [...found]
}

/**
 * The params a tool call's request is described from: the run-context params no tool sends
 * dropped, and each secret masked before any request builder sees it ({@link secretValues} by
 * field and by value, then every secret the run resolved by its registry), so no transformation a
 * builder applies (base64 file content, URL encoding, hashing) can carry a secret past redaction.
 * Null when the registry cannot vouch that none remains.
 */
function maskRequestParams(
  params: Record<string, unknown>,
  blockTypes: string[],
  registry: ResolvedSecretTraceRegistry | undefined
): Record<string, unknown> | null {
  const sent = Object.fromEntries(
    Object.entries(params).filter(([key]) => !RUN_CONTEXT_PARAMS.has(key))
  )
  const masked = redactCredentials(sent, secretValues(sent, blockTypes))
  const projection = projectResolvedSecretModelContent(masked, registry)
  return projection.safe && isPlainRecord(projection.value) ? projection.value : null
}

/**
 * A side effect's payload (a stubbed write's request, or an answered block's inputs) as a run may
 * report it: the secrets in `params` masked by field and by value, every secret the run resolved
 * masked by its registry, then the run's PII redaction applied as it is to a block's output. Null
 * when the registry cannot vouch that no secret remains, or the PII redaction fails.
 */
export async function redactSideEffectPayload(input: {
  payload: unknown
  params: Record<string, unknown>
  /** Blocks whose password fields `params` may carry. */
  blockTypes: string[]
  executionContext: ExecutionContext
  registry: ResolvedSecretTraceRegistry | undefined
}): Promise<Record<string, unknown> | null> {
  let redacted: unknown
  try {
    redacted = redactCredentials(
      isPlainRecord(input.payload) ? input.payload : { input: input.payload },
      secretValues(input.params, input.blockTypes)
    )
  } catch (error) {
    if (error instanceof SecretScanDepthError) return null
    throw error
  }
  const projection = projectResolvedSecretModelContent(redacted, input.registry)
  if (!projection.safe || !isPlainRecord(projection.value)) return null
  const pii = input.executionContext.piiBlockOutputRedaction
  if (!pii?.enabled) return projection.value
  try {
    return await redactObjectStrings(projection.value, {
      entityTypes: pii.entityTypes,
      language: pii.language,
      customPatterns: pii.customPatterns,
      onFailure: 'throw',
    })
  } catch (error) {
    logger.warn('PII redaction of a side effect failed; recording no payload', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return null
  }
}

/**
 * The response answering a write tool call the run's side-effect policy does not send, after the
 * policy recorded the request it would have sent: `describe` builds it from params whose secrets
 * are already masked ({@link maskRequestParams}), and the result is redacted again as a payload
 * ({@link redactSideEffectPayload}). Null when either step cannot vouch that no secret remains.
 */
export async function answerUnsentWrite(
  write: UnsentWrite,
  input: {
    params: Record<string, unknown>
    registry: ResolvedSecretTraceRegistry | undefined
    describe: (maskedParams: Record<string, unknown>) => unknown
  }
): Promise<ToolResponse> {
  const { call } = write
  const toolBlockType = getBlockByToolName(call.toolId)?.type
  const blockTypes = [call.blockType, toolBlockType].filter((type): type is string => Boolean(type))
  let maskedParams: Record<string, unknown> | null
  try {
    maskedParams = maskRequestParams(input.params, blockTypes, input.registry)
  } catch (error) {
    if (!(error instanceof SecretScanDepthError)) throw error
    maskedParams = null
  }
  const request = maskedParams
    ? await redactSideEffectPayload({
        payload: input.describe(maskedParams),
        params: input.params,
        blockTypes,
        executionContext: write.executionContext,
        registry: input.registry,
      })
    : null
  return { success: true, output: write.policy.stubWrite({ ...call, request }) }
}

/**
 * {@link answerUnsentWrite} for a call that reaches an MCP server (a workspace MCP tool, or the MCP
 * block's operation): a JSON-string `arguments` param is read first, so a secret nested in it is
 * found and masked like any other.
 */
export function answerUnsentMcpWrite(
  write: UnsentWrite,
  input: Parameters<typeof answerUnsentWrite>[1]
): Promise<ToolResponse> {
  const { params } = input
  return answerUnsentWrite(write, {
    ...input,
    params:
      typeof params.arguments === 'string'
        ? { ...params, arguments: parseMcpToolArguments(params) }
        : params,
  })
}
