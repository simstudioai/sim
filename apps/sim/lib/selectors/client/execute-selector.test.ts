/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRequestJson } = vi.hoisted(() => ({
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/api/client/request', () => ({ requestJson: mockRequestJson }))

import { loadAllSelectorOptions } from '@/lib/selectors/client/execute-selector'
import { MAX_SELECTOR_OPTIONS, MAX_SELECTOR_PAGES } from '@/lib/selectors/limits'

const input = {
  selectorKey: 'bitbucket.workspaces' as const,
  scope: { kind: 'workspace' as const, workspaceId: 'workspace-1' },
  context: { oauthCredential: 'credential-1' },
}

describe('loadAllSelectorOptions', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('distinguishes a complete boundary-sized catalog from a capped page walk', async () => {
    mockRequestJson.mockResolvedValueOnce({
      kind: 'list',
      items: Array.from({ length: MAX_SELECTOR_OPTIONS }, (_, index) => ({
        id: `option-${index}`,
        label: `Option ${index}`,
      })),
    })

    const complete = await loadAllSelectorOptions(input)

    expect(complete.items).toHaveLength(MAX_SELECTOR_OPTIONS)
    expect(complete.truncated).toBe(false)

    mockRequestJson.mockReset()
    mockRequestJson.mockImplementation(async (...args: unknown[]) => {
      const options = args[1] as { body: { request: { cursor?: string } } }
      const page = Number(options.body.request.cursor ?? '0')
      return {
        kind: 'list',
        items: [{ id: `page-${page}`, label: `Page ${page}` }],
        nextCursor: String(page + 1),
      }
    })

    const capped = await loadAllSelectorOptions(input)

    expect(mockRequestJson).toHaveBeenCalledTimes(MAX_SELECTOR_PAGES)
    expect(capped.items).toHaveLength(MAX_SELECTOR_PAGES)
    expect(capped.truncated).toBe(true)
  })
})
