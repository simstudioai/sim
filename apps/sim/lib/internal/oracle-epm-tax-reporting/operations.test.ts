/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  dns: vi.fn(),
  open: vi.fn(),
  store: vi.fn(),
  deadline: vi.fn(),
}))
vi.mock('@/lib/core/execution-limits', () => ({ getExecutionDeadlineAt: mocks.deadline }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: mocks.open,
  storeOracleEpmDownload: mocks.store,
}))

import { executeTaxReportingOperation } from '@/lib/internal/oracle-epm-tax-reporting/operations'
import type { TaxOperation } from '@/lib/internal/oracle-epm-tax-reporting/schema'
import { parseTaxInput } from '@/lib/internal/oracle-epm-tax-reporting/schema'

const auth = {
  oauthCredential: 'credential',
  instanceUrl: 'https://epm.example.com',
  accessToken: Buffer.from('user:password').toString('base64'),
}
const context = {
  userId: 'trusted-user',
  workspaceId: '11111111-1111-4111-8111-111111111111',
  workflowId: '22222222-2222-4222-8222-222222222222',
  executionId: '33333333-3333-4333-8333-333333333333',
}
const sourceFile = {
  id: 'file',
  name: 'tax.csv',
  key: 'authorized/tax.csv',
  size: 3,
  type: 'text/csv',
  url: 'https://unused.example.com',
}
const gridDefinition = {
  pov: { dimensions: ['Scenario'], members: [['Actual']] },
  columns: [{ dimensions: ['Period'], members: [['Jan']] }],
  rows: [{ dimensions: ['Entity'], members: [['US']] }],
}
const grid = { pov: ['Actual'], columns: [['Jan']], rows: [{ headers: ['US'], data: ['100'] }] }
const job = { status: -1, jobId: 224, jobName: 'Tax Job', details: null }
const execute = (
  operation: TaxOperation,
  input: Record<string, unknown> = {},
  signal?: AbortSignal
) => executeTaxReportingOperation(parseTaxInput(operation, { ...auth, ...input }), context, signal)
const wire = () => JSON.parse(mocks.fetch.mock.calls.at(-1)![2].body)

