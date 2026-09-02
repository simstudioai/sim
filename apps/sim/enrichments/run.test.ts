/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({ mockExecuteTool: vi.fn() }))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { projectEnrichmentProviderFailure, toolProvider } from '@/enrichments/providers'
import { runEnrichment, skippedEnrichmentDetail } from '@/enrichments/run'
import type { EnrichmentConfig, EnrichmentProvider } from '@/enrichments/types'
import { ResolvedSecretTraceRegistry } from '@/executor/utils/resolved-secret-trace-registry'

const ICON = (() => null) as unknown as EnrichmentConfig['icon']

function prov(
  id: string,
  opts: {
    build?: (inputs: Record<string, unknown>) => Record<string, unknown> | null
    projectFailure?: EnrichmentProvider['projectFailure']
    map?: (output: Record<string, unknown>) => Record<string, unknown> | null
  } = {}
): EnrichmentProvider {
  return toolProvider({
    id,
    label: id.toUpperCase(),
    toolId: `tool_${id}`,
    buildParams: opts.build ?? (() => ({ q: 'x' })),
    projectFailure: opts.projectFailure,
    mapOutput: opts.map ?? ((o) => (o.email ? { email: o.email } : null)),
  })
}

function config(providers: EnrichmentProvider[]): EnrichmentConfig {
  return {
    id: 'test',
    name: 'Test',
    description: '',
    icon: ICON,
    inputs: [],
    outputs: [],
    providers,
  }
}

const ctx = { workspaceId: 'ws-1', userId: null }

beforeEach(() => {
  mockExecuteTool.mockReset()
})

