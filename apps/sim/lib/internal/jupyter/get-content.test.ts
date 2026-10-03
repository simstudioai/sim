import { describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  InvalidJupyterTargetError: class extends Error {},
  requestJupyterApi: vi.fn(),
  requestJupyterFile: vi.fn(),
}))

vi.mock('@/lib/internal/jupyter/client', () => clientMocks)
vi.mock('@/lib/internal/jupyter/file-input', () => ({ resolveJupyterUploadFile: vi.fn() }))

import { executeJupyterGetContent } from '@/lib/internal/jupyter/operations'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const INPUT = {
  serverUrl: 'https://jupyter.example.com/user/alice',
  token: 'token',
  path: 'data/report #1.xlsx',
}
const CONTEXT = { requestId: 'request-1' }

describe('Jupyter Get Content v2', () => {
  it('rejects oversized metadata before reading file bytes', async () => {
    clientMocks.requestJupyterApi.mockResolvedValue(
      Response.json({ type: 'file', size: MAX_BUFFERED_TRANSFER_BYTES + 1 })
    )
    const response = await executeJupyterGetContent(INPUT, CONTEXT)
    if (!(response instanceof Response)) throw new Error('Expected a size error')
    expect(response.status).toBe(413)
    expect(clientMocks.requestJupyterFile).not.toHaveBeenCalled()
  })

  it('enforces the raw byte cap when metadata size is missing or wrong', async () => {
    const cancel = vi.fn()
    clientMocks.requestJupyterApi.mockResolvedValue(Response.json({ type: 'file', size: 1 }))
    clientMocks.requestJupyterFile.mockResolvedValue(
      new Response(new ReadableStream({ cancel }), {
        headers: { 'content-length': String(MAX_BUFFERED_TRANSFER_BYTES + 1) },
      })
    )
    await expect(executeJupyterGetContent(INPUT, CONTEXT)).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
      maxBytes: MAX_BUFFERED_TRANSFER_BYTES,
    })
    expect(cancel).toHaveBeenCalledOnce()
  })

  it('keeps notebook JSON bounded at 10 MiB', async () => {
    clientMocks.requestJupyterApi
      .mockResolvedValueOnce(Response.json({ type: 'notebook' }))
      .mockResolvedValueOnce(
        new Response('', { headers: { 'content-length': String(10 * 1024 * 1024 + 1) } })
      )
    await expect(executeJupyterGetContent(INPUT, CONTEXT)).rejects.toMatchObject({
      name: 'PayloadSizeLimitError',
      maxBytes: 10 * 1024 * 1024,
    })
    expect(clientMocks.requestJupyterFile).not.toHaveBeenCalled()
  })
})
