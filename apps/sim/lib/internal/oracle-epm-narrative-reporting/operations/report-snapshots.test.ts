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

import {
  getReportSnapshot,
  listReportSnapshots,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/report-snapshots'

describe('Narrative report-snapshots', () => {
  it('projects the documented collection without inventing pagination fields', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { items: [{ reportId: 'native-id', name: 'Budget', links: [{ href: 'hidden' }] }] },
    })
    const result = await listReportSnapshots({ ...auth, limit: 50, offset: 0 }, context)
    expect(result.output.snapshots[0]).toMatchObject({
      reportId: 'native-id',
      name: 'Budget',
      description: null,
    })
    expect(result.output.snapshots[0]).not.toHaveProperty('links')
    expect(request.mock.calls[0][1].query.fields.split(',').sort()).toEqual(
      Object.keys(result.output.snapshots[0]).sort()
    )
    expect(result.output).not.toHaveProperty('hasMore')
    expect(request).toHaveBeenCalledTimes(1)
  })
  it('rejects malformed collection envelopes rather than reporting an empty list', async () => {
    request.mockResolvedValue({ status: 200, data: { reportId: 'native-id', name: 'Budget' } })
    await expect(
      listReportSnapshots({ ...auth, limit: 50, offset: 0 }, context)
    ).rejects.toMatchObject({ category: 'invalid_response' })
  })
  it('uses the product-specific ID on its own get endpoint', async () => {
    request.mockResolvedValue({ status: 200, data: { reportId: 'native-id', name: 'Budget' } })
    const result = await getReportSnapshot({ ...auth, resourceId: 'native-id' }, context)
    expect(result.output.snapshot).toMatchObject({ reportId: 'native-id', name: 'Budget' })
    expect(request.mock.calls[0][1].query.fields.split(',').sort()).toEqual(
      Object.keys(result.output.snapshot).sort()
    )
    expect(request).toHaveBeenCalledExactlyOnceWith(
      narrativeEndpoints.getSnapshot,
      expect.objectContaining({ pathParams: { id: 'native-id' }, signal: context.signal })
    )
  })
})

import { createReportSnapshot } from '@/lib/internal/oracle-epm-narrative-reporting/operations/report-snapshots'

it('submits snapshot creation once with the documented string overwrite and parameter casing', async () => {
  request.mockResolvedValue({ status: 201, data: { jobID: 'j', status: -1 } })
  const result = await createReportSnapshot(
    { ...auth, reportId: 'r', snapShotName: 'Month end', overwrite: 'false' },
    context
  )
  expect(request).toHaveBeenCalledExactlyOnceWith(narrativeEndpoints.submitJob, {
    json: {
      jobType: 'CREATE_REPORT_SNAPSHOT',
      parameters: { reportId: 'r', snapShotName: 'Month end', overwrite: 'false' },
    },
    signal: context.signal,
  })
  expect(result.output.job).toMatchObject({ jobId: 'j', status: -1 })
})