describe('Tax Reporting provider behavior', () => {
  it.each(['standalone', 'generated_report', 'user_details'])(
    'projects only documented report fields for the %s status route',
    async (reportStatusRoute) => {
      mocks.fetch.mockResolvedValueOnce(
        Response.json({
          status: 0,
          jobID: 224,
          type: 'SDM',
          details: null,
          jobName: 'Planning-only field',
          detailedStatus: 2,
        })
      )
      expect(
        await execute('get_report_status', { jobId: '224', module: 'SDM', reportStatusRoute })
      ).toEqual({ status: 0, jobId: '224', type: 'SDM', details: null })
    }
  )

  it('preserves accepted job identity when the execution deadline leaves no time to poll', async () => {
    mocks.deadline.mockReturnValueOnce(new Date(Date.now() + 1000))
    expect(
      await execute('run_rule', {
        application: 'Tax',
        jobName: 'Tax Rule',
        waitForCompletion: true,
      })
    ).toMatchObject({ status: -1, jobId: '224', waitOutcome: 'incomplete' })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('preserves the accepted report link after a status-read error without resubmitting', async () => {
    const links = [
      {
        rel: 'Job Status',
        href: `${auth.instanceUrl}/HyperionPlanning/rest/fcmapi/v1/fcm/job/224`,
        action: 'GET',
      },
    ]
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ status: -1, links }))
      .mockResolvedValueOnce(Response.json({ invalid: true }))
    expect(
      await execute('generate_user_details_report', {
        fileName: 'users.csv',
        waitForCompletion: true,
      })
    ).toMatchObject({ status: -1, links, waitOutcome: 'incomplete' })
    expect(mocks.fetch.mock.calls.map((call) => call[2].method)).toEqual(['POST', 'GET'])
  })

  it('keeps caller cancellation observable after submission without replaying it', async () => {
    const controller = new AbortController()
    mocks.fetch.mockResolvedValueOnce(Response.json(job)).mockImplementationOnce(async () => {
      controller.abort(new Error('Caller canceled'))
      throw controller.signal.reason
    })
    await expect(
      execute(
        'run_rule',
        { application: 'Tax', jobName: 'Tax Rule', waitForCompletion: true },
        controller.signal
      )
    ).rejects.toThrow('Caller canceled')
    expect(mocks.fetch.mock.calls.map((call) => call[2].method)).toEqual(['POST', 'GET'])
  })

  it('polls planning cancellation pending but never polls positive report failures', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json({ ...job, status: 2 }))
      .mockResolvedValueOnce(Response.json({ ...job, status: 3 }))
    expect(
      await execute('run_rule', {
        application: 'Tax',
        jobName: 'Tax Rule',
        waitForCompletion: true,
      })
    ).toMatchObject({ status: 3 })
    mocks.fetch.mockClear()
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ status: 2, jobName: 'not documented for reports' })
    )
    expect(
      await execute('generate_report', {
        groupName: 'Task Manager',
        reportName: 'Late Tasks',
        module: 'FCM',
        waitForCompletion: true,
      })
    ).toEqual({ status: 2 })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.fetch.mockImplementation(async () => Response.json(job))
    mocks.open.mockResolvedValue({
      fileName: 'tax.csv',
      chunks: (async function* () {
        yield Buffer.from('tax')
      })(),
    })
    mocks.store.mockResolvedValue(sourceFile)
  })

  it.each([
    [
      'copy_data',
      { profileName: 'Approved Copy' },
      {
        jobType: 'COPY_DATA',
        jobName: 'Execute Profile',
        parameters: { ProfileName: 'Approved Copy' },
      },
    ],
    [
      'clear_data',
      { profileName: 'Approved Clear' },
      {
        jobType: 'CLEAR_DATA',
        jobName: 'Execute Profile',
        parameters: { ProfileName: 'Approved Clear' },
      },
    ],
    [
      'run_rule',
      { jobName: 'Tax Automation', parameters: { Entity: 'US', Scenario: 'Actual' } },
      {
        jobType: 'RULES',
        jobName: 'Tax Automation',
        parameters: { Entity: 'US', Scenario: 'Actual' },
      },
    ],
    ['run_ruleset', { jobName: 'Tax Rules' }, { jobType: 'RULESET', jobName: 'Tax Rules' }],
    [
      'export_metadata',
      { jobName: 'Export Tax', exportZipFileName: 'tax.zip' },
      {
        jobType: 'EXPORT_METADATA',
        jobName: 'Export Tax',
        parameters: { exportZipFileName: 'tax.zip' },
      },
    ],
    [
      'import_metadata',
      { jobName: 'Import Tax', importZipFileName: 'tax.zip', refreshCube: true },
      {
        jobType: 'IMPORT_METADATA',
        jobName: 'Import Tax',
        parameters: { importZipFileName: 'tax.zip', refreshCube: true },
      },
    ],
  ] as const)(
    '%s submits the documented Tax Reporting job body exactly once',
    async (operation, input, body) => {
      expect(await execute(operation, { application: 'Tax', ...input })).toMatchObject({
        status: -1,
        jobId: '224',
      })
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
      expect(mocks.fetch.mock.calls[0][0]).toBe(
        `${auth.instanceUrl}/HyperionPlanning/rest/v3/applications/Tax/jobs`
      )
      expect(mocks.fetch.mock.calls[0][2].method).toBe('POST')
      expect(wire()).toEqual(body)
    }
  )

  it('executes only an exact supported discovered definition', async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({ items: [{ jobType: 'RULES', jobName: 'Tax Rule' }] })
    )
    await execute('execute_job', { application: 'Tax', jobType: 'RULES', jobName: 'Tax Rule' })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
    expect(wire()).toEqual({ jobType: 'RULES', jobName: 'Tax Rule' })
    mocks.fetch.mockClear()
    mocks.fetch.mockResolvedValueOnce(Response.json({ items: [] }))
    await expect(
      execute('execute_job', { application: 'Tax', jobType: 'RULES', jobName: 'Missing' })
    ).rejects.toThrow('not found')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('waits by reading job status, not by replaying submission', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(Response.json({ ...job, status: 0 }))
    expect(
      await execute('run_rule', {
        application: 'Tax',
        jobName: 'Tax Rule',
        waitForCompletion: true,
      })
    ).toMatchObject({ status: 0, jobId: '224' })
    expect(mocks.fetch.mock.calls.map((call) => call[2].method)).toEqual(['POST', 'GET'])
    expect(new URL(mocks.fetch.mock.calls[1][0]).pathname).toBe(
      '/HyperionPlanning/rest/v3/applications/Tax/jobs/224'
    )
  })

  it('returns a terminal Oracle failure without another submission', async () => {
    mocks.fetch
      .mockResolvedValueOnce(Response.json(job))
      .mockResolvedValueOnce(
        Response.json({ ...job, status: 1, details: 'Invalid runtime prompt' })
      )
    expect(
      await execute('run_rule', {
        application: 'Tax',
        jobName: 'Tax Rule',
        waitForCompletion: true,
      })
    ).toMatchObject({ status: 1 })
    expect(mocks.fetch).toHaveBeenCalledTimes(2)
  })

  it('does not submit when execution was canceled', async () => {
    const controller = new AbortController()
    controller.abort(new Error('Canceled'))
    await expect(
      execute('run_rule', { application: 'Tax', jobName: 'Tax Rule' }, controller.signal)
    ).rejects.toThrow('Canceled')
    expect(mocks.fetch).not.toHaveBeenCalled()
  })

  it.each([
    [
      'import_supplemental_collection_data',
      {
        application: 'Tax',
        fileName: 'data.csv',
        collection: 'Tax Data',
        year: 'FY26',
        period: 'Jan',
        frequencyDimensions: { Scenario: 'Actual' },
      },
      '/HyperionPlanning/rest/v3/applications/Tax/fcmjobs',
      {
        jobType: 'IMPORT_SUPPLEMENTAL_COLLECTION_DATA',
        parameters: {
          fileName: 'data.csv',
          collection: 'Tax Data',
          year: 'FY26',
          period: 'Jan',
          Scenario: 'Actual',
        },
      },
    ],
    [
      'deploy_form_templates',
      {
        application: 'Tax',
        collectionIntervalName: 'Monthly',
        templates: ['Tax Detail'],
        frequencyDimensions: { Year: 'FY26', Period: 'Jan' },
      },
      '/HyperionPlanning/rest/v3/applications/Tax/fcmjobs',
      {
        jobType: 'DEPLOY_FORM_TEMPLATES',
        parameters: {
          CollectionIntervalName: 'Monthly',
          Template: ['Tax Detail'],
          ResetWorkflows: false,
          Year: 'FY26',
          Period: 'Jan',
        },
      },
    ],
    [
      'import_supplemental_dimension_members',
      { dimension: 'Jurisdiction', fileName: 'members.csv', importMode: 'Update' },
      '/HyperionPlanning/rest/sdm/v1/jobs',
      {
        jobType: 'SDM_IMPORT_DIM_MEMBERS',
        parameters: {
          DimensionName: 'Jurisdiction',
          FileName: 'members.csv',
          importMode: 'Update',
        },
      },
    ],
  ] as const)(
    '%s preserves supplemental casing and route context',
    async (operation, input, path, body) => {
      await execute(operation, input)
      expect(mocks.fetch.mock.calls[0][0]).toBe(auth.instanceUrl + path)
      expect(wire()).toEqual(body)
    }
  )

  it('exports the core data grid, imports with rejected-cell diagnostics, and clears an explicit region', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json(grid))
    expect(
      await execute('export_data_slice', { application: 'Tax', planType: 'Consol', gridDefinition })
    ).toEqual(grid)
    expect(wire()).toEqual({ gridDefinition, exportPlanningData: false })
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        numAcceptedCells: 1,
        numUpdateCells: 1,
        numRejectedCells: 0,
        rejectedCells: [],
      })
    )
    await execute('import_data_slice', { application: 'Tax', planType: 'Consol', dataGrid: grid })
    expect(wire()).toEqual({
      dataGrid: grid,
      customParams: { IncludeRejectedCells: true, IncludeRejectedCellsWithDetails: true },
    })
    mocks.fetch.mockResolvedValueOnce(Response.json({ numClearedCells: 1, numRejectedCells: 0 }))
    await execute('clear_data_slice', { application: 'Tax', planType: 'Consol', gridDefinition })
    expect(wire()).toEqual({ gridDefinition, clearEssbaseData: true, clearPlanningData: false })
  })

  it('uses one page and the documented messageType query for child details', async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        items: [{ msgType: 'ERROR', msgCategory: 'Metadata', msgText: 'Invalid member' }],
      })
    )
    expect(
      await execute('get_child_job_details', {
        application: 'Tax',
        jobId: '224',
        childJobId: '12',
        limit: 10,
        offset: 20,
        messageType: 'ERROR',
      })
    ).toMatchObject({ items: [{ msgType: 'ERROR' }] })
    const url = new URL(mocks.fetch.mock.calls[0][0])
    expect(url.pathname).toBe(
      '/HyperionPlanning/rest/v3/applications/Tax/jobs/224/childjobs/12/details'
    )
    expect(JSON.parse(url.searchParams.get('q')!)).toEqual({ messageType: 'ERROR' })
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.get('offset')).toBe('20')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it.each([
    [
      'generate_report',
      { groupName: 'Task Manager', reportName: 'Late Tasks', module: 'FCM' },
      '/HyperionPlanning/rest/fcmapi/v1/report/job/FCCS/224',
      {
        groupName: 'Task Manager',
        reportName: 'Late Tasks',
        module: 'FCM',
        format: 'PDF',
        runAsync: true,
      },
    ],
    [
      'generate_user_details_report',
      { fileName: 'users.csv' },
      '/HyperionPlanning/rest/fcmapi/v1/fcm/job/224',
      { fileName: 'users.csv', format: 'CSV' },
    ],
  ] as const)(
    '%s follows only its documented returned status link',
    async (operation, input, statusPath, body) => {
      mocks.fetch.mockResolvedValueOnce(
        Response.json({
          status: -1,
          links: [{ rel: 'Job Status', href: auth.instanceUrl + statusPath, action: 'GET' }],
        })
      )
      mocks.fetch.mockResolvedValueOnce(Response.json({ status: 0, details: 'Complete' }))
      expect(await execute(operation, { ...input, waitForCompletion: true })).toMatchObject({
        status: 0,
      })
      expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).toEqual(body)
      expect(mocks.fetch.mock.calls[1][0]).toBe(auth.instanceUrl + statusPath)
    }
  )

  it.each([false, true])(
    'rejects an unsafe report status link without another request when waiting is %s',
    async (waitForCompletion) => {
      mocks.fetch.mockResolvedValueOnce(
        Response.json({
          status: -1,
          links: [
            {
              rel: 'Job Status',
              href: 'https://other.example.com/HyperionPlanning/rest/fcmapi/v1/fcm/job/224',
              action: 'GET',
            },
          ],
        })
      )
      await expect(
        execute('generate_user_details_report', { fileName: 'users.csv', waitForCompletion })
      ).rejects.toThrow()
      expect(mocks.fetch).toHaveBeenCalledTimes(1)
    }
  )

  it('returns a trackable no-wait report snapshot without polling or resubmitting', async () => {
    const report = {
      status: -1,
      details: 'In Process',
      links: [
        {
          rel: 'Job Status',
          href: auth.instanceUrl + '/HyperionPlanning/rest/fcmapi/v1/fcm/job/224',
          action: 'GET',
        },
      ],
    }
    mocks.fetch.mockResolvedValueOnce(Response.json(report))
    expect(await execute('generate_user_details_report', { fileName: 'users.csv' })).toEqual(report)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('reports an untrackable pending submission without retrying even when not waiting', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ status: -1 }))
    await expect(
      execute('generate_user_details_report', { fileName: 'users.csv' })
    ).rejects.toThrow('do not resubmit automatically')
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('authorizes upload sources before reading and never fetches their URL', async () => {
    mocks.open.mockRejectedValueOnce(new Error('File not found'))
    await expect(execute('upload_file', { file: sourceFile, fileName: 'tax.csv' })).rejects.toThrow(
      'not found'
    )
    expect(mocks.fetch).not.toHaveBeenCalled()
    await execute('upload_file', {
      file: sourceFile,
      fileName: 'tax.csv',
      directory: 'inbox/Tax data/v1.2',
    })
    expect(mocks.open).toHaveBeenLastCalledWith(
      expect.objectContaining({ userId: 'trusted-user', maxBytes: 10 * 1024 * 1024 })
    )
    expect(mocks.fetch.mock.calls[0][2].body).toEqual(Buffer.from('tax'))
    expect(mocks.fetch.mock.calls[0][0]).toContain(
      'applicationsnapshots/tax.csv/contents?extDirPath=inbox%2FTax+data%2Fv1.2'
    )
  })

  it.each(['inbox/../outbox', 'outbox/.', 'inbox/nested/..', 'inbox/./nested'])(
    'rejects upload directory %s before reading the source or submitting a mutation',
    (directory) => {
      expect(() =>
        execute('upload_file', { file: sourceFile, fileName: 'tax.csv', directory })
      ).toThrow()
      expect(mocks.open).not.toHaveBeenCalled()
      expect(mocks.fetch).not.toHaveBeenCalled()
    }
  )

  it('stores downloads as canonical files and rejects Oracle JSON error bodies', async () => {
    mocks.fetch.mockResolvedValueOnce(
      new Response('report', { headers: { 'content-type': 'text/csv' } })
    )
    expect(await execute('download_file', { fileName: 'outbox/tax.csv' })).toEqual({
      file: sourceFile,
    })
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({
        fileName: 'tax.csv',
        context: {
          workspaceId: context.workspaceId,
          workflowId: context.workflowId,
          executionId: context.executionId,
        },
        maxBytes: 100 * 1024 * 1024,
      })
    )
    mocks.fetch.mockResolvedValueOnce(Response.json({ status: 1, details: 'File not found' }))
    await expect(execute('download_file', { fileName: 'missing.csv' })).rejects.toThrow(
      'JSON error'
    )
    expect(mocks.store).toHaveBeenCalledTimes(1)
  })

  it('downloads a completed report only through a validated report-content link', async () => {
    mocks.fetch.mockResolvedValueOnce(
      Response.json({
        status: 0,
        links: [
          {
            rel: 'report-content',
            href: `${auth.instanceUrl}/interop/rest/11.1.2.3.600/applicationsnapshots/tax%20report.csv/contents`,
            action: 'GET',
          },
        ],
      })
    )
    mocks.fetch.mockResolvedValueOnce(
      new Response('report', { headers: { 'content-type': 'text/csv' } })
    )
    expect(
      await execute('get_report_status', { jobId: '224', module: 'FCCS', downloadReport: true })
    ).toMatchObject({ status: 0, file: sourceFile })
    expect(mocks.fetch.mock.calls[0][0]).toContain('/arm/rest/fcmapi/v1/job/FCCS/224')
    expect(mocks.store).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'tax report.csv' })
    )
  })

  it('rejects missing provider response fields instead of treating an arbitrary object as success', async () => {
    mocks.fetch.mockResolvedValueOnce(Response.json({ unverified: true }))
    await expect(execute('get_job_status', { application: 'Tax', jobId: '224' })).rejects.toThrow(
      'invalid'
    )
  })
})
