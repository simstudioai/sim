import { vi } from 'vitest'

interface MockSpendRecord {
  cost?: unknown
  tokens?: unknown
  children?: unknown
  providerTiming?: unknown
}

function stripProviderTimingSegmentSpend(
  providerTiming: unknown,
  options: { tokens: boolean }
): void {
  if (!providerTiming || typeof providerTiming !== 'object') return
  const segments = (providerTiming as { segments?: unknown }).segments
  if (!Array.isArray(segments)) return
  for (const segment of segments) {
    if (!segment || typeof segment !== 'object') continue
    const record = segment as { cost?: unknown; tokens?: unknown }
    if ('cost' in record) record.cost = undefined
    if (options.tokens && 'tokens' in record) record.tokens = undefined
  }
}

function stripSpanSpendFields(spans: unknown, options: { tokens: boolean }): void {
  if (!Array.isArray(spans)) return
  for (const span of spans) {
    if (!span || typeof span !== 'object') continue
    const record = span as MockSpendRecord
    if ('cost' in record) record.cost = undefined
    if (options.tokens && 'tokens' in record) record.tokens = undefined
    stripProviderTimingSegmentSpend(record.providerTiming, options)
    if (Array.isArray(record.children)) stripSpanSpendFields(record.children, options)
  }
}

function copySpanTreeForStrip(spans: unknown[]): unknown[] {
  return spans.map((span) => {
    if (!span || typeof span !== 'object') return span
    const copy: MockSpendRecord & Record<string, unknown> = { ...(span as MockSpendRecord) }
    if (Array.isArray(copy.children)) copy.children = copySpanTreeForStrip(copy.children)
    if (copy.providerTiming && typeof copy.providerTiming === 'object') {
      const { segments } = copy.providerTiming as { segments?: unknown }
      copy.providerTiming = {
        ...copy.providerTiming,
        ...(Array.isArray(segments)
          ? {
              segments: segments.map((segment) =>
                segment && typeof segment === 'object' ? { ...segment } : segment
              ),
            }
          : {}),
      }
    }
    return copy
  })
}

/**
 * Controllable mock functions for `@/lib/logs/execution/trace-store`.
 *
 * The span-spend helpers are faithful ports of the real pure logic:
 * `mockStripSpanCosts` clears `cost` (span, children, `providerTiming.segments`) in place,
 * `mockStripJoinedChildTraceSpend` also clears `tokens`, and `mockCopyTraceSpansWithoutCosts`
 * returns a stripped copy (`undefined` for `undefined`). Every async function
 * (`externalize*`, `materialize*`, `projectExecutionDataForDisplay`) is a bare `vi.fn()`.
 *
 * @example
 * ```ts
 * import { traceStoreMockFns } from '@sim/testing/mocks/trace-store.mock'
 *
 * traceStoreMockFns.mockMaterializeExecutionDataForDisplay.mockResolvedValue({ traceSpans: [] })
 * ```
 */
export const traceStoreMockFns = {
  mockStripSpanCosts: vi.fn((spans: unknown): void => {
    stripSpanSpendFields(spans, { tokens: false })
  }),
  mockStripJoinedChildTraceSpend: vi.fn((spans: unknown): void => {
    stripSpanSpendFields(spans, { tokens: true })
  }),
  mockCopyTraceSpansWithoutCosts: vi.fn((spans?: unknown[]): unknown[] | undefined => {
    if (!spans) return undefined
    const copy = copySpanTreeForStrip(spans)
    stripSpanSpendFields(copy, { tokens: false })
    return copy
  }),
  mockExternalizeExecutionData: vi.fn(),
  mockMaterializeExecutionData: vi.fn(),
  mockMaterializeExecutionDataForDisplay: vi.fn(),
  mockMaterializeExecutionDataForDisplayWithBlockOutputs: vi.fn(),
  mockProjectExecutionDataForDisplay: vi.fn(),
}

/**
 * Static mock module for `@/lib/logs/execution/trace-store`. Constants carry the real values.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/logs/execution/trace-store', () => traceStoreMock)
 * ```
 */
export const traceStoreMock = {
  SECRET_PROJECTION_VERSION: 1 as const,
  TRACE_STORE_REF_KEY: 'traceStoreRef',
  RESOLVED_SECRET_PROVENANCE_KEY: 'resolvedSecretTraceProvenance',
  stripSpanCosts: traceStoreMockFns.mockStripSpanCosts,
  stripJoinedChildTraceSpend: traceStoreMockFns.mockStripJoinedChildTraceSpend,
  copyTraceSpansWithoutCosts: traceStoreMockFns.mockCopyTraceSpansWithoutCosts,
  externalizeExecutionData: traceStoreMockFns.mockExternalizeExecutionData,
  materializeExecutionData: traceStoreMockFns.mockMaterializeExecutionData,
  materializeExecutionDataForDisplay: traceStoreMockFns.mockMaterializeExecutionDataForDisplay,
  materializeExecutionDataForDisplayWithBlockOutputs:
    traceStoreMockFns.mockMaterializeExecutionDataForDisplayWithBlockOutputs,
  projectExecutionDataForDisplay: traceStoreMockFns.mockProjectExecutionDataForDisplay,
}
