import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

const { mockSecureFetchWithPinnedIP, mockValidateUrlWithDNS } = inputValidationMockFns

import { downloadCursorArtifact } from '@/lib/internal/cursor/operations'

const storedFile = {
  id: 'stored-file',
  name: 'stored.bin',
  size: 5,
  type: 'application/octet-stream',
  mimeType: 'application/octet-stream',
  url: '/api/files/stored',
  key: 'execution/workspace/workflow/run/stored.bin',
  context: 'execution',
} as const

describe('downloadCursorArtifact', () => {
  beforeEach(() => {
    mockValidateUrlWithDNS.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.1' })
    mockSecureFetchWithPinnedIP.mockResolvedValue(
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
      { requestId: 'request-1', signal: controller.signal },
      'v2'
    )

    expect(fetchMock).toHaveBeenCalledOnce()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/agents/agent-1/artifacts/download'),
      expect.objectContaining({ signal: controller.signal })
    )
    expect(mockSecureFetchWithPinnedIP).toHaveBeenCalledWith(
      'https://download.example/artifact',
      '203.0.113.1',
      { profile: 'contentFetch', signal: controller.signal }
    )
    expect(result.files).toEqual([
      { name: 'index.ts', mimeType: 'text/plain', buffer: Buffer.from('artifact') },
    ])
    expect(result.present([storedFile])).toMatchObject({
      success: true,
      output: { file: storedFile },
    })
  })
})
