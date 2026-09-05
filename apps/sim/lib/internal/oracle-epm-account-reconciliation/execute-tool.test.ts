/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn(), source: vi.fn(), store: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: mocks.source,
  storeOracleEpmDownload: mocks.store,
}))

import { executeOracleEpmAccountReconciliationTool } from '@/lib/internal/oracle-epm-account-reconciliation/execute-tool'

const ORIGIN = 'https://epm.example.com/gateway'
const AUTH = {
  oauthCredential: 'credential',
  accessToken: Buffer.from('test:password').toString('base64'),
  instanceUrl: ORIGIN,
}
const context = {
  userId: 'user-1',
  workspaceId: '00000000-0000-4000-8000-000000000001',
  workflowId: '00000000-0000-4000-8000-000000000002',
  executionId: '00000000-0000-4000-8000-000000000003',
}
const storedFile = {
  id: 'stored',
  name: 'input.csv',
  key: 'execution/stored',
  url: '/api/files/stored',
  type: 'text/csv',
  size: 3,
}
function json(data: unknown) {
  return new Response(JSON.stringify(data), { headers: { 'content-type': 'application/json' } })
}
function job(kind: string, status = -1) {
  return {
    status,
    details: status === -1 ? 'In Process' : null,
    links: [
      {
        rel: 'self',
        action: 'GET',
        href: ORIGIN + (kind === 'matching' ? '/arm/rest/v1/jobs/42' : '/armARCS/rest/v1/jobs/42'),
      },
    ],
  }
}
const comments = [
  {
    commentId: 1,
    parentObjectId: 2,
    commentText: 'Evidence',
    postedBy: 'reviewer',
    postedDate: 'Jan 1, 2026',
    references: [
      {
        referenceId: 7,
        type: 'FILE',
        name: 'input.csv',
        url: null,
        fileDownloadLink: `${ORIGIN}/arm/rest/fcmapi/v1/rc/references/7/file`,
      },
    ],
  },
]
const cases = [
  {
    id: 'add_users_to_team',
    kind: 'compliance',
    input: {
      fileName: 'input.csv',
      teamName: 'example',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'ADD_USERS_TO_TEAM',
      parameters: {
        fileName: 'input.csv',
        teamName: 'example',
      },
    },
  },
  {
    id: 'archive_matched_transactions',
    kind: 'matching',
    input: {
      matchTypeId: 'example',
      age: 42,
    },
    route: '/arm/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'archivetransactions',
      parameters: {
        matchTypeId: 'example',
        age: 42,
      },
    },
  },
  {
    id: 'create_reconciliations',
    kind: 'compliance',
    input: {
      period: 'January 2026',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'CREATE_RECONCILIATIONS',
      parameters: {
        period: 'January 2026',
      },
    },
  },
  {
    id: 'delete_file',
    kind: 'delete',
    input: {
      fileName: 'input.csv',
    },
    route: '/interop/rest/v3/files/delete',
    method: 'POST',
    body: {
      fileName: 'input.csv',
    },
  },
  {
    id: 'delete_profile',
    kind: 'compliance',
    input: {
      accountId: 'example',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'DELETE_PROFILE',
      parameters: {
        accountId: 'example',
      },
    },
  },
  {
    id: 'download_comment_attachment',
    kind: 'attachment',
    input: {
      period: 'January 2026',
      accountId: 'example',
      referenceId: '7',
    },
    route: '/armARCS/rest/v1/period/January%202026/reconciliation/example/comments',
    method: 'GET',
  },
  {
    id: 'download_file',
    kind: 'download',
    input: {
      fileName: 'input.csv',
    },
    route: '/interop/rest/11.1.2.3.600/applicationsnapshots/input.csv/contents',
    method: 'GET',
  },
  {
    id: 'export_user_details_report',
    kind: 'report',
    input: {
      fileName: 'input.csv',
    },
    route: '/arm/rest/fcmapi/v1/rc/export/users',
    method: 'POST',
    body: {
      fileName: 'input.csv',
    },
  },
  {
    id: 'get_compliance_job_status',
    kind: 'compliance_status',
    input: {
      jobId: '42',
    },
    route: '/armARCS/rest/v1/jobs/42',
    method: 'GET',
  },
  {
    id: 'get_matching_job_status',
    kind: 'matching_status',
    input: {
      jobId: '42',
    },
    route: '/arm/rest/v1/jobs/42',
    method: 'GET',
  },
  {
    id: 'import_balances',
    kind: 'compliance',
    input: {
      period: 'January 2026',
      dataLoadDefinition: 'example',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'IMPORT_BALANCES',
      parameters: {
        period: 'January 2026',
        dl_Definition: 'example',
      },
    },
  },
  {
    id: 'import_compliance_transactions',
    kind: 'compliance',
    input: {
      fileName: 'input.csv',
      period: 'January 2026',
      transactionType: 'BEX',
      dateFormat: 'example',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'IMPORT_PREMAPPED_TRANSACTIONS',
      parameters: {
        file: 'input.csv',
        period: 'January 2026',
        transactionType: 'BEX',
        dateFormat: 'example',
      },
    },
  },
  {
    id: 'import_matching_transactions',
    kind: 'matching',
    input: {
      fileName: 'input.csv',
      matchTypeId: 'example',
      dataSource: 'example',
      dateFormat: 'example',
    },
    route: '/arm/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'importtmpremappedtransactions',
      parameters: {
        file: 'input.csv',
        matchTypeId: 'example',
        dataSource: 'example',
        dateFormat: 'example',
      },
    },
  },
  {
    id: 'import_premapped_balances',
    kind: 'compliance',
    input: {
      fileName: 'input.csv',
      period: 'January 2026',
      balanceType: 'SRC',
      currencyBucket: 'example',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'IMPORT_PREMAPPED_BALANCES',
      parameters: {
        file: 'input.csv',
        period: 'January 2026',
        balanceType: 'SRC',
        currencyBucket: 'example',
      },
    },
  },
  {
    id: 'import_profiles',
    kind: 'compliance',
    input: {
      fileName: 'input.csv',
      importType: 'Replace',
      profileType: 'Profiles',
      dateFormat: 'example',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'IMPORT_PROFILES',
      parameters: {
        fileLocation: 'input.csv',
        importType: 'Replace',
        profileType: 'Profiles',
        dateFormat: 'example',
      },
    },
  },
  {
    id: 'import_rates',
    kind: 'compliance',
    input: {
      fileName: 'input.csv',
      period: 'January 2026',
      rateType: 'example',
      importType: 'Replace',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'IMPORT_RATES',
      parameters: {
        file: 'input.csv',
        period: 'January 2026',
        rateType: 'example',
        importType: 'Replace',
      },
    },
  },
  {
    id: 'import_reconciliation_attributes',
    kind: 'compliance',
    input: {
      fileName: 'input.csv',
      period: 'January 2026',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'IMPORT_RECONCILIATION_ATTRIBUTES',
      parameters: {
        fileName: 'input.csv',
        period: 'January 2026',
      },
    },
  },
  {
    id: 'list_files',
    kind: 'files',
    input: {},
    route: '/interop/rest/11.1.2.3.600/applicationsnapshots',
    method: 'GET',
  },
  {
    id: 'list_periods',
    kind: 'periods',
    input: {},
    route: '/armARCS/rest/periods?status=ALL',
    method: 'GET',
  },
  {
    id: 'list_reconciliation_comments',
    kind: 'comments',
    input: {
      period: 'January 2026',
      accountId: 'example',
    },
    route: '/armARCS/rest/v1/period/January%202026/reconciliation/example/comments',
    method: 'GET',
  },
  {
    id: 'list_users',
    kind: 'users',
    input: {},
    route: '/interop/rest/security/v1/users/list',
    method: 'POST',
    body: {},
  },
  {
    id: 'monitor_reconciliations',
    kind: 'monitor',
    input: {
      periodName: 'January 2026',
      filterName: 'example',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'MONITOR_RECONCILIATIONS',
      parameters: {
        periodName: 'January 2026',
        filterName: 'example',
      },
    },
  },
  {
    id: 'purge_archived_transactions',
    kind: 'matching',
    input: {
      jobId: '42',
    },
    route: '/arm/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'purgearchivetransactions',
      parameters: {
        jobId: '42',
      },
    },
  },
  {
    id: 'purge_matched_transactions',
    kind: 'matching',
    input: {
      matchTypeId: 'example',
      age: 42,
    },
    route: '/arm/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'purgetransactions',
      parameters: {
        matchTypeId: 'example',
        age: 42,
        matchedStatus: 'matched',
      },
    },
  },
  {
    id: 'remove_users_from_team',
    kind: 'compliance',
    input: {
      fileName: 'input.csv',
      teamName: 'example',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'REMOVE_USERS_FROM_TEAM',
      parameters: {
        fileName: 'input.csv',
        teamName: 'example',
      },
    },
  },
  {
    id: 'run_auto_alert',
    kind: 'matching',
    input: {
      matchTypeId: 'example',
    },
    route: '/arm/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'runautoalert',
      parameters: {
        matchTypeId: 'example',
      },
    },
  },
  {
    id: 'run_auto_match',
    kind: 'matching',
    input: {
      matchTypeId: 'example',
    },
    route: '/arm/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'runautomatch',
      parameters: {
        matchTypeId: 'example',
      },
    },
  },
  {
    id: 'run_profile_rules',
    kind: 'compliance',
    input: {
      period: 'January 2026',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'RUN_PROFILE_RULES',
      parameters: {
        period: 'January 2026',
      },
    },
  },
  {
    id: 'run_reconciliation_rules',
    kind: 'compliance',
    input: {
      period: 'January 2026',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'RUN_RECONCILIATION_RULES',
      parameters: {
        period: 'January 2026',
      },
    },
  },
  {
    id: 'set_period_status',
    kind: 'compliance',
    input: {
      period: 'January 2026',
      status: 'pending',
    },
    route: '/armARCS/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'SET_PERIOD_STATUS',
      parameters: {
        period: 'January 2026',
        status: 'pending',
      },
    },
  },
  {
    id: 'unmatch_auto_match_job',
    kind: 'matching',
    input: {
      autoMatchJobId: 42,
      createReverseAdjustment: false,
    },
    route: '/arm/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'unmatchtransactionsbyautomatch',
      parameters: {
        autoMatchJobId: 42,
        createReverseAdjustment: false,
      },
    },
  },
  {
    id: 'unmatch_transactions',
    kind: 'matching',
    input: {
      matchTypeId: 'example',
      matchIds: [12, 13],
    },
    route: '/arm/rest/v1/jobs',
    method: 'POST',
    body: {
      jobName: 'unmatchtransactions',
      parameters: {
        matchTypeId: 'example',
        matchIds: [12, 13],
      },
    },
  },
  {
    id: 'upload_file',
    kind: 'upload',
    input: {
      file: {
        id: 'file-1',
        key: 'workspace/file.csv',
        url: '/api/files/file.csv',
        name: 'input.csv',
        type: 'text/csv',
        size: 3,
      },
    },
    route: '/interop/rest/11.1.2.3.600/applicationsnapshots/input.csv/contents',
    method: 'POST',
  },
]

