/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const clientMocks = vi.hoisted(() => ({
  InvalidJupyterTargetError: class extends Error {},
  requestJupyterApi: vi.fn(),
  requestJupyterFile: vi.fn(),
}))

vi.mock('@/lib/internal/jupyter/client', () => clientMocks)
vi.mock('@/lib/internal/jupyter/file-input', () => ({ resolveJupyterUploadFile: vi.fn() }))

import { executeJupyterGetContent } from '@/lib/internal/jupyter/operations'
import { isInternalToolFileResult } from '@/lib/internal/tool-operations/file-result'
import { MAX_BUFFERED_TRANSFER_BYTES } from '@/lib/uploads/shared/types'

const INPUT = {
  serverUrl: 'https://jupyter.example.com/user/alice',
  token: 'token',
  path: 'data/report #1.xlsx',
}
const CONTEXT = { requestId: 'request-1' }
const MIME_TYPE = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'

describe('Jupyter Get Content v2', () => {
  beforeEach(() => vi.clearAllMocks())

  it('downloads a 12 MiB workbook through the raw endpoint and presents only its stored file', async () => {
    const controller = new AbortController()
    const buffer = Buffer.alloc(12 * 1024 * 1024, 42)
    clientMocks.requestJupyterApi.mockResolvedValue(
      Response.json({ name: 'report #1.xlsx', type: 'file', size: buffer.length, content: null })
    )
    clientMocks.requestJupyterFile.mockResolvedValue(
      new Response(buffer, { headers: { 'content-type': MIME_TYPE } })
    )

    const result = await executeJupyterGetContent(INPUT, { ...CONTEXT, signal: controller.signal })
    expect(isInternalToolFileResult(result)).toBe(true)
    if (!isInternalToolFileResult(result)) throw new Error('Expected a file result')
    expect(result.files).toHaveLength(1)
    expect(result.files[0]?.buffer.length).toBe(buffer.length)
    expect(result.files[0]?.buffer.equals(buffer)).toBe(true)
    expect(result.files[0]?.name).toBe('report #1.xlsx')
    expect(result.files[0]?.mimeType).toBe(MIME_TYPE)
    const file = {
      id: 'file-1',
      name: 'report #1.xlsx',
      type: MIME_TYPE,
      mimeType: MIME_TYPE,
      size: buffer.length,
      key: 'execution/file-1',
      url: '/api/files/serve/execution/file-1',
    }
    expect(result.present([file])).toEqual({ success: true, output: { file } })
    expect(clientMocks.requestJupyterApi).toHaveBeenCalledExactlyOnceWith(
      { ...INPUT, method: 'GET', path: 'contents/data/report%20%231.xlsx?content=0' },
      controller.signal
    )
    expect(clientMocks.requestJupyterFile).toHaveBeenCalledExactlyOnceWith(INPUT, controller.signal)
  })

  it('returns text files as stored files without an inline text alias', async () => {
    clientMocks.requestJupyterApi.mockResolvedValue(
      Response.json({ type: 'file', name: 'notes.txt', size: 5 })
    )
    clientMocks.requestJupyterFile.mockResolvedValue(
      new Response('hello', { headers: { 'content-type': 'text/plain; charset=UTF-8' } })
    )
    const result = await executeJupyterGetContent({ ...INPUT, path: 'notes.txt' }, CONTEXT)
    if (!isInternalToolFileResult(result)) throw new Error('Expected a file result')
    expect(result.files[0]?.buffer.toString('utf8')).toBe('hello')
    expect(result.files[0]?.mimeType).toBe('text/plain')
  })

  it.each([
    { type: 'notebook', content: { cells: [{ cell_type: 'code', source: ['1 + 1'] }] } },
    { type: 'directory', content: [{ type: 'file', name: 'data.csv', path: 'docs/data.csv' }] },
  ])('preserves structured $type output without a raw file request', async ({ type, content }) => {
    clientMocks.requestJupyterApi
      .mockResolvedValueOnce(Response.json({ name: 'docs', path: 'docs', type, content: null }))
      .mockResolvedValueOnce(
        Response.json({ name: 'docs', path: 'docs', type, content, format: 'json', mimetype: null })
      )
    const response = await executeJupyterGetContent({ ...INPUT, path: 'docs' }, CONTEXT)
    if (!(response instanceof Response)) throw new Error('Expected structured content')
    await expect(response.json()).resolves.toEqual({
      success: true,
      output: {
        name: 'docs',
        path: 'docs',
        mimetype: null,
        text: JSON.stringify(content),
        file: null,
      },
    })
    expect(clientMocks.requestJupyterApi).toHaveBeenNthCalledWith(
      2,
      { ...INPUT, method: 'GET', path: `contents/docs?content=1&type=${type}` },
      undefined
    )
    expect(clientMocks.requestJupyterFile).not.toHaveBeenCalled()
  })

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

  it.each(['metadata', 'download'])(
    'preserves an upstream %s failure without returning a file',
    async (stage) => {
      const errorResponse = new Response('not found', { status: 404 })
      clientMocks.requestJupyterApi.mockResolvedValue(
        stage === 'metadata' ? errorResponse : Response.json({ type: 'file' })
      )
      clientMocks.requestJupyterFile.mockResolvedValue(errorResponse)
      const response = await executeJupyterGetContent(INPUT, CONTEXT)
      if (!(response instanceof Response)) throw new Error('Expected an upstream error')
      expect(response.status).toBe(404)
      await expect(response.json()).resolves.toEqual({ error: 'Jupyter API error: 404 not found' })
    }
  )

  it('does not fetch raw bytes when cancellation arrives after metadata', async () => {
    const controller = new AbortController()
    clientMocks.requestJupyterApi.mockImplementation(async () => {
      controller.abort(new DOMException('cancelled', 'AbortError'))
      return Response.json({ type: 'file' })
    })
    await expect(
      executeJupyterGetContent(INPUT, { ...CONTEXT, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(clientMocks.requestJupyterFile).not.toHaveBeenCalled()
  })

  it('rejects malformed metadata without requesting raw bytes', async () => {
    clientMocks.requestJupyterApi.mockResolvedValue(Response.json({ type: 'unexpected' }))
    const response = await executeJupyterGetContent(INPUT, CONTEXT)
    if (!(response instanceof Response)) throw new Error('Expected an invalid model error')
    expect(response.status).toBe(502)
    expect(clientMocks.requestJupyterFile).not.toHaveBeenCalled()
  })
})
