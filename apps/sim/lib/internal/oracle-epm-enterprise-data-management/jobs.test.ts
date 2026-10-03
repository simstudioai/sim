/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  storeOracleEpmDownload: mocks.store,
  openOracleEpmSourceFile: vi.fn(),
}))

import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { edmEndpoints } from '@/lib/internal/oracle-epm-enterprise-data-management/endpoints'
import {
  downloadEdmJobResult,
  startEdmJob,
  waitForEdmJob,
} from '@/lib/internal/oracle-epm-enterprise-data-management/jobs'
import type { EdmOperationContext } from '@/lib/internal/oracle-epm-enterprise-data-management/types'

const id = '11111111-1111-4111-8111-111111111111'
const origin = 'https://edm.example.com'
const root = `${origin}/epm/rest/v1`
const context: EdmOperationContext = {
  client: createOracleEpmClient({ instanceUrl: origin, accessToken: 'dTpw' }),
  instanceUrl: origin,
  execution: { workflowId: id, workspaceId: id, executionId: id, userId: 'user' },
}
const wait = { waitForCompletion: true, maxWaitSeconds: 120 }
const accepted = { links: [{ rel: 'results', href: `${root}/jobRuns/${id}` }] }
describe('EDM asynchronous completion and resume', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.store.mockResolvedValue({
      id: 'file',
      name: 'account.csv',
      key: 'execution/account.csv',
      url: 'https://storage.example.com/signed',
      size: 3,
      type: 'text/csv',
      context: 'execution',
    })
  })
  afterEach(() => vi.useRealTimers())
  it('returns an accepted job without polling when wait is explicitly false', async () => {
    mocks.fetch.mockResolvedValue(Response.json(accepted))
    const result = await startEdmJob(
      edmEndpoints.exportDimension,
      { fileName: 'account.csv' },
      { ...wait, waitForCompletion: false },
      context,
      undefined,
      'account.csv'
    )
    expect(result).toMatchObject({
      jobId: id,
      completed: false,
      timedOut: false,
      job: null,
      fileName: 'account.csv',
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.store).not.toHaveBeenCalled()
  })
  it('polls a running job to completion using the shared polling primitive', async () => {
    vi.useFakeTimers()
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ id, status: 'RUNNING' }))
      .mockResolvedValueOnce(Response.json({ id, status: 'COMPLETED' }))
    const pending = waitForEdmJob(id, wait, context)
    await vi.advanceTimersByTimeAsync(5000)
    expect(await pending).toMatchObject({
      jobId: id,
      job: { status: 'COMPLETED' },
      completed: true,
      timedOut: false,
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })
  it('reports provider failure without treating it as successful completion', async () => {
    mocks.fetch.mockResolvedValue(
      Response.json({ id, status: 'ERROR', error: 'Validation failed' })
    )
    expect(await waitForEdmJob(id, wait, context)).toMatchObject({
      completed: false,
      timedOut: false,
      job: { status: 'ERROR' },
    })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('preserves the job ID and last snapshot on a local timeout', async () => {
    vi.useFakeTimers()
    mocks.fetch.mockImplementation(async () => Response.json({ id, status: 'RUNNING' }))
    const pending = waitForEdmJob(id, { ...wait, maxWaitSeconds: 1 }, context)
    await vi.advanceTimersByTimeAsync(2000)
    expect(await pending).toMatchObject({
      jobId: id,
      completed: false,
      timedOut: true,
      job: { status: 'RUNNING' },
    })
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })
  it('propagates caller cancellation without claiming that the remote job was cancelled', async () => {
    const controller = new AbortController()
    mocks.fetch.mockImplementation(async () => {
      controller.abort(new DOMException('User cancelled', 'AbortError'))
      return Response.json({ id, status: 'RUNNING' })
    })
    await expect(
      waitForEdmJob(id, wait, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })
  it('completes a by-name export, retrieves its opaque result, then stores the explicitly named staging file', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(accepted))
      .mockResolvedValueOnce(
        Response.json({
          id,
          status: 'COMPLETED',
          links: [{ rel: 'results', href: `${root}/jobRuns/${id}/result` }],
        })
      )
      .mockResolvedValueOnce(
        Response.json({ id, status: 'COMPLETED', result: { providerSpecific: true } })
      )
      .mockResolvedValueOnce(
        new Response('abc', { headers: { 'Content-Type': 'text/csv', 'Content-Length': '3' } })
      )
    const result = await startEdmJob(
      edmEndpoints.exportDimension,
      { fileName: 'account.csv' },
      wait,
      context,
      undefined,
      'account.csv'
    )
    expect(result).toMatchObject({
      completed: true,
      result: { result: { providerSpecific: true } },
      file: { context: 'execution', name: 'account.csv' },
    })
    expect(mocks.fetch.mock.calls.map((call) => new URL(call[0]).pathname)).toEqual([
      '/epm/rest/v1/dimensions/byName/export',
      `/epm/rest/v1/jobRuns/${id}`,
      `/epm/rest/v1/jobRuns/${id}/result`,
      '/epm/rest/v1/files/staging/account.csv',
    ])
  })
  it('resumes a staging download using the original file name, without resubmitting the export', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ id, status: 'COMPLETED' }))
      .mockResolvedValueOnce(Response.json({ id, status: 'COMPLETED', result: null }))
      .mockResolvedValueOnce(new Response('abc', { headers: { 'Content-Type': 'text/csv' } }))
    expect(await downloadEdmJobResult(id, 'account.csv', context)).toHaveProperty('file')
    expect(mocks.fetch.mock.calls.every((call) => call[2].method === 'GET')).toBe(true)
  })
  it('requires an original staging file name if no file link was advertised', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ id, status: 'COMPLETED' }))
    await expect(downloadEdmJobResult(id, undefined, context)).rejects.toThrow(
      'original staging file name'
    )
    expect(mocks.store).not.toHaveBeenCalled()
  })
  it('does not download a result from a job that is still running', async () => {
    mocks.fetch.mockResolvedValue(Response.json({ id, status: 'RUNNING' }))
    await expect(downloadEdmJobResult(id, 'account.csv', context)).rejects.toThrow('must complete')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    expect(mocks.store).not.toHaveBeenCalled()
  })
  it('checks file-storage authority before starting a file-producing write', async () => {
    await expect(
      startEdmJob(
        edmEndpoints.exportDimension,
        {},
        wait,
        { ...context, execution: { workflowId: id } },
        undefined,
        'account.csv'
      )
    ).rejects.toThrow('trusted')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