async function invoke(id: string, input: object) {
  const response = await executeOracleEpmAccountReconciliationTool({
    toolId: `oracle_epm_account_reconciliation_${id === 'import_reconciliation_attributes' ? 'import_recon_attributes' : id}`,
    input: { ...AUTH, ...input },
    context,
    headers: new Headers(),
    requestId: 'request',
  })
  return response.json()
}

describe('Account Reconciliation documented action requests', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    mocks.source.mockResolvedValue({
      fileName: 'input.csv',
      maxBytes: 100 * 1024 * 1024,
      contentType: 'text/csv',
      chunks: (async function* () {
        yield Buffer.from('abc')
      })(),
    })
    mocks.store.mockResolvedValue(storedFile)
  })

  it.each(cases)('$id sends the documented route and body', async (testCase) => {
    const { kind } = testCase
    if (kind === 'periods')
      mocks.fetch.mockResolvedValueOnce(
        json({ status: 0, items: [{ Id: '1', Name: 'January 2026', Status: '52' }] })
      )
    else if (kind === 'files')
      mocks.fetch.mockResolvedValueOnce(
        json({
          status: 0,
          details: null,
          items: [{ name: 'input.csv', type: 'EXTERNAL', size: '3', lastmodifiedtime: '1' }],
        })
      )
    else if (kind === 'users')
      mocks.fetch.mockResolvedValueOnce(json({ status: 0, error: null, details: [] }))
    else if (kind === 'comments' || kind === 'attachment') {
      mocks.fetch.mockResolvedValueOnce(json(comments))
      if (kind === 'attachment')
        mocks.fetch.mockResolvedValueOnce(
          new Response('abc', { headers: { 'content-type': 'text/csv' } })
        )
    } else if (kind === 'report') {
      mocks.fetch.mockResolvedValueOnce(
        json({
          status: -1,
          details: null,
          links: [
            { rel: 'Job Status', action: 'GET', href: `${ORIGIN}/arm/rest/fcmapi/v1/rc/job/42` },
          ],
        })
      )
      mocks.fetch.mockResolvedValueOnce(
        json({
          status: 0,
          details: null,
          links: [
            {
              rel: 'report-content',
              action: 'GET',
              href: `${ORIGIN}/interop/rest/11.1.2.3.600/applicationsnapshots/input.csv/contents`,
            },
          ],
        })
      )
      mocks.fetch.mockResolvedValueOnce(
        new Response('abc', { headers: { 'content-type': 'text/csv' } })
      )
    } else if (kind === 'download')
      mocks.fetch.mockResolvedValueOnce(
        new Response('abc', { headers: { 'content-type': 'text/csv' } })
      )
    else if (kind === 'upload' || kind === 'delete')
      mocks.fetch.mockResolvedValueOnce(json({ status: 0, details: null }))
    else
      mocks.fetch.mockResolvedValueOnce(
        json(job(kind, kind.endsWith('_status') || kind === 'monitor' ? 0 : -1))
      )
    const result = await invoke(testCase.id, testCase.input)
    expect(result.success).toBe(true)
    expect(mocks.fetch).toHaveBeenCalledWith(
      ORIGIN + testCase.route,
      '203.0.113.10',
      expect.objectContaining({
        method: testCase.method,
        maxRedirects: 0,
        headers: expect.objectContaining({ Authorization: `Basic ${AUTH.accessToken}` }),
      })
    )
    const options = mocks.fetch.mock.calls[0][2]
    if ('body' in testCase) expect(JSON.parse(options.body)).toEqual(testCase.body)
    else if (kind === 'upload') expect(Buffer.from(options.body).toString()).toBe('abc')
    else expect(options.body).toBeUndefined()
    if (kind === 'report' || kind === 'attachment')
      expect(mocks.fetch).toHaveBeenCalledTimes(kind === 'report' ? 3 : 2)
    else expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it.each(cases.filter((entry) => Object.keys(entry.input).length > 0))(
    '$id rejects missing required fields before provider access',
    async (entry) => {
      const result = await invoke(entry.id, {})
      expect(result.success).toBe(false)
      expect(mocks.fetch).not.toHaveBeenCalled()
    }
  )

  it.each([
    {
      id: 'archive_matched_transactions',
      kind: 'matching',
      input: {
        matchTypeId: 'example',
        age: 42,
        filterOperator: 'EQUALS',
        filterValue: ['ACCOUNT-1'],
        logFileName: 'output.csv',
        fileName: 'output.csv',
      },
      body: {
        jobName: 'archivetransactions',
        parameters: {
          matchTypeId: 'example',
          age: 42,
          filterOperator: 'EQUALS',
          filterValue: ['ACCOUNT-1'],
          logFileName: 'output.csv',
          fileName: 'output.csv',
        },
      },
    },
    {
      id: 'create_reconciliations',
      kind: 'compliance',
      input: {
        period: 'January 2026',
        filter: 'Public Filter',
      },
      body: {
        jobName: 'CREATE_RECONCILIATIONS',
        parameters: {
          period: 'January 2026',
          filter: 'Public Filter',
        },
      },
    },
    {
      id: 'import_profiles',
      kind: 'compliance',
      input: {
        fileName: 'input.csv',
        importType: 'Replace',
        profileType: 'Profiles',
        dateFormat: 'example',
        period: 'January 2026',
      },
      body: {
        jobName: 'IMPORT_PROFILES',
        parameters: {
          fileLocation: 'input.csv',
          importType: 'Replace',
          profileType: 'Profiles',
          dateFormat: 'example',
          period: 'January 2026',
        },
      },
    },
    {
      id: 'import_reconciliation_attributes',
      kind: 'compliance',
      input: {
        fileName: 'input.csv',
        period: 'January 2026',
        rules: 'AUTO_APP,AUTO_SUB',
        reopen: false,
      },
      body: {
        jobName: 'IMPORT_RECONCILIATION_ATTRIBUTES',
        parameters: {
          fileName: 'input.csv',
          period: 'January 2026',
          rules: 'AUTO_APP,AUTO_SUB',
          reopen: 'false',
        },
      },
    },
    {
      id: 'purge_archived_transactions',
      kind: 'matching',
      input: {
        jobId: '42',
        logFileName: 'output.csv',
      },
      body: {
        jobName: 'purgearchivetransactions',
        parameters: {
          jobId: '42',
          logFileName: 'output.csv',
        },
      },
    },
    {
      id: 'purge_matched_transactions',
      kind: 'matching',
      input: {
        matchTypeId: 'example',
        age: 42,
        filterOperator: 'EQUALS',
        filterValue: ['ACCOUNT-1'],
        logFileName: 'output.csv',
      },
      body: {
        jobName: 'purgetransactions',
        parameters: {
          matchTypeId: 'example',
          age: 42,
          matchedStatus: 'matched',
          filterOperator: 'EQUALS',
          filterValue: ['ACCOUNT-1'],
          logFileName: 'output.csv',
        },
      },
    },
    {
      id: 'run_profile_rules',
      kind: 'compliance',
      input: {
        period: 'January 2026',
        filter: 'Public Filter',
      },
      body: {
        jobName: 'RUN_PROFILE_RULES',
        parameters: {
          period: 'January 2026',
          filter: 'Public Filter',
        },
      },
    },
    {
      id: 'run_reconciliation_rules',
      kind: 'compliance',
      input: {
        period: 'January 2026',
        filter: 'Public Filter',
        ruleTypes: 'SET_ATTR_VAL',
      },
      body: {
        jobName: 'RUN_RECONCILIATION_RULES',
        parameters: {
          period: 'January 2026',
          filter: 'Public Filter',
          ruleTypes: 'SET_ATTR_VAL',
        },
      },
    },
    {
      id: 'unmatch_transactions',
      kind: 'matching',
      input: {
        matchTypeId: 'example',
        matchIds: [12, 13],
        forceReopen: false,
      },
      body: {
        jobName: 'unmatchtransactions',
        parameters: {
          matchTypeId: 'example',
          matchIds: [12, 13],
          forceReopen: false,
        },
      },
    },
  ])('$id preserves the documented optional wire fields', async (entry) => {
    mocks.fetch.mockResolvedValueOnce(json(job(entry.kind)))
    expect((await invoke(entry.id, entry.input)).success).toBe(true)
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).toEqual(entry.body)
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })
  it('omits absent optional fields and retains explicit false values', async () => {
    mocks.fetch.mockResolvedValueOnce(json(job('compliance')))
    await invoke('import_reconciliation_attributes', {
      fileName: 'input.csv',
      period: 'January 2026',
      reopen: false,
      dateformat: 'unverified',
      injected: true,
    })
    expect(JSON.parse(mocks.fetch.mock.calls[0][2].body)).toEqual({
      jobName: 'IMPORT_RECONCILIATION_ATTRIBUTES',
      parameters: { fileName: 'input.csv', period: 'January 2026', reopen: 'false' },
    })
  })

  it('does not treat provider job failure as a failed status lookup', async () => {
    mocks.fetch.mockResolvedValueOnce(json(job('matching', 1)))
    const result = await invoke('get_matching_job_status', { jobId: '42' })
    expect(result).toMatchObject({
      success: true,
      output: { status: 1, state: 'failed', jobId: '42' },
    })
  })

  it('does not poll when monitored reconciliations remain open', async () => {
    mocks.fetch.mockResolvedValueOnce(
      json({ status: -1, details: 'Some reconciliations remain open' })
    )
    const result = await invoke('monitor_reconciliations', {
      periodName: 'January 2026',
      filterName: 'Open',
    })
    expect(result).toMatchObject({ success: true, output: { status: -1, allClosed: false } })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('rejects unknown tools and non-object input without provider calls', async () => {
    const response = await executeOracleEpmAccountReconciliationTool({
      toolId: 'not-an-arcs-tool',
      input: {},
      context,
      headers: new Headers(),
      requestId: 'request',
    })
    expect(response.status).toBe(500)
    const malformed = await executeOracleEpmAccountReconciliationTool({
      toolId: 'oracle_epm_account_reconciliation_list_files',
      input: [],
      context,
      headers: new Headers(),
      requestId: 'request',
    })
    expect(malformed.status).toBe(400)
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})
