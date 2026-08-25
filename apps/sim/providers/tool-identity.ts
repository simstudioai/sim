import type { NormalizedBlockOutput, StreamingExecution } from '@/executor/types'
import type { AgentStreamEvent } from '@/providers/stream-events'
import type { ProviderResponse, ProviderToolConfig } from '@/providers/types'

const MAX_PROVIDER_TOOL_ID_LENGTH = 64
const PROVIDER_ALIAS_MARKER = '__sim_'

export interface ProviderToolIdentityMap {
  /** Provider-only tool id to the canonical registry id used for execution and observability. */
  toolIdByWireId: ReadonlyMap<string, string>
}

function buildProviderAlias(toolId: string, occurrence: number, attempt: number): string {
  const collisionSuffix = attempt > 0 ? `_${attempt + 1}` : ''
  const suffix = `${PROVIDER_ALIAS_MARKER}${occurrence}${collisionSuffix}`
  const prefixLength = Math.max(1, MAX_PROVIDER_TOOL_ID_LENGTH - suffix.length)
  return `${toolId.slice(0, prefixLength)}${suffix}`
}

/**
 * Gives duplicate configured tools deterministic provider-safe wire ids.
 *
 * The first occurrence and every already-unique tool keep their existing id for backwards
 * compatibility. Later occurrences receive opaque ordinal aliases; resource and credential ids
 * never enter the provider-visible name. Tool objects are updated in place so their instance-bound
 * params and secret provenance remain attached to the exact object selected by provider adapters.
 */
export function assignProviderToolIdentities(
  tools: ProviderToolConfig[] | undefined
): ProviderToolIdentityMap {
  if (!tools?.length) return { toolIdByWireId: new Map() }

  const distinctTools = [...new Set(tools)]
  if (distinctTools.length !== tools.length) {
    tools.splice(0, tools.length, ...distinctTools)
  }

  const canonicalIds = tools.map((tool) => tool.canonicalId ?? tool.id)
  const reservedIds = new Set(canonicalIds)
  const occurrences = new Map<string, number>()
  const usedWireIds = new Set<string>()
  const toolIdByWireId = new Map<string, string>()

  tools.forEach((tool, index) => {
    const canonicalId = canonicalIds[index]
    const occurrence = (occurrences.get(canonicalId) ?? 0) + 1
    occurrences.set(canonicalId, occurrence)

    let wireId = canonicalId
    if (usedWireIds.has(wireId)) {
      let attempt = 0
      do {
        wireId = buildProviderAlias(canonicalId, occurrence, attempt)
        attempt += 1
      } while (reservedIds.has(wireId) || usedWireIds.has(wireId))
    }

    tool.id = wireId
    if (wireId !== canonicalId) {
      tool.canonicalId = canonicalId
      toolIdByWireId.set(wireId, canonicalId)
    }
    usedWireIds.add(wireId)
  })

  return { toolIdByWireId }
}

function projectToolId(toolId: string, identities: ProviderToolIdentityMap): string {
  return identities.toolIdByWireId.get(toolId) ?? toolId
}

function projectTiming(
  timing:
    | { timeSegments?: NonNullable<NormalizedBlockOutput['providerTiming']>['timeSegments'] }
    | undefined,
  identities: ProviderToolIdentityMap
): void {
  for (const segment of timing?.timeSegments ?? []) {
    if (segment.type === 'tool' && segment.name) {
      segment.name = projectToolId(segment.name, identities)
    }
    for (const toolCall of segment.toolCalls ?? []) {
      toolCall.name = projectToolId(toolCall.name, identities)
    }
  }
}

export function projectProviderResponseToolIdentities(
  response: ProviderResponse,
  identities: ProviderToolIdentityMap
): void {
  if (identities.toolIdByWireId.size === 0) return

  for (const toolCall of response.toolCalls ?? []) {
    toolCall.name = projectToolId(toolCall.name, identities)
  }
  projectTiming(response.timing, identities)
}

function projectStreamingOutput(
  output: NormalizedBlockOutput | undefined,
  identities: ProviderToolIdentityMap
): void {
  if (!output) return
  for (const toolCall of output.toolCalls?.list ?? []) {
    toolCall.name = projectToolId(toolCall.name, identities)
  }
  projectTiming(output.providerTiming, identities)
}

function projectStreamEvent(
  event: AgentStreamEvent,
  identities: ProviderToolIdentityMap
): AgentStreamEvent {
  if (event.type !== 'tool_call_start' && event.type !== 'tool_call_end') return event
  return { ...event, name: projectToolId(event.name, identities) }
}

/** Keeps provider aliases inside the provider loop, including for live stream events. */
export function projectStreamingExecutionToolIdentities(
  response: StreamingExecution,
  identities: ProviderToolIdentityMap
): void {
  if (identities.toolIdByWireId.size === 0) return

  projectStreamingOutput(response.execution?.output, identities)
  const reader = response.stream.getReader()
  const eventStream = response.streamFormat === 'agent-events-v1'

  response.stream = new ReadableStream({
    async pull(controller) {
      try {
        const { done, value } = await reader.read()
        if (done) {
          projectStreamingOutput(response.execution?.output, identities)
          reader.releaseLock()
          controller.close()
          return
        }
        controller.enqueue(
          eventStream ? projectStreamEvent(value as AgentStreamEvent, identities) : value
        )
      } catch (error) {
        projectStreamingOutput(response.execution?.output, identities)
        reader.releaseLock()
        controller.error(error)
      }
    },
    async cancel(reason) {
      try {
        await reader.cancel(reason)
      } finally {
        projectStreamingOutput(response.execution?.output, identities)
        reader.releaseLock()
      }
    },
  })
}
