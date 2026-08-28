/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockExecuteTool } = vi.hoisted(() => ({ mockExecuteTool: vi.fn() }))

vi.mock('@/lib/core/config/env', () => ({ env: { EXA_API_KEY: 'exa-key' } }))
vi.mock('@/tools', () => ({ executeTool: mockExecuteTool }))

import { executeSearchOperation } from '@/lib/internal/search/operations'

describe('executeSearchOperation', () => {
  beforeEach(() => vi.clearAllMocks())

  it('projects the external Exa result into the canonical search output', async () => {
    mockExecuteTool.mockResolvedValue({
      success: true,
      output: {
        results: [
          {
            title: 'Result',
            url: 'https://example.com',
            highlights: ['First', 'Second'],
            publishedDate: '2026-08-27',
          },
        ],
      },
    })

    const output = await executeSearchOperation({ query: 'test query' })

    expect(mockExecuteTool).toHaveBeenCalledWith(
      'exa_search',
      expect.objectContaining({ query: 'test query', apiKey: 'exa-key' }),
      { signal: undefined }
    )
    expect(output).toMatchObject({
      query: 'test query',
      totalResults: 1,
      source: 'exa',
      results: [
        {
          title: 'Result',
          link: 'https://example.com',
          snippet: 'First ... Second',
          date: '2026-08-27',
          position: 1,
        },
      ],
    })
  })

  it('propagates external search failures without retrying the composite operation', async () => {
    mockExecuteTool.mockResolvedValue({ success: false, error: 'provider failed' })

    await expect(executeSearchOperation({ query: 'test query' })).rejects.toThrow('provider failed')
    expect(mockExecuteTool).toHaveBeenCalledTimes(1)
  })
})
