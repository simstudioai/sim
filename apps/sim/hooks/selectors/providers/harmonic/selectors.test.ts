/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({ mockRequestJson: vi.fn() }))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

import { selectorContractsByPath } from '@/lib/api/contracts/selectors'
import { getSelectorDefinition } from '@/hooks/selectors/registry'
import type { SelectorQueryArgs } from '@/hooks/selectors/types'

const selector = getSelectorDefinition('harmonic.savedSearches')

function selectorArgs(
  overrides: Partial<SelectorQueryArgs> = {},
  contextOverrides: Partial<SelectorQueryArgs['context']> = {}
): SelectorQueryArgs {
  return {
    key: 'harmonic.savedSearches',
    context: {
      oauthCredential: 'credential-1',
      workflowId: 'workflow-1',
      ...contextOverrides,
    },
    ...overrides,
  }
}

const savedSearches = [
  { id: '17', urn: 'urn:harmonic:saved_search:17', name: 'FDE candidates' },
  { id: '28', urn: 'urn:harmonic:saved_search:28', name: 'Enterprise operators' },
]

describe('harmonic.savedSearches selector', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestJson.mockResolvedValue({ savedSearches })
  })

  it('is registered with the canonical contract and waits for both authorization dependencies', () => {
    expect(selector.key).toBe('harmonic.savedSearches')
    expect(selector.contracts).toEqual([
      expect.objectContaining({
        method: 'POST',
        path: '/api/tools/harmonic/saved-searches',
      }),
    ])
    expect(selector.contracts?.[0]).toBe(
      selectorContractsByPath['/api/tools/harmonic/saved-searches']
    )
    expect(selector.enabled?.(selectorArgs())).toBe(true)
    expect(selector.enabled?.(selectorArgs({}, { oauthCredential: undefined }))).toBe(false)
    expect(selector.enabled?.(selectorArgs({}, { workflowId: undefined }))).toBe(false)
  })

  it('isolates the query cache by workflow and credential', () => {
    expect(selector.getQueryKey(selectorArgs())).toEqual([
      'selectors',
      'harmonic.savedSearches',
      'workflow-1',
      'credential-1',
    ])
    expect(selector.getQueryKey(selectorArgs({}, { oauthCredential: 'credential-2' }))).toEqual([
      'selectors',
      'harmonic.savedSearches',
      'workflow-1',
      'credential-2',
    ])
    expect(selector.getQueryKey(selectorArgs({}, { workflowId: 'workflow-2' }))).toEqual([
      'selectors',
      'harmonic.savedSearches',
      'workflow-2',
      'credential-1',
    ])
  })

  it('loads safe options through requestJson and uses the full URN as the selected value', async () => {
    const controller = new AbortController()
    const options = await selector.fetchList?.(selectorArgs({ signal: controller.signal }))

    expect(mockRequestJson).toHaveBeenCalledWith(
      expect.objectContaining({
        method: 'POST',
        path: '/api/tools/harmonic/saved-searches',
      }),
      {
        body: { credential: 'credential-1', workflowId: 'workflow-1' },
        signal: controller.signal,
      }
    )
    expect(options).toEqual([
      {
        id: 'urn:harmonic:saved_search:17',
        label: 'FDE candidates',
        meta: {
          id: '17',
          urn: 'urn:harmonic:saved_search:17',
          name: 'FDE candidates',
        },
      },
      {
        id: 'urn:harmonic:saved_search:28',
        label: 'Enterprise operators',
        meta: {
          id: '28',
          urn: 'urn:harmonic:saved_search:28',
          name: 'Enterprise operators',
        },
      },
    ])
  })

  it.each([
    ['numeric ID', '17'],
    ['full URN', 'urn:harmonic:saved_search:17'],
  ])('resolves a persisted %s to the canonical full-URN option', async (_label, detailId) => {
    const option = await selector.fetchById?.(selectorArgs({ detailId }))

    expect(option).toEqual({
      id: 'urn:harmonic:saved_search:17',
      label: 'FDE candidates',
      meta: {
        id: '17',
        urn: 'urn:harmonic:saved_search:17',
        name: 'FDE candidates',
      },
    })
  })

  it('returns null for an unavailable ID and declares speculative resolution safe', async () => {
    expect(selector.resolvesUnknownIds).toBe(true)
    await expect(selector.fetchById?.(selectorArgs({ detailId: '999' }))).resolves.toBeNull()
  })

  it('does not request options when detail resolution is missing its credential scope', async () => {
    await expect(
      selector.fetchById?.(selectorArgs({ detailId: '17' }, { oauthCredential: undefined }))
    ).resolves.toBeNull()
    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it.each([
    ['credential', { oauthCredential: undefined }],
    ['workflow ID', { workflowId: undefined }],
  ])('rejects a missing %s before issuing a request', async (_label, context) => {
    await expect(selector.fetchList?.(selectorArgs({}, context))).rejects.toThrow(/Missing/)
    expect(mockRequestJson).not.toHaveBeenCalled()
  })
})
