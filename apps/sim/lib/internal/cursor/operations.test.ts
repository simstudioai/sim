/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secureFetchWithPinnedIP: vi.fn(),
  validateUrlWithDNS: vi.fn(),
}))

vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetchWithPinnedIP,
  validateUrlWithDNS: mocks.validateUrlWithDNS,
}))

import { downloadCursorArtifact } from '@/lib/internal/cursor/operations'

describe('downloadCursorArtifact', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.unstubAllGlobals()
    mocks.validateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mocks.secureFetchWithPinnedIP.mockResolvedValue(
      new Response('artifact', { headers: { 'content-type': 'text/plain' } })
    )
  })

  it('uses one metadata request and one DNS-pinned artifact download with cancellation', async () => {
    const controller = new AbortController()
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ url: 'https://download.example/artifact' }))
    vi.stubGlobal('fetch', fetchMock)

    const result = await downloadCursorArtifact(
      { apiKey: 'cursor-key', agentId: 'agent-1', path: '/src/index.ts' },
      { requestId: 'request-1', signal: controller.signal }
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agents/agent-1/artifacts/download'),
      expect.objectContaining({ signal: controller.signal })
    )
    expect(mocks.secureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://download.example/artifact',
      '203.0.113.1',
      { signal: controller.signal }
    )
    expect(result.output.file).toEqual({
      name: 'index.ts',
      mimeType: 'text/plain',
      data: Buffer.from('artifact').toString('base64'),
      size: 8,
    })
  })
})