describe('runEnrichment cascade detail', () => {
  it('records the first match and stops the cascade', async () => {
    mockExecuteTool.mockImplementation((toolId: string) => {
      if (toolId === 'tool_a') return { success: false, output: { status: 404 } }
      if (toolId === 'tool_b')
        return { success: true, output: { email: 'j@acme.com', cost: { total: 0.05 } } }
      throw new Error('tool_c should never run after a match')
    })

    const outcome = await runEnrichment(config([prov('a'), prov('b'), prov('c')]), {}, ctx)

    expect(outcome.result).toEqual({ email: 'j@acme.com' })
    expect(outcome.cost).toBe(0.05)
    expect(outcome.error).toBeNull()
    expect(outcome.provider).toBe('B')

    expect(outcome.detail.matchedProvider).toBe('b')
    expect(outcome.detail.totalCost).toBe(0.05)
    // The full cascade is recorded; the provider after the match is `not_run`.
    expect(outcome.detail.providers.map((p) => p.id)).toEqual(['a', 'b', 'c'])
    expect(outcome.detail.providers.map((p) => p.status)).toEqual([
      'no_match',
      'matched',
      'not_run',
    ])
    expect(outcome.detail.providers[1]?.cost).toBe(0.05)
    expect(outcome.detail.providers.every((p) => typeof p.durationMs === 'number')).toBe(true)
    // The tool is never called for the matched-past provider.
    expect(mockExecuteTool).toHaveBeenCalledTimes(2)
  })

  it('marks providers with insufficient inputs as skipped without calling the tool', async () => {
    mockExecuteTool.mockImplementation(() => ({
      success: true,
      output: { email: 'j@acme.com' },
    }))

    const outcome = await runEnrichment(
      config([prov('a', { build: () => null }), prov('b')]),
      {},
      ctx
    )

    expect(outcome.detail.providers[0]).toMatchObject({ id: 'a', status: 'skipped', durationMs: 0 })
    expect(outcome.detail.providers[1]?.status).toBe('matched')
    // Only provider b actually called the tool.
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
  })

  it('threads the isolated row provenance registry through each provider tool call', async () => {
    const registry = new ResolvedSecretTraceRegistry()
    mockExecuteTool.mockResolvedValue({ success: true, output: { email: 'j@acme.com' } })

    await runEnrichment(
      config([prov('a')]),
      {},
      {
        ...ctx,
        resolvedSecretTraceRegistry: registry,
      }
    )

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'tool_a',
      expect.anything(),
      expect.objectContaining({ resolvedSecretTraceRegistry: registry })
    )
  })

  it('sets error only when every provider that ran errored', async () => {
    mockExecuteTool.mockImplementation(() => ({ success: false, output: { status: 500 } }))

    const outcome = await runEnrichment(config([prov('a'), prov('b')]), {}, ctx)

    expect(outcome.result).toEqual({})
    expect(outcome.error).not.toBeNull()
    expect(outcome.provider).toBeNull()
    expect(outcome.detail.matchedProvider).toBeNull()
    expect(outcome.detail.providers.map((p) => p.status)).toEqual(['error', 'error'])
    expect(outcome.detail.providers.every((p) => p.error)).toBe(true)
  })

  it('treats a clean miss (ran, empty result) as no_match with no error', async () => {
    mockExecuteTool.mockImplementation(() => ({ success: true, output: {} }))

    const outcome = await runEnrichment(config([prov('a')]), {}, ctx)

    expect(outcome.result).toEqual({})
    expect(outcome.error).toBeNull()
    expect(outcome.detail.providers.map((p) => p.status)).toEqual(['no_match'])
  })

  it('continues after a provider translates a documented error into a clean miss', async () => {
    mockExecuteTool.mockImplementation((toolId: string) => {
      if (toolId === 'tool_a') {
        return {
          success: false,
          error: 'NO_MATCH',
          output: { status: 400, data: { error: true, error_code: 'NO_MATCH' } },
        }
      }
      return { success: true, output: { email: 'j@acme.com' } }
    })

    const outcome = await runEnrichment(
      config([
        prov('a', {
          projectFailure: (failure) => {
            if (
              typeof failure.output === 'object' &&
              failure.output !== null &&
              'data' in failure.output &&
              typeof failure.output.data === 'object' &&
              failure.output.data !== null &&
              'error_code' in failure.output.data &&
              failure.output.data.error_code === 'NO_MATCH'
            ) {
              return { status: 'no_match' }
            }
            return projectEnrichmentProviderFailure(failure)
          },
        }),
        prov('b'),
      ]),
      {},
      ctx
    )

    expect(outcome.result).toEqual({ email: 'j@acme.com' })
    expect(outcome.error).toBeNull()
    expect(outcome.detail.providers.map((p) => p.status)).toEqual(['no_match', 'matched'])
    expect(mockExecuteTool).toHaveBeenCalledTimes(2)
  })

  it('keeps non-miss provider errors as errors', async () => {
    mockExecuteTool.mockResolvedValue({
      success: false,
      error: 'INVALID_API_KEY',
      output: { status: 400, data: { error: true, error_code: 'INVALID_API_KEY' } },
    })

    const outcome = await runEnrichment(
      config([
        prov('a', {
          projectFailure: (failure) => {
            if (
              typeof failure.output === 'object' &&
              failure.output !== null &&
              'data' in failure.output &&
              typeof failure.output.data === 'object' &&
              failure.output.data !== null &&
              'error_code' in failure.output.data &&
              failure.output.data.error_code === 'NO_MATCH'
            ) {
              return { status: 'no_match' }
            }
            return projectEnrichmentProviderFailure(failure)
          },
        }),
      ]),
      {},
      ctx
    )

    expect(outcome.error).toBe('INVALID_API_KEY')
    expect(outcome.detail.providers.map((p) => p.status)).toEqual(['error'])
  })

  it('skippedEnrichmentDetail marks every provider skipped without running', () => {
    const detail = skippedEnrichmentDetail(config([prov('a'), prov('b')]))
    expect(detail.matchedProvider).toBeNull()
    expect(detail.totalCost).toBe(0)
    expect(detail.providers.map((p) => p.status)).toEqual(['skipped', 'skipped'])
    expect(mockExecuteTool).not.toHaveBeenCalled()
  })

  it('marks unattempted providers not_run when the signal is already aborted', async () => {
    const controller = new AbortController()
    controller.abort()
    const outcome = await runEnrichment(
      config([prov('a'), prov('b')]),
      {},
      {
        ...ctx,
        signal: controller.signal,
      }
    )
    expect(mockExecuteTool).not.toHaveBeenCalled()
    expect(outcome.detail.aborted).toBe(true)
    expect(outcome.detail.providers.map((p) => p.status)).toEqual(['not_run', 'not_run'])
  })

  it('does not error when some providers no-match and only some error', async () => {
    mockExecuteTool.mockImplementation((toolId: string) => {
      if (toolId === 'tool_a') return { success: false, output: { status: 500 } }
      return { success: false, output: { status: 404 } }
    })

    const outcome = await runEnrichment(config([prov('a'), prov('b')]), {}, ctx)

    expect(outcome.error).toBeNull()
    expect(outcome.detail.providers.map((p) => p.status)).toEqual(['error', 'no_match'])
  })
})

/**
 * The per-tool permission gate keys off the acting user, and skips entirely
 * when a tool call carries none. An enrichment that omitted the user therefore
 * sent row data — names, emails, company domains — to its provider with the
 * workspace's `deniedTools` denylist silently not applied.
 */
describe('runEnrichment tool attribution', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('names the acting user on the provider call', async () => {
    mockExecuteTool.mockResolvedValue({ success: true, output: { email: 'a@b.c' } })

    await runEnrichment(
      config([prov('p1')]),
      {},
      {
        workspaceId: 'workspace-1',
        userId: 'user-1',
      }
    )

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'tool_p1',
      expect.objectContaining({
        _context: { workspaceId: 'workspace-1', userId: 'user-1' },
      }),
      expect.anything()
    )
  })
})
