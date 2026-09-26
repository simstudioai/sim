import { vi } from 'vitest'

/** Minimal OTel `Span` stand-in: every method is a `vi.fn()`; setters return the span. */
export interface MockOtelSpan {
  setAttribute: ReturnType<typeof vi.fn>
  setAttributes: ReturnType<typeof vi.fn>
  addEvent: ReturnType<typeof vi.fn>
  addLink: ReturnType<typeof vi.fn>
  addLinks: ReturnType<typeof vi.fn>
  setStatus: ReturnType<typeof vi.fn>
  updateName: ReturnType<typeof vi.fn>
  recordException: ReturnType<typeof vi.fn>
  end: ReturnType<typeof vi.fn>
  isRecording: ReturnType<typeof vi.fn>
  spanContext: ReturnType<typeof vi.fn>
}

/**
 * Builds a fresh {@link MockOtelSpan}. The span context carries a fixed, valid trace/span id so
 * code that reads `span.spanContext().traceId` gets a 32-hex value.
 */
export function createMockOtelSpan(): MockOtelSpan {
  const span = {} as MockOtelSpan
  const self = () => span
  span.setAttribute = vi.fn(self)
  span.setAttributes = vi.fn(self)
  span.addEvent = vi.fn(self)
  span.addLink = vi.fn(self)
  span.addLinks = vi.fn(self)
  span.setStatus = vi.fn(self)
  span.updateName = vi.fn(self)
  span.recordException = vi.fn()
  span.end = vi.fn()
  span.isRecording = vi.fn(() => true)
  span.spanContext = vi.fn(() => ({
    traceId: '0123456789abcdef0123456789abcdef',
    spanId: '0123456789abcdef',
    traceFlags: 1,
  }))
  return span
}

/** Inert OTel `Context` stand-in (no stored values). */
const MOCK_OTEL_CONTEXT = {
  getValue: (_key: symbol): unknown => undefined,
  setValue(_key: symbol, _value: unknown) {
    return MOCK_OTEL_CONTEXT
  },
  deleteValue(_key: symbol) {
    return MOCK_OTEL_CONTEXT
  },
}

/** Real `AbortReason` values that `isExplicitStopReason` treats as an explicit user stop. */
const EXPLICIT_STOP_REASONS = new Set<unknown>([
  'user_stop:abortActiveStream',
  'redis_abort_marker:poller',
  'redis_abort_marker:body_close',
])

type SpanCallback = (span: MockOtelSpan) => unknown

/**
 * Controllable mock functions for `@/lib/mothership/request/otel`.
 *
 * Defaults:
 * - `mockWithCopilotSpan`, `mockWithIncomingGoSpan`, `mockWithCopilotToolSpan` invoke their callback
 *   with a fresh {@link createMockOtelSpan} span and return its result (no span status bookkeeping).
 * - `mockWithCopilotOtelContext` invokes its callback with an inert context.
 * - `mockStartCopilotOtelRoot` returns `{ span, context, requestId, finish, setUserMessagePreview,
 *   setInputMessages, setOutputMessages, setRequestShape }` with fresh `vi.fn()`s; `requestId` is
 *   `scope.requestId ?? 'mock-request-id'`.
 * - `mockGetCopilotTracer` returns a tracer whose `startSpan` builds a mock span and whose
 *   `startActiveSpan` invokes its last-argument callback with one.
 * - `mockIsExplicitUserStopError` and `mockIsActionableErrorStatus` are faithful ports.
 * - `mockMarkSpanForError` is a no-op.
 *
 * @example
 * ```ts
 * import { mothershipOtelMockFns } from '@sim/testing/mocks/mothership-otel.mock'
 *
 * expect(mothershipOtelMockFns.mockWithCopilotSpan).toHaveBeenCalledWith(
 *   'copilot.tool',
 *   expect.any(Object),
 *   expect.any(Function)
 * )
 * ```
 */
export const mothershipOtelMockFns = {
  mockIsExplicitUserStopError: vi.fn((err: unknown): boolean => {
    if (err == null) return false
    if (typeof err === 'string') return EXPLICIT_STOP_REASONS.has(err)
    if (typeof err === 'object') {
      const e = err as { cause?: unknown; message?: unknown }
      if (EXPLICIT_STOP_REASONS.has(e.cause)) return true
      if (typeof e.message === 'string' && EXPLICIT_STOP_REASONS.has(e.message)) return true
    }
    return false
  }),
  mockIsActionableErrorStatus: vi.fn((code: number): boolean => {
    if (code >= 500) return true
    return code === 402 || code === 409 || code === 429
  }),
  mockMarkSpanForError: vi.fn((_span: unknown, _error: unknown): void => {}),
  mockGetCopilotTracer: vi.fn(() => ({
    startSpan: vi.fn(() => createMockOtelSpan()),
    startActiveSpan: vi.fn((_name: string, ...rest: unknown[]) =>
      (rest[rest.length - 1] as SpanCallback)(createMockOtelSpan())
    ),
  })),
  mockWithIncomingGoSpan: vi.fn(
    async (_headers: unknown, _spanName: string, _attributes: unknown, fn: SpanCallback) =>
      fn(createMockOtelSpan())
  ),
  mockWithCopilotSpan: vi.fn(
    async (_spanName: string, _attributes: unknown, fn: SpanCallback, _parentContext?: unknown) =>
      fn(createMockOtelSpan())
  ),
  mockWithCopilotToolSpan: vi.fn(async (_input: unknown, fn: SpanCallback) =>
    fn(createMockOtelSpan())
  ),
  mockStartCopilotOtelRoot: vi.fn((scope: { requestId?: string }) => ({
    span: createMockOtelSpan(),
    context: MOCK_OTEL_CONTEXT,
    requestId: scope.requestId ?? 'mock-request-id',
    finish: vi.fn(),
    setUserMessagePreview: vi.fn(),
    setInputMessages: vi.fn(),
    setOutputMessages: vi.fn(),
    setRequestShape: vi.fn(),
  })),
  mockWithCopilotOtelContext: vi.fn(
    async (_scope: unknown, fn: (otelContext: typeof MOCK_OTEL_CONTEXT) => unknown) =>
      fn(MOCK_OTEL_CONTEXT)
  ),
}

/**
 * Static mock module for `@/lib/mothership/request/otel`.
 *
 * @example
 * ```ts
 * vi.mock('@/lib/mothership/request/otel', () => mothershipOtelMock)
 * ```
 */
export const mothershipOtelMock = {
  isExplicitUserStopError: mothershipOtelMockFns.mockIsExplicitUserStopError,
  isActionableErrorStatus: mothershipOtelMockFns.mockIsActionableErrorStatus,
  markSpanForError: mothershipOtelMockFns.mockMarkSpanForError,
  getCopilotTracer: mothershipOtelMockFns.mockGetCopilotTracer,
  withIncomingGoSpan: mothershipOtelMockFns.mockWithIncomingGoSpan,
  withCopilotSpan: mothershipOtelMockFns.mockWithCopilotSpan,
  withCopilotToolSpan: mothershipOtelMockFns.mockWithCopilotToolSpan,
  startCopilotOtelRoot: mothershipOtelMockFns.mockStartCopilotOtelRoot,
  withCopilotOtelContext: mothershipOtelMockFns.mockWithCopilotOtelContext,
}
