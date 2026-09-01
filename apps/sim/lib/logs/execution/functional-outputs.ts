export interface FunctionalTraceSpanSource {
  blockId?: string
  output?: unknown
  children?: FunctionalTraceSpanSource[]
}

export interface FunctionalExecutionDataSource {
  traceSpans?: FunctionalTraceSpanSource[]
  executionState?: {
    blockStates?: Record<string, { output?: unknown }>
  }
  executionDataTruncated?: boolean
}

export const FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE =
  'Raw block outputs are unavailable because the execution data could not be retained in full.'

export class FunctionalOutputsUnavailableError extends Error {
  constructor() {
    super(FUNCTIONAL_OUTPUTS_UNAVAILABLE_MESSAGE)
    this.name = 'FunctionalOutputsUnavailableError'
  }
}

function collectTraceBlockOutputs(
  spans: FunctionalTraceSpanSource[] | undefined,
  outputs: Map<string, unknown>
): void {
  if (!spans) return
  for (const span of spans) {
    if (span.blockId && span.output !== undefined && !outputs.has(span.blockId)) {
      outputs.set(span.blockId, span.output)
    }
    collectTraceBlockOutputs(span.children, outputs)
  }
}

/** Returns functional block outputs, preferring raw execution state over display TraceSpans. */
export function collectFunctionalBlockOutputs(
  data: FunctionalExecutionDataSource | undefined
): Map<string, unknown> {
  const outputs = new Map<string, unknown>()
  const blockStates = data?.executionState?.blockStates
  if (blockStates) {
    for (const [blockId, blockState] of Object.entries(blockStates)) {
      if (blockState?.output !== undefined) outputs.set(blockId, blockState.output)
    }
    return outputs
  }

  if (data?.executionDataTruncated) throw new FunctionalOutputsUnavailableError()

  collectTraceBlockOutputs(data?.traceSpans, outputs)
  return outputs
}

export function getFunctionalBlockOutput(
  data: FunctionalExecutionDataSource | undefined,
  blockId: string
): unknown {
  return collectFunctionalBlockOutputs(data).get(blockId)
}
