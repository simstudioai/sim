/**
 * Where a run's side-effect policy (a dry run, or a workflow test's unmocked writes) meets a tool
 * call: `executeTool` asks {@link answerUnsentWrite} about every call not declared `read`, after
 * credentials resolve and before anything is sent.
 */
import { isPlainRecord, toRecord } from '@sim/utils/object'
import {
  isSensitiveKey,
  REDACTED_MARKER,
  redactExactSensitiveValues,
} from '@/lib/core/security/redaction'
import type { SideEffectSite } from '@/executor/execution/types'
import type { ExecutionContext } from '@/executor/types'
import { projectResolvedSecretModelContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { stripCloneSuffixes } from '@/executor/utils/subflow-node-id-codec'
import { prepareToolRequest, projectToolModelInputParams } from '@/tools/request-transport'
import { type ExecutableToolConfig, isInternalToolConfig, type ToolResponse } from '@/tools/types'

/** The block of the executing workflow that made a tool call, from its server-set `_context`. */
function sideEffectSite(
  executionContext: ExecutionContext,
  params: Record<string, unknown>
): SideEffectSite {
  const calledFrom = toRecord(params._context).blockId
  const blockId = typeof calledFrom === 'string' ? stripCloneSuffixes(calledFrom) : ''
  const block = blockId
    ? executionContext.workflow?.blocks.find((candidate) => candidate.id === blockId)
    : undefined
  return {
    workflowId: executionContext.workflowId,
    blockId,
    blockName: block?.metadata?.name ?? blockId,
    blockType: block?.metadata?.id ?? '',
  }
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

/**
 * What a call to `tool` would send: an in-process operation's input, or an HTTP request's method,
 * URL and body. Headers are never kept, since they carry the credentials.
 */
export function describeToolRequest(
  tool: ExecutableToolConfig,
  params: Record<string, unknown>,
  registry: ResolvedSecretTraceRegistry | undefined
): unknown {
  if (isInternalToolConfig(tool)) {
    return tool.operation.input(projectToolModelInputParams(tool, params, registry))
  }
  const prepared = prepareToolRequest(tool, params, registry)
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

/**
 * The request as a run may report it: credentials the call resolved (an access token, a hosted
 * key, a secret access key) masked by field and by value, then every secret the run resolved
 * masked by the run's registry. Null when the registry cannot vouch that none remain.
 */
function redactRequest(
  request: unknown,
  params: Record<string, unknown>,
  registry: ResolvedSecretTraceRegistry | undefined
): Record<string, unknown> | null {
  const credentials = Object.entries(params).flatMap(([key, value]) =>
    isSensitiveKey(key) && typeof value === 'string' && value !== '' ? [value] : []
  )
  const redacted = redactCredentials(
    isPlainRecord(request) ? request : { input: request },
    credentials
  )
  const projection = projectResolvedSecretModelContent(redacted, registry)
  return projection.safe && isPlainRecord(projection.value) ? projection.value : null
}

/**
 * The response answering a write tool call the run's side-effect policy does not send, after the
 * policy recorded the request it would have sent; null when the call is sent. `describeRequest`
 * runs only for an unsent call, and a request it cannot build fails the call as sending it would.
 */
export function answerUnsentWrite(input: {
  toolId: string
  params: Record<string, unknown>
  executionContext: ExecutionContext | undefined
  registry: ResolvedSecretTraceRegistry | undefined
  describeRequest: () => unknown
}): ToolResponse | null {
  const { executionContext, params } = input
  const policy = executionContext?.sideEffects
  if (!policy) return null
  const call = { ...sideEffectSite(executionContext, params), toolId: input.toolId }
  if (policy.sendsWrite(call)) return null
  const request = redactRequest(input.describeRequest(), params, input.registry)
  return { success: true, output: policy.stubWrite({ ...call, request }) }
}
