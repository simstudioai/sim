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
import { isNonIdentifyingSecretLiteral } from '@/executor/utils/resolved-secret-match-policy'
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

/** The secrets a call's params carry, as {@link callSecrets} finds them. */
interface CallSecrets {
  /** Values masked wherever they reappear. */
  values: string[]
  /** Password fields of the calling blocks, masked by name like a credential-named field. */
  passwordFields: ReadonlySet<string>
}

/** Every credential-named or password field masked, and each secret value wherever it reappears. */
function redactCredentials(value: unknown, secrets: CallSecrets, depth = 0): unknown {
  checkScanDepth(depth)
  if (typeof value === 'string') return redactExactSensitiveValues(value, secrets.values)
  if (Array.isArray(value)) {
    return value.map((item) => redactCredentials(item, secrets, depth + 1))
  }
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) || secrets.passwordFields.has(key)
        ? REDACTED_MARKER
        : redactCredentials(item, secrets, depth + 1),
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
 * The secrets in `params`: every string under a credential-named field at any depth (an access
 * token, a hosted key, an MCP argument named `apiKey`), and whatever was typed into a password
 * field of the blocks `blockTypes` names, whatever the field is called. A value too short to
 * identify a secret ({@link isNonIdentifyingSecretLiteral}) is masked only by its field, so a
 * one-letter `reset_token` column never rewrites the rest of a row.
 */
function callSecrets(params: Record<string, unknown>, blockTypes: string[]): CallSecrets {
  const passwordParams = blockTypes.map(passwordParamsFor)
  const found = new Set<string>()
  const collectStrings = (value: unknown, depth: number): void => {
    checkScanDepth(depth)
    if (typeof value === 'string') {
      if (!isNonIdentifyingSecretLiteral(value)) found.add(value)
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
  return {
    values: [...found],
    passwordFields: new Set(passwordParams.flatMap((fields) => [...fields])),
  }
}

/**
 * `value` with every secret the run resolved masked by its registry, then the secrets `params`
 * carry ({@link callSecrets}) by field and by value. The registry goes first: a value masked inside
 * a resolved secret would leave the rest of it unmatched. Null when the registry cannot vouch that
 * no secret remains.
 */
function maskSecrets(
  value: Record<string, unknown>,
  params: Record<string, unknown>,
  blockTypes: string[],
  registry: ResolvedSecretTraceRegistry | undefined
): Record<string, unknown> | null {
  const projection = projectResolvedSecretModelContent(value, registry)
  if (!projection.safe || !isPlainRecord(projection.value)) return null
  const masked = redactCredentials(projection.value, callSecrets(params, blockTypes))
  return isPlainRecord(masked) ? masked : null
}

/**
 * The params a tool call's request is described from: the run-context params no tool sends
 * dropped, and each secret masked ({@link maskSecrets}) before any request builder sees it, so no
 * transformation a builder applies (base64 file content, URL encoding, hashing) can carry a secret
 * past redaction. Null when the registry cannot vouch that none remains.
 */
function maskRequestParams(
  params: Record<string, unknown>,
  blockTypes: string[],
  registry: ResolvedSecretTraceRegistry | undefined
): Record<string, unknown> | null {
  const sent = Object.fromEntries(
    Object.entries(params).filter(([key]) => !RUN_CONTEXT_PARAMS.has(key))
  )
  return maskSecrets(sent, sent, blockTypes, registry)
}

/** A payload as a record: one that is not is reported under `input`. */
function asPayloadRecord(payload: unknown): Record<string, unknown> {
  return isPlainRecord(payload) ? payload : { input: payload }
}

/**
 * A side effect's payload (a stubbed write's request and placeholder, or an answered block's
 * inputs) as a run may report it: its secrets masked ({@link maskSecrets}), then the run's PII
 * redaction applied as it is to a block's output. Null when the registry cannot vouch that no
 * secret remains, or the PII redaction fails.
 */
export async function redactSideEffectPayload(input: {
  payload: unknown
  params: Record<string, unknown>
  /** Blocks whose password fields `params` may carry. */
  blockTypes: string[]
  executionContext: ExecutionContext
  registry: ResolvedSecretTraceRegistry | undefined
}): Promise<Record<string, unknown> | null> {
  let masked: Record<string, unknown> | null
  try {
    masked = maskSecrets(
      asPayloadRecord(input.payload),
      input.params,
      input.blockTypes,
      input.registry
    )
  } catch (error) {
    if (error instanceof SecretScanDepthError) return null
    throw error
  }
  if (!masked) return null
  const pii = input.executionContext.piiBlockOutputRedaction
  if (!pii?.enabled) return masked
  try {
    return await redactObjectStrings(masked, {
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
 * policy recorded the request it would have sent: `describe` builds it, and `echo` (a tool's
 * `dryRunOutput`) the output that request determines, both from params whose secrets are already
 * masked ({@link maskRequestParams}). Both are redacted again in one {@link redactSideEffectPayload}
 * call, so a workspace that redacts PII makes one call per write; the price is that when that
 * pass cannot vouch for the pair, both are null. Each is also null when it cannot be built from the
 * masked params. The write is answered either way, its placeholder the sample alone without an
 * echo.
 */
export async function answerUnsentWrite(
  write: UnsentWrite,
  input: {
    params: Record<string, unknown>
    registry: ResolvedSecretTraceRegistry | undefined
    describe: (maskedParams: Record<string, unknown>) => unknown
    echo?: (maskedParams: Record<string, unknown>) => Record<string, unknown>
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
  const described = maskedParams
    ? buildFromMaskedParams(call.toolId, input.describe, maskedParams)
    : null
  const echoed =
    maskedParams && input.echo ? buildFromMaskedParams(call.toolId, input.echo, maskedParams) : null
  const redacted =
    described || echoed
      ? await redactSideEffectPayload({
          payload: {
            ...(described ? { request: asPayloadRecord(described.payload) } : {}),
            ...(echoed ? { echoed: echoed.payload } : {}),
          },
          params: input.params,
          blockTypes,
          executionContext: write.executionContext,
          registry: input.registry,
        })
      : null
  return {
    success: true,
    output: write.policy.stubWrite({
      ...call,
      request: isPlainRecord(redacted?.request) ? redacted.request : null,
      echoed: isPlainRecord(redacted?.echoed) ? redacted.echoed : null,
    }),
  }
}

/**
 * What `build` makes of a write's masked params (its request, or the output it determines), or
 * null when it cannot be built from them (a URL that is wholly a masked secret fails URL
 * validation): answering an unsent write never fails the run.
 */
function buildFromMaskedParams(
  toolId: string,
  build: (maskedParams: Record<string, unknown>) => unknown,
  maskedParams: Record<string, unknown>
): { payload: unknown } | null {
  try {
    return { payload: build(maskedParams) }
  } catch (error) {
    logger.warn('Could not build from the masked params of an unsent write; recording none', {
      toolId,
      errorName: error instanceof Error ? error.name : 'UnknownError',
    })
    return null
  }
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
