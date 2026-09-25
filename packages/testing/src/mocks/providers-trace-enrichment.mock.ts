import { vi } from 'vitest'

/**
 * Controllable mock functions for `@/providers/trace-enrichment`.
 *
 * `mockEnrichLastModelSegment` and `mockEnrichLastModelSegmentFromChatCompletions` are bare
 * `vi.fn()` no-ops (the segments are left untouched). `mockParseToolCallArguments` is a faithful
 * port of the real pure parser: JSON objects are parsed, anything else is returned raw, and a
 * non-string yields `''`.
 *
 * @example
 * ```ts
 * import { providersTraceEnrichmentMockFns } from '@sim/testing/mocks/providers-trace-enrichment.mock'
 *
 * expect(providersTraceEnrichmentMockFns.mockEnrichLastModelSegmentFromChatCompletions).toHaveBeenCalled()
 * ```
 */
export const providersTraceEnrichmentMockFns = {
  mockEnrichLastModelSegment: vi.fn(),
  mockEnrichLastModelSegmentFromChatCompletions: vi.fn(),
  mockParseToolCallArguments: vi.fn((rawArguments: string): Record<string, unknown> | string => {
    if (typeof rawArguments !== 'string') return ''
    try {
      const parsed: unknown = JSON.parse(rawArguments)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
      return rawArguments
    } catch {
      return rawArguments
    }
  }),
}

/**
 * Static mock module for `@/providers/trace-enrichment`. Covers every runtime export.
 *
 * @example
 * ```ts
 * vi.mock('@/providers/trace-enrichment', () => providersTraceEnrichmentMock)
 * ```
 */
export const providersTraceEnrichmentMock = {
  enrichLastModelSegment: providersTraceEnrichmentMockFns.mockEnrichLastModelSegment,
  enrichLastModelSegmentFromChatCompletions:
    providersTraceEnrichmentMockFns.mockEnrichLastModelSegmentFromChatCompletions,
  parseToolCallArguments: providersTraceEnrichmentMockFns.mockParseToolCallArguments,
}
