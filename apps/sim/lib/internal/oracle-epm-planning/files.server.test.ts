/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ open: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: mocks.open,
  storeOracleEpmDownload: mocks.store,
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
}))
vi.mock('@sim/logger', () => ({ createLogger: () => ({ warn: vi.fn() }) }))

import { PayloadSizeLimitError } from '@/lib/core/utils/stream-limits'
import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import {
  downloadPlanningFile,
  uploadPlanningFile,
} from '@/lib/internal/oracle-epm-planning/files.server'
import {
  PLANNING_DOWNLOAD_BYTES,
  PLANNING_INPUT_FILE_BYTES,
  PLANNING_UPLOAD_CHUNK_BYTES,
  planningEndpoints,
} from '@/lib/internal/oracle-epm-planning/route-space'
import type { PlanningOperationContext } from '@/lib/internal/oracle-epm-planning/schema'
import type { UserFile } from '@/executor/types'

const auth = {
  oauthCredential: 'credential-1',
  instanceUrl: 'https://epm.example.com/gateway',
  accessToken: Buffer.from('test:fixture').toString('base64'),
}
const file: UserFile = {
  id: 'file-1',
  key: 'workspace/authorized/data.csv',
  name: 'data.csv',
  url: 'https://untrusted.example.com/never-fetch',
  size: 3,
  type: 'text/csv',
}
const stored: UserFile = {
  ...file,
  key: 'execution/stored.csv',
  url: 'https://storage.example.com/signed',
  context: 'execution',
}
const request = vi.fn()
const requestValidatedLink = vi.fn()
const client = createOracleEpmClient(auth)
const runtime = {
  userId: 'user-1',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  workflowId: '22222222-2222-4222-8222-222222222222',
  executionId: '33333333-3333-4333-8333-333333333333',
}
const context: PlanningOperationContext = {
  client: { request, requestValidatedLink, validateReturnedLink: client.validateReturnedLink },
  runtime,
}
const ok = { status: 200, data: { status: 0, details: null } }
function source(chunks: Buffer[]) {
  return {
    fileName: 'data.csv',
    contentType: 'text/csv',
    maxBytes: PLANNING_INPUT_FILE_BYTES,
    chunks: (async function* () {
      for (const chunk of chunks) yield chunk
    })(),
  }
}
function downloadResponse() {
  return {
    status: 200,
    contentType: 'application/octet-stream',
    contentLength: 3,
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array([1, 2, 3]))
        controller.close()
      },
    }),
  }
}
function startDownload(metadata: { contentLength?: number } = { contentLength: 3 }) {
  request.mockImplementation(async (endpoint) =>
    endpoint === planningEndpoints.startDownload
      ? {
          status: 200,
          data: {
            status: -1,
            details: null,
            links: [
              {
                rel: 'Job Status',
                action: 'GET',
                href: 'https://epm.example.com/gateway/interop/rest/v2/status/download/42',
              },
            ],
          },
        }
      : ok
  )
  requestValidatedLink
    .mockResolvedValueOnce({
      status: 200,
      data: {
        status: 0,
        details: null,
        items: null,
        links: [
          {
            rel: 'Download link',
            action: 'GET',
            href: 'https://epm.example.com/gateway/interop/rest/v2/files/download/42',
          },
        ],
      },
    })
    .mockResolvedValueOnce({ ...downloadResponse(), contentLength: metadata.contentLength })
}

