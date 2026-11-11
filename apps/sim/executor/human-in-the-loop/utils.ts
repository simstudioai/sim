import { isRecordLike } from '@sim/utils/object'
import type {
  ExecutionContext,
  LoopPauseScope,
  ParallelPauseScope,
  PauseInputField,
  PauseMetadata,
  PausePoint,
} from '@/executor/types'
import { projectResolvedSecretModelJsonContent } from '@/executor/utils/resolved-secret-content-projection'
import type { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'
import { buildBranchNodeId } from '@/executor/utils/subflow-node-id-codec'

/** Per-part ceiling on captured display content and fields; larger parts are withheld, not truncated. */
const MAX_PAUSE_DISPLAY_BYTES = 64 * 1024

/** Response keys that drive resume and rendering rather than describe what the reviewer sees. */
const PAUSE_RESPONSE_CONTROL_KEYS = new Set(['_resume', 'operation', 'inputFormat', 'submission'])

interface NodeMetadataLike {
  nodeId: string
  loopId?: string
  parallelId?: string
  branchIndex?: number
  branchTotal?: number
}

export function generatePauseContextId(
  baseBlockId: string,
  nodeMetadata: NodeMetadataLike,
  loopScope?: LoopPauseScope
): string {
  let contextId = baseBlockId

  if (typeof nodeMetadata.branchIndex === 'number') {
    contextId = buildBranchNodeId(contextId, nodeMetadata.branchIndex)
  }

  if (loopScope) {
    contextId = `${contextId}_loop${loopScope.iteration}`
  }

  return contextId
}

export function mapNodeMetadataToPauseScopes(
  ctx: ExecutionContext,
  nodeMetadata: NodeMetadataLike
): {
  parallelScope?: ParallelPauseScope
  loopScope?: LoopPauseScope
} {
  let parallelScope: ParallelPauseScope | undefined
  let loopScope: LoopPauseScope | undefined

  if (nodeMetadata.parallelId && typeof nodeMetadata.branchIndex === 'number') {
    parallelScope = {
      parallelId: nodeMetadata.parallelId,
      branchIndex: nodeMetadata.branchIndex,
      branchTotal: nodeMetadata.branchTotal,
    }
  }

  if (nodeMetadata.loopId) {
    const loopExecution = ctx.loopExecutions?.get(nodeMetadata.loopId)
    const iteration = loopExecution?.iteration ?? 0
    loopScope = {
      loopId: nodeMetadata.loopId,
      iteration,
    }
  }

  return {
    parallelScope,
    loopScope,
  }
}

function toPauseInputField(field: unknown): PauseInputField | null {
  if (!isRecordLike(field) || typeof field.name !== 'string' || !field.name.trim()) return null
  return {
    name: field.name,
    label: typeof field.label === 'string' ? field.label : field.name,
    type: typeof field.type === 'string' ? field.type : 'string',
    ...(typeof field.description === 'string' ? { description: field.description } : {}),
    ...(typeof field.placeholder === 'string' ? { placeholder: field.placeholder } : {}),
    required: field.required === true,
    ...(Array.isArray(field.options) ? { options: field.options } : {}),
  }
}

/**
 * The reviewer-facing view of a pause, scrubbed of every secret the run resolved.
 *
 * A pause's `response` is persisted as the block produced it, so a reference such as
 * `{{API_KEY}}` in its configuration is stored resolved. This projects the parts a caller
 * reading the run may see — the content without resume links, control keys, or API-mode status
 * and headers, and the input fields without their default values — through the run's committed
 * secret matches. Content and fields are proven separately: a part whose projection is
 * unprovable (no registry, an incomplete one, or over {@link MAX_PAUSE_DISPLAY_BYTES}) is null
 * while the other may survive. Time pauses carry no reviewer content.
 */
export function capturePauseDisplay(
  pause: Pick<PauseMetadata, 'pauseKind' | 'response'>,
  registry: ResolvedSecretTraceRegistry | undefined
): Pick<PausePoint, 'displayScrubbed' | 'display' | 'inputFields'> {
  const withheld = { displayScrubbed: true, display: null, inputFields: null }
  if (pause.pauseKind !== 'human') return withheld

  const data: unknown = isRecordLike(pause.response) ? pause.response.data : undefined
  const content = isRecordLike(data)
    ? Object.fromEntries(
        Object.entries(data).filter(([key]) => !PAUSE_RESPONSE_CONTROL_KEYS.has(key))
      )
    : (data ?? null)
  const inputFields =
    isRecordLike(data) && Array.isArray(data.inputFormat)
      ? data.inputFormat.flatMap((field) => toPauseInputField(field) ?? [])
      : null

  /** Each part is projected on its own, so content too large to prove withholds only itself. */
  const project = (value: unknown): unknown => {
    const projection = projectResolvedSecretModelJsonContent(
      value,
      registry,
      MAX_PAUSE_DISPLAY_BYTES
    )
    return projection.safe ? projection.value : null
  }
  const projectedFields = inputFields ? project(inputFields) : null
  return {
    displayScrubbed: true,
    display: project(content) ?? null,
    inputFields: Array.isArray(projectedFields) ? (projectedFields as PauseInputField[]) : null,
  }
}
