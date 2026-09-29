import type { TraceSpan } from '@/lib/logs/types'

export function stripModelToolCallArguments(
  calls: NonNullable<TraceSpan['modelToolCalls']>
): NonNullable<TraceSpan['modelToolCalls']> {
  return calls.map(({ arguments: _arguments, ...call }) => call as (typeof calls)[number])
}

export function stripLegacyToolCallContent(
  calls: NonNullable<TraceSpan['toolCalls']>
): NonNullable<TraceSpan['toolCalls']> {
  return calls.map(({ input: _input, output: _output, error: _error, ...call }) => call)
}

export function stripProviderTimingContent(
  providerTiming: NonNullable<TraceSpan['providerTiming']>
): NonNullable<TraceSpan['providerTiming']> {
  return {
    ...providerTiming,
    segments: providerTiming.segments.map(
      ({
        assistantContent: _assistantContent,
        thinkingContent: _thinkingContent,
        errorMessage: _errorMessage,
        toolCalls,
        ...segment
      }) => ({
        ...segment,
        ...(toolCalls ? { toolCalls: stripModelToolCallArguments(toolCalls) } : {}),
      })
    ),
  }
}

/**
 * A trace span tree with every span's content removed: inputs, outputs,
 * thinking, error text, tool-call arguments, and provider content. Keeps the
 * tree's shape, names, timing, status, and cost.
 */
export function summarizeTraceSpansWithoutIo(traceSpans?: TraceSpan[]): TraceSpan[] | undefined {
  if (!traceSpans) {
    return traceSpans
  }

  return traceSpans.map((span) => {
    const {
      input: _input,
      output: _output,
      children,
      thinking: _thinking,
      errorMessage: _errorMessage,
      modelToolCalls,
      toolCalls,
      providerTiming,
      ...rest
    } = span
    return {
      ...rest,
      ...(modelToolCalls ? { modelToolCalls: stripModelToolCallArguments(modelToolCalls) } : {}),
      ...(toolCalls ? { toolCalls: stripLegacyToolCallContent(toolCalls) } : {}),
      ...(providerTiming ? { providerTiming: stripProviderTimingContent(providerTiming) } : {}),
      ...(children?.length ? { children: summarizeTraceSpansWithoutIo(children) } : {}),
    }
  })
}
