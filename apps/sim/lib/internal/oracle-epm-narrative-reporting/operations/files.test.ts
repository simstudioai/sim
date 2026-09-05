/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { store } = vi.hoisted(() => ({ store: vi.fn() }))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({ storeOracleEpmDownload: store }))

import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { downloadBookOutput } from '@/lib/internal/oracle-epm-narrative-reporting/operations/books'
import { downloadReportSnapshotOutput } from '@/lib/internal/oracle-epm-narrative-reporting/operations/report-snapshots'
import { downloadReportOutput } from '@/lib/internal/oracle-epm-narrative-reporting/operations/reports'
import {
  NARRATIVE_MAX_DOWNLOAD_BYTES,
  narrativeEndpoints,
} from '@/lib/internal/oracle-epm-narrative-reporting/routes'

const request = vi.fn()
const execution = {
  workflowId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  executionId: '33333333-3333-4333-8333-333333333333',
}
const context = {
  client: { request, validateReturnedLink: vi.fn(), requestValidatedLink: vi.fn() },
  execution,
  signal: new AbortController().signal,
} satisfies NarrativeOperationContext
const input = {
  oauthCredential: 'credential',
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://epm.example.com',
  resourceId: 'r',
  format: 'pdf' as const,
}
const file = {
  id: 'file',
  name: 'report.pdf',
  url: '/api/files/serve/execution/file',
  size: 4,
  type: 'application/pdf',
  key: 'execution/file',
}
beforeEach(() => {
  vi.clearAllMocks()
  store.mockResolvedValue(file)
})
function response(contentType = 'application/pdf', status = 200) {
  const cancel = vi.fn()
  const body = new ReadableStream<Uint8Array>({ cancel })
  return { body, cancel, status, contentType, contentLength: 4 }
}
describe('Narrative rendered downloads', () => {
  it('checks trusted storage scope before making a provider request', async () => {
    await expect(
      downloadReportOutput(input, { ...context, execution: { workflowId: execution.workflowId } })
    ).rejects.toMatchObject({ category: 'invalid_input' })
    expect(request).not.toHaveBeenCalled()
    expect(store).not.toHaveBeenCalled()
  })
  it('passes the stream and trusted execution scope to bounded storage and returns only a UserFile', async () => {
    const stream = response()
    request.mockResolvedValue(stream)
    const result = await downloadReportOutput(
      { ...input, fileName: 'report.pdf', globalPov: 'Year:2026', prompts: 'p:Actual' },
      context
    )
    expect(request).toHaveBeenCalledExactlyOnceWith(narrativeEndpoints.downloadReport, {
      pathParams: { id: 'r' },
      query: { format: 'pdf', globalPov: 'Year:2026', prompts: 'p:Actual' },
      signal: context.signal,
    })
    expect(store).toHaveBeenCalledExactlyOnceWith({
      body: stream.body,
      fileName: 'report.pdf',
      contentType: 'application/pdf',
      contentLength: 4,
      context: execution,
      maxBytes: NARRATIVE_MAX_DOWNLOAD_BYTES,
      signal: context.signal,
    })
    expect(result).toEqual({ success: true, output: { file } })
  })
  it.each(['application/json', 'text/html', '', 'application/octet-stream'])(
    'rejects unexpected report media %s and closes the stream',
    async (contentType) => {
      const stream = response(contentType)
      request.mockResolvedValue(stream)
      await expect(downloadReportOutput(input, context)).rejects.toMatchObject({
        category: 'invalid_response',
      })
      expect(store).not.toHaveBeenCalled()
      expect(stream.cancel).toHaveBeenCalledTimes(1)
    }
  )
  it('does not mistake a 202 or a JSON envelope for a completed download', async () => {
    request.mockResolvedValue(response('application/pdf', 202))
    await expect(downloadReportOutput(input, context)).rejects.toMatchObject({
      category: 'invalid_response',
    })
    request.mockResolvedValue({ status: 200, data: { preview: 'pending' } })
    await expect(downloadReportOutput(input, context)).rejects.toMatchObject({
      category: 'invalid_response',
    })
    expect(store).not.toHaveBeenCalled()
  })
  it('closes the provider stream if storage fails before acquiring its reader', async () => {
    const stream = response()
    request.mockResolvedValue(stream)
    store.mockRejectedValue(new Error('storage failed'))
    await expect(downloadReportOutput(input, context)).rejects.toThrow('storage failed')
    expect(stream.cancel).toHaveBeenCalledTimes(1)
  })
  it('executes books with a bodyless POST policy and the documented XLSX media', async () => {
    request.mockResolvedValue(
      response('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
    )
    await downloadBookOutput({ ...input, format: 'xlsx', globalPov: 'Year:2026' }, context)
    expect(request).toHaveBeenCalledExactlyOnceWith(narrativeEndpoints.downloadBook, {
      pathParams: { id: 'r' },
      query: { format: 'xlsx', globalPov: 'Year:2026' },
      signal: context.signal,
    })
  })
  it('uses the snapshot-specific documented octet-stream contract', async () => {
    request.mockResolvedValue(response('application/octet-stream'))
    await downloadReportSnapshotOutput(input, context)
    expect(store).toHaveBeenCalledWith(
      expect.objectContaining({ contentType: 'application/octet-stream', maxBytes: 104_857_600 })
    )
  })
})
