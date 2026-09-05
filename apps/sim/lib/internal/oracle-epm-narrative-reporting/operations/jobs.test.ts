/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { NarrativeOperationContext } from '@/lib/internal/oracle-epm-narrative-reporting/operations'
import { narrativeEndpoints } from '@/lib/internal/oracle-epm-narrative-reporting/routes'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://epm.example.com',
}
const request = vi.fn()
const context = {
  client: { request, validateReturnedLink: vi.fn(), requestValidatedLink: vi.fn() },
  execution: { workflowId: 'workflow' },
  signal: new AbortController().signal,
} satisfies NarrativeOperationContext
beforeEach(() => vi.clearAllMocks())

import { afterEach } from 'vitest'
import { createOracleEpmClient } from '@/lib/internal/oracle-epm/client.server'
import { oracleEpmLocalError } from '@/lib/internal/oracle-epm/errors'
import {
  exportLibraryArtifact,
  getJob,
  importLibraryArtifact,
  waitForJob,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/jobs'
import {
  narrativeExportInputSchema,
  narrativeImportInputSchema,
  narrativeWaitInputSchema,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'

const input = narrativeWaitInputSchema.parse({ ...auth, resourceId: 'j', maxWaitSeconds: 10 })
afterEach(() => vi.useRealTimers())
describe('Narrative jobs', () => {
  it('preserves the job ID when the status request hits the foundation endpoint timeout', async () => {
    request.mockRejectedValueOnce(oracleEpmLocalError('timeout'))
    const result = await waitForJob(input, context)
    expect(result.output).toMatchObject({
      jobId: 'j',
      job: null,
      completed: false,
      timedOut: true,
      attempts: 1,
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it.each([0, 1, 3])('classifies terminal status %s without a second request', async (status) => {
    request.mockResolvedValue({ status: 200, data: { jobID: 'j', status } })
    const result = await waitForJob(input, context)
    expect(result.success).toBe(status === 0)
    expect(result.output).toMatchObject({
      jobId: 'j',
      completed: status === 0,
      timedOut: false,
      attempts: 1,
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('rejects unknown states and mismatching job IDs', async () => {
    request.mockResolvedValue({ status: 200, data: { jobId: 'j', status: 99 } })
    await expect(waitForJob(input, context)).rejects.toMatchObject({ category: 'invalid_response' })
    request.mockResolvedValue({ status: 200, data: { jobId: 'different-job', status: 0 } })
    await expect(getJob(input, context)).rejects.toMatchObject({ category: 'invalid_response' })
  })
  it('preserves the job ID and last state on a local timeout without resubmitting', async () => {
    vi.useFakeTimers()
    request.mockResolvedValue({ status: 200, data: { jobId: 'j', status: -1 } })
    const waiting = waitForJob(input, context)
    await vi.advanceTimersByTimeAsync(10_000)
    const result = await waiting
    expect(result.output).toMatchObject({
      jobId: 'j',
      job: { jobId: 'j', status: -1 },
      completed: false,
      timedOut: true,
    })
    expect(request.mock.calls.every(([endpoint]) => endpoint === narrativeEndpoints.getJob)).toBe(
      true
    )
    expect(request.mock.calls.length).toBeLessThan(12)
  })
  it('propagates cancellation without claiming Oracle cancelled the job', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))
    await expect(
      waitForJob(input, { ...context, signal: controller.signal })
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(request).not.toHaveBeenCalled()
  })
  it('uses a foundation-owned self handle only inside the current wait execution', async () => {
    vi.useFakeTimers()
    const client = createOracleEpmClient(auth)
    const validate = vi.fn(client.validateReturnedLink)
    request.mockResolvedValue({
      status: 200,
      data: {
        jobId: 'j',
        status: -1,
        links: [{ rel: 'self', href: 'https://epm.example.com/epm/rest/v1/jobs/j' }],
      },
    })
    const follow = vi.fn().mockResolvedValue({ status: 200, data: { jobId: 'j', status: 0 } })
    const waiting = waitForJob(input, {
      ...context,
      client: { request, validateReturnedLink: validate, requestValidatedLink: follow },
    })
    await vi.advanceTimersByTimeAsync(2_000)
    expect((await waiting).output.completed).toBe(true)
    expect(request).toHaveBeenCalledTimes(1)
    expect(follow).toHaveBeenCalledTimes(1)
    expect(JSON.stringify(follow.mock.calls[0][0])).toBe('{}')
  })
  it.each([
    'https://attacker.example/epm/rest/v1/jobs/j',
    'https://epm.example.com/epm/rest/v1/jobs/other',
    'https://epm.example.com/epm/rest/v1/jobs/j?x=1',
  ])('rejects unsafe or unrelated self link %s', async (href) => {
    request.mockResolvedValue({
      status: 200,
      data: { jobId: 'j', status: -1, links: [{ rel: 'self', href }] },
    })
    const client = createOracleEpmClient(auth)
    await expect(
      waitForJob(input, {
        ...context,
        client: { ...context.client, validateReturnedLink: client.validateReturnedLink },
      })
    ).rejects.toThrow()
    expect(context.client.requestValidatedLink).not.toHaveBeenCalled()
  })
  it('does not follow unsupported exported/artifact links during status reads', async () => {
    request.mockResolvedValue({
      status: 200,
      data: {
        jobID: 'j',
        status: 0,
        links: [{ rel: 'exported/artifact', href: 'http://unsafe.example/file' }],
      },
    })
    expect((await getJob(input, context)).output.job).not.toHaveProperty('links')
    expect(context.client.validateReturnedLink).not.toHaveBeenCalled()
  })
  it('submits export and import once with explicit parameters, and never polls automatically', async () => {
    request.mockResolvedValue({ status: 201, data: { jobID: 'j', status: -1 } })
    await exportLibraryArtifact(
      narrativeExportInputSchema.parse({
        ...auth,
        artifactName: '/Library/Report',
        exportLocation: 'Library',
        exportLibraryFolder: '/Library/Exports',
      }),
      context
    )
    expect(request).toHaveBeenCalledExactlyOnceWith(narrativeEndpoints.submitJob, {
      json: {
        jobType: 'EXPORT_LIBRARY_ARTIFACT',
        parameters: {
          artifactName: '/Library/Report',
          exportLocation: 'Library',
          exportLibraryFolder: '/Library/Exports',
          exportFormat: 'Native',
        },
      },
      signal: context.signal,
    })
    request.mockClear()
    await importLibraryArtifact(
      narrativeImportInputSchema.parse({ ...auth, importFile: 'id' }),
      context
    )
    expect(request).toHaveBeenCalledExactlyOnceWith(narrativeEndpoints.submitJob, {
      json: {
        jobType: 'IMPORT_LIBRARY_ARTIFACT',
        parameters: {
          importFile: 'id',
          importFormat: 'Native',
          deleteAfterImport: false,
          importPermissions: false,
          overwrite: false,
        },
      },
      signal: context.signal,
    })
  })
})
