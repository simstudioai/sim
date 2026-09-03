/**
 * @vitest-environment node
 */
import type { WorkflowExecutionPrincipal } from '@sim/auth/principal'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createStreamingResponse } from '@/lib/workflows/streaming/streaming'

const { mockNavigatePathAsync } = vi.hoisted(() => ({
  mockNavigatePathAsync: vi.fn(),
}))

vi.mock('@/executor/variables/resolvers/reference-async.server', () => ({
  navigatePathAsync: mockNavigatePathAsync,
}))

const principal = {
  kind: 'session',
  userId: 'user-1',
} as unknown as WorkflowExecutionPrincipal

async function drain(stream: ReadableStream<Uint8Array>): Promise<void> {
  const reader = stream.getReader()
  try {
    while (!(await reader.read()).done) {
      /* consume */
    }
  } finally {
    reader.releaseLock()
  }
}

describe('selected output principal', () => {
  beforeEach(() => {
    mockNavigatePathAsync.mockReset()
    mockNavigatePathAsync.mockImplementation(async (value: unknown, path: string[]) =>
      path.reduce<unknown>(
        (current, part) => (current as Record<string, unknown> | undefined)?.[part],
        value
      )
    )
  })

  /**
   * A block that completes without the selected path streams nothing, so the
   * output is materialized from the final result instead. Both reads must run
   * as the principal behind the run, or a member-only knowledge-base file in
   * the output is read as nobody on the final-frame path.
   */
  it('reads a selected output as the executing principal on the chunk and final paths', async () => {
    const stream = await createStreamingResponse({
      requestId: 'request-1',
      principal,
      streamConfig: { selectedOutputs: ['agent_content'] },
      executeFn: async ({ onBlockComplete }) => {
        await onBlockComplete('agent', {})
        const output = { content: 'Done' }
        return {
          success: true,
          output,
          logs: [
            {
              blockId: 'agent',
              output,
              startedAt: new Date().toISOString(),
              endedAt: new Date().toISOString(),
              durationMs: 1,
              success: true,
            },
          ],
        } as never
      },
    })

    await drain(stream)

    expect(mockNavigatePathAsync).toHaveBeenCalledTimes(2)
    for (const [, path, context] of mockNavigatePathAsync.mock.calls) {
      expect(path).toEqual(['content'])
      expect(context.executionContext.principal).toBe(principal)
    }
  })
})
