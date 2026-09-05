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
  getReportPackage,
  refreshReportPackageDataSources,
} from '@/lib/internal/oracle-epm-narrative-reporting/operations/report-packages'

describe('Narrative report packages', () => {
  it('gets package metadata without treating preview metadata as a download', async () => {
    request.mockResolvedValue({
      status: 200,
      data: { reportPackageId: 'p', name: 'Annual report', preview: { href: 'not output' } },
    })
    const result = await getReportPackage({ ...auth, resourceId: 'p' }, context)
    expect(result.output.reportPackage).toMatchObject({
      reportPackageId: 'p',
      name: 'Annual report',
    })
    expect(result.output.reportPackage).not.toHaveProperty('preview')
  })
  it('refreshes by documented package NAME, not repository or package ID', async () => {
    request.mockResolvedValue({
      status: 201,
      data: { jobID: 'j', status: -1, jobType: 'REFRESH_RP_DS' },
    })
    const result = await refreshReportPackageDataSources(
      { ...auth, reportPackageName: '/Library/Annual', refreshableSources: ['source'] },
      context
    )
    expect(request).toHaveBeenCalledExactlyOnceWith(narrativeEndpoints.submitJob, {
      json: {
        jobType: 'REFRESH_RP_DS',
        parameters: { reportPackageName: '/Library/Annual', refreshableSources: ['source'] },
      },
      signal: context.signal,
    })
    expect(result.output.job).toMatchObject({ jobId: 'j', status: -1 })
  })
})
