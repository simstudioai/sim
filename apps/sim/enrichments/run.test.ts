/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({ mockExecuteTool: vi.fn() }))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { runEnrichment, skippedEnrichmentDetail } from '@/enrichments/run'
import type { EnrichmentConfig, EnrichmentProvider } from '@/enrichments/types'

const ICON = (() => null) as unknown as EnrichmentConfig['icon']

function prov(
  id: string,
  opts: {
    build?: (inputs: Record<string, unknown>) => Record<string, unknown> | null
    map?: (output: Record<string, unknown>) => Record<string, unknown> | null
  } = {}
): EnrichmentProvider {
  return {
    id,
    label: id.toUpperCase(),
    toolId: `tool_${id}`,
    buildParams: opts.build ?? (() => ({ q: 'x' })),
    mapOutput: opts.map ?? ((o) => (o.email ? { email: o.email } : null)),
  }
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

const ctx = { workspaceId: 'ws-1' }

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