describe('Planning file orchestration over foundation primitives', () => {
  beforeEach(() => {
    request.mockReset()
    requestValidatedLink.mockReset()
    mocks.open.mockReset()
    mocks.store.mockReset()
    request.mockResolvedValue(ok)
    mocks.open.mockResolvedValue(source([Buffer.from('abc')]))
    mocks.store.mockResolvedValue(stored)
  })
  afterEach(() => vi.useRealTimers())
  it('authorizes the source before initialization, never fetching its URL', async () => {
    mocks.open.mockRejectedValue(new Error('Not authorized'))
    await expect(uploadPlanningFile({ ...auth, file }, context)).rejects.toThrow('Not authorized')
    expect(request).not.toHaveBeenCalled()
    expect(mocks.open).toHaveBeenCalledWith({
      file,
      userId: runtime.userId,
      maxBytes: PLANNING_INPUT_FILE_BYTES,
      signal: undefined,
    })
  })
  it('uses the official v1 initialization, numbered inclusive range and completion requests', async () => {
    expect(await uploadPlanningFile({ ...auth, file }, context)).toEqual({
      fileName: 'data.csv',
      size: 3,
      status: 0,
    })
    expect(request.mock.calls.map(([endpoint]) => endpoint)).toEqual([
      planningEndpoints.uploadControl,
      planningEndpoints.uploadChunk,
      planningEndpoints.uploadControl,
    ])
    expect(JSON.parse(request.mock.calls[0][1].query.q)).toEqual({
      isFirst: true,
      isLast: false,
      chunkSize: 14,
      fileSize: '3',
    })
    expect(request.mock.calls[1][1].stream).toEqual(Buffer.from('abc'))
    expect(JSON.parse(request.mock.calls[1][1].query.q)).toEqual({
      isFirst: false,
      isLast: false,
      chunkSize: 3,
      fileSize: '3',
      startRange: '0',
      endRange: '2',
      chunkNo: 1,
    })
    expect(JSON.parse(request.mock.calls[2][1].query.q)).toEqual({
      isFirst: false,
      isLast: true,
      chunkSize: 14,
      fileSize: '3',
    })
    expect(mocks.open.mock.invocationCallOrder[0]).toBeLessThan(request.mock.invocationCallOrder[0])
  })
  it('splits source chunks sequentially at the bounded upload size', async () => {
    const size = PLANNING_UPLOAD_CHUNK_BYTES + 3
    mocks.open.mockResolvedValue(source([Buffer.alloc(size)]))
    await uploadPlanningFile({ ...auth, file: { ...file, size } }, context)
    const chunks = request.mock.calls.filter(
      ([endpoint]) => endpoint === planningEndpoints.uploadChunk
    )
    expect(chunks.map(([, input]) => input.stream.byteLength)).toEqual([
      PLANNING_UPLOAD_CHUNK_BYTES,
      3,
    ])
    expect(JSON.parse(chunks[1][1].query.q)).toMatchObject({
      startRange: String(PLANNING_UPLOAD_CHUNK_BYTES),
      endRange: String(size - 1),
      chunkNo: 2,
    })
  })
  it.each([2, 4])(
    'rejects declared size %i when actual bytes differ; never finalizes or deletes repository files',
    async (size) => {
      await expect(
        uploadPlanningFile({ ...auth, file: { ...file, size } }, context)
      ).rejects.toThrow('declared size')
      expect(
        request.mock.calls.some(
          ([endpoint, input]) =>
            endpoint === planningEndpoints.uploadControl && JSON.parse(input.query.q).isLast
        )
      ).toBe(false)
      expect(
        request.mock.calls.some(([endpoint]) => endpoint === planningEndpoints.deleteFile)
      ).toBe(false)
    }
  )
  it('does not delete an existing file when Oracle reports a conflict', async () => {
    request.mockResolvedValue({ status: 200, data: { status: 1, details: 'File already exists' } })
    await expect(uploadPlanningFile({ ...auth, file }, context)).rejects.toThrow('file conflicts')
    expect(request).toHaveBeenCalledTimes(1)
    expect(request.mock.calls[0][0]).toBe(planningEndpoints.uploadControl)
  })
  it('polls extraction only after completing upload', async () => {
    request
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce(ok)
      .mockResolvedValueOnce({
        status: 200,
        data: {
          status: -1,
          details: null,
          links: [
            {
              rel: 'Job Status',
              method: 'GET',
              href: 'https://epm.example.com/gateway/interop/rest/v1/services/jobs/42',
            },
          ],
        },
      })
    requestValidatedLink.mockResolvedValue(ok)
    await uploadPlanningFile({ ...auth, file }, context)
    expect(requestValidatedLink).toHaveBeenCalledTimes(1)
    expect(request).toHaveBeenCalledTimes(3)
  })
  it('stores binary data with the fixed 100 MiB ceiling, then deletes only the temporary resource', async () => {
    startDownload()
    expect(await downloadPlanningFile({ ...auth, fileName: 'data.csv' }, context)).toEqual(stored)
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({
        maxBytes: PLANNING_DOWNLOAD_BYTES,
        context: {
          workspaceId: runtime.workspaceId,
          workflowId: runtime.workflowId,
          executionId: runtime.executionId,
        },
        fileName: 'data.csv',
      })
    )
    expect(request.mock.calls.at(-1)).toEqual([
      planningEndpoints.cleanupDownload,
      expect.objectContaining({ pathParams: { jobId: '42' } }),
    ])
    expect(request.mock.calls.some(([endpoint]) => endpoint === planningEndpoints.deleteFile)).toBe(
      false
    )
  })
  it.each(['unknown', 'understated', 'declared'])(
    'cleans temporary data on %s-size overflow reported by foundation storage',
    async (kind) => {
      const contentLength =
        kind === 'unknown' ? undefined : kind === 'understated' ? 1 : PLANNING_DOWNLOAD_BYTES + 1
      startDownload({ contentLength })
      mocks.store.mockRejectedValue(
        new PayloadSizeLimitError({
          label: 'Oracle EPM download',
          maxBytes: PLANNING_DOWNLOAD_BYTES,
          observedBytes: PLANNING_DOWNLOAD_BYTES + 1,
        })
      )
      await expect(
        downloadPlanningFile({ ...auth, fileName: 'large.zip' }, context)
      ).rejects.toThrow('100 MiB')
      expect(mocks.store).toHaveBeenCalledWith(expect.objectContaining({ contentLength }))
      expect(request.mock.calls.at(-1)?.[0]).toBe(planningEndpoints.cleanupDownload)
    }
  )
  it('attempts cleanup after polling cancellation with a fresh bounded signal', async () => {
    startDownload()
    const controller = new AbortController()
    requestValidatedLink.mockReset().mockImplementation(async () => {
      controller.abort(new DOMException('Stopped', 'AbortError'))
      throw controller.signal.reason
    })
    await expect(
      downloadPlanningFile(
        { ...auth, fileName: 'data.csv' },
        { ...context, signal: controller.signal }
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    const [endpoint, input] = request.mock.calls.at(-1)!
    expect(endpoint).toBe(planningEndpoints.cleanupDownload)
    expect(input.signal.aborted).toBe(false)
    expect(input.signal).not.toBe(controller.signal)
  })
  it('rejects a download link for another job and still cleans its own resource', async () => {
    startDownload()
    requestValidatedLink.mockReset().mockResolvedValue({
      status: 200,
      data: {
        status: 0,
        details: null,
        links: [
          {
            rel: 'Download link',
            href: 'https://epm.example.com/gateway/interop/rest/v2/files/download/99',
          },
        ],
      },
    })
    await expect(downloadPlanningFile({ ...auth, fileName: 'data.csv' }, context)).rejects.toThrow(
      'documented contract'
    )
    expect(mocks.store).not.toHaveBeenCalled()
    expect(request.mock.calls.at(-1)?.[1].pathParams).toEqual({ jobId: '42' })
  })
  it('rejects JSON errors instead of storing them as files', async () => {
    startDownload()
    requestValidatedLink
      .mockReset()
      .mockResolvedValueOnce({
        status: 200,
        data: {
          status: 0,
          details: null,
          links: [
            {
              rel: 'Download link',
              href: 'https://epm.example.com/gateway/interop/rest/v2/files/download/42',
            },
          ],
        },
      })
      .mockResolvedValueOnce({
        ...downloadResponse(),
        contentType: 'application/json; charset=utf-8',
      })
    await expect(downloadPlanningFile({ ...auth, fileName: 'data.csv' }, context)).rejects.toThrow(
      'instead of downloadable'
    )
    expect(mocks.store).not.toHaveBeenCalled()
    expect(request.mock.calls.at(-1)?.[0]).toBe(planningEndpoints.cleanupDownload)
  })
  it('requires trusted execution scope before creating temporary resources', async () => {
    await expect(
      downloadPlanningFile(
        { ...auth, fileName: 'data.csv' },
        { ...context, runtime: { workflowId: 'invalid' } }
      )
    ).rejects.toThrow('execution file context')
    expect(request).not.toHaveBeenCalled()
  })
})
