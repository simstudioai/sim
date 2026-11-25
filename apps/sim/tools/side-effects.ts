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
import { getBlock, getBlockRegistry } from '@/blocks/registry'
import type { BlockConfig } from '@/blocks/types'
import { isCustomTool } from '@/executor/constants'
import type { SideEffectPolicy, SideEffectSite } from '@/executor/execution/types'
import type { ExecutionContext } from '@/executor/types'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { stripCloneSuffixes } from '@/executor/utils/subflow-node-id-codec'
import { prepareToolRequest, projectToolModelInputParams } from '@/tools/request-transport'
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
 * they carry the credentials, and neither are the run-context params an Agent's call carries.
 */
export function describeToolRequest(
  tool: ExecutableToolConfig,
  params: Record<string, unknown>,
  registry: ResolvedSecretTraceRegistry | undefined
): unknown {
  if (isCustomTool(tool.id)) {
    return {
      arguments: Object.fromEntries(
        Object.entries(params).filter(([key]) => Object.hasOwn(tool.params, key))
      ),
    }
  }
  const toolParams = Object.fromEntries(
    Object.entries(params).filter(([key]) => !RUN_CONTEXT_PARAMS.has(key))
  )
  if (isInternalToolConfig(tool)) {
    return tool.operation.input(projectToolModelInputParams(tool, toolParams, registry))
  }
  const prepared = prepareToolRequest(tool, toolParams, registry)
  return { method: prepared.method, url: prepared.url, body: readBody(prepared.body) }
}

/** Every credential-named field masked, and each credential value masked wherever it reappears. */
function redactCredentials(value: unknown, credentials: string[]): unknown {
  if (typeof value === 'string') return redactExactSensitiveValues(value, credentials)
  if (Array.isArray(value)) return value.map((item) => redactCredentials(item, credentials))
  if (!isPlainRecord(value)) return value
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      isSensitiveKey(key) ? REDACTED_MARKER : redactCredentials(item, credentials),
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

/**
 * The static block registry's password params per block type, and the block each tool belongs
 * to, read once on the first unsent write rather than on every one.
 */
let registryPasswordIndex:
  | { paramsByBlockType: Map<string, ReadonlySet<string>>; blockTypeByTool: Map<string, string> }
  | undefined

function readRegistryPasswordIndex() {
  if (registryPasswordIndex) return registryPasswordIndex
  const paramsByBlockType = new Map<string, ReadonlySet<string>>()
  const blockTypeByTool = new Map<string, string>()
  for (const block of Object.values(getBlockRegistry())) {
    paramsByBlockType.set(block.type, passwordParamsOf(block))
    for (const toolId of block.tools?.access ?? []) {
      if (!blockTypeByTool.has(toolId)) blockTypeByTool.set(toolId, block.type)
    }
  }
  registryPasswordIndex = { paramsByBlockType, blockTypeByTool }
  return registryPasswordIndex
}

/** A block type's password params; a custom block's config is per workspace, so it is read live. */
function passwordParamsFor(blockType: string): ReadonlySet<string> {
  return (
    readRegistryPasswordIndex().paramsByBlockType.get(blockType) ??
    passwordParamsOf(getBlock(blockType))
  )
}

/**
 * The values in `params` that are secrets: credential-named params (an access token, a hosted
 * key, a secret access key), and whatever was typed into a password field of the blocks
 * `blockTypes` names, whatever the field is called.
 */
function secretValues(params: Record<string, unknown>, blockTypes: string[]): string[] {
  const passwordParams = blockTypes.map(passwordParamsFor)
  return Object.entries(params).flatMap(([key, value]) =>
    (isSensitiveKey(key) || passwordParams.some((fields) => fields.has(key))) &&
    typeof value === 'string' &&
    value !== ''
      ? [value]
      : []
  )
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
  const redacted = redactCredentials(
    isPlainRecord(input.payload) ? input.payload : { input: input.payload },
    secretValues(input.params, input.blockTypes)
  )
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
 * policy recorded `request`, the request it would have sent.
 */
export async function answerUnsentWrite(
  write: UnsentWrite,
  input: {
    params: Record<string, unknown>
    registry: ResolvedSecretTraceRegistry | undefined
    request: unknown
  }
): Promise<ToolResponse> {
  const { call } = write
  const toolBlockType = readRegistryPasswordIndex().blockTypeByTool.get(call.toolId)
  const request = await redactSideEffectPayload({
    payload: input.request,
    params: input.params,
    blockTypes: [call.blockType, toolBlockType].filter((type): type is string => Boolean(type)),
    executionContext: write.executionContext,
    registry: input.registry,
  })
  return { success: true, output: write.policy.stubWrite({ ...call, request }) }
}
