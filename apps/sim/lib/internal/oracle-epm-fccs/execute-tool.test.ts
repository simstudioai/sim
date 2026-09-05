/** @vitest-environment node */
import { inputValidationMock, inputValidationMockFns } from '@sim/testing'
import { beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)

import { resolveIntegrationAvailability } from '@/lib/integrations/availability'
import { executeOracleEpmFccsTool } from '@/lib/internal/oracle-epm-fccs/execute-tool'
import { getInternalToolOperationHandler } from '@/lib/internal/tool-operations/registry.server'
import { getServiceConfigByServiceId } from '@/lib/oauth/utils'
import { mapFccsBlockParams } from '@/blocks/blocks/oracle_epm_fccs'
import * as tools from '@/tools/oracle_epm_fccs'

const auth = {
  instanceUrl: 'https://epm.example.com/gateway',
  accessToken: Buffer.from('user:secret').toString('base64'),
}
const request = (id: string, input: unknown, signal?: AbortSignal) =>
  executeOracleEpmFccsTool({
    toolId: `oracle_epm_fccs_${id}`,
    input,
    headers: new Headers(),
    requestId: 'test',
    context: { userId: 'trusted' },
    signal,
  })
const run = async (id: string, input: object = {}, value: unknown = { jobId: 42, status: 0 }) => {
  inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(Response.json(value))
  return (await request(id, { ...auth, ...input })).json()
}
describe('FCCS internal execution and registration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    inputValidationMockFns.mockValidateUrlWithDNS.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
    })
  })
  it('makes every public action executable through the existing internal registry', async () => {
    for (const tool of Object.values(tools))
      expect(await getInternalToolOperationHandler(tool.id)).toBe(executeOracleEpmFccsTool)
  })
  it('is available through the foundation service-account path without OAuth client variables', () => {
    expect(getServiceConfigByServiceId('oracle-epm-fccs')).toMatchObject({
      serviceAccountProviderId: 'oracle-epm-service-account',
      authType: 'service_account',
    })
    expect(
      resolveIntegrationAvailability({}).find((x) => x.type === 'oracle_epm_fccs')
    ).toMatchObject({ state: 'ready', oauthAvailable: false, missingFields: [] })
  })
  it.each([null, [], 42, 'payload'])('rejects invalid operation payload %j', async (input) => {
    expect(await (await request('list_applications', input)).json()).toMatchObject({
      success: false,
      error: 'Invalid operation input',
    })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
  it('rejects unsupported tools and missing credentials without network access', async () => {
    expect((await request('admin', {})).status).toBe(400)
    expect(
      await (await request('list_applications', { oauthCredential: 'id' })).json()
    ).toMatchObject({ success: false, error: expect.stringContaining('service account') })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
  it.each([
    ['run_consolidation', { application: 'Close' }],
    ['execute_job', { application: 'Close', jobType: 'DELETE_APPLICATION', jobName: 'Close' }],
    ['get_job_details', { application: 'Close', jobId: '42', detailJobType: 'RULES' }],
    [
      'get_child_job_details',
      { application: 'Close', jobId: '42', childJobId: '7', childJobType: 'IMPORT_DATA' },
    ],
    ['list_dimensions', { application: 'Close', cube: 'Consol', offset: '25' }],
    [
      'run_translation',
      {
        application: 'Close',
        entity: 'E',
        period: 'Jan',
        scenario: 'Actual',
        year: 'FY26',
        force: 'false',
      },
    ],
  ])('validates required/typed inputs for %s before fetch', async (id, input) => {
    expect(await run(id as string, input as object)).toMatchObject({
      success: false,
      error: expect.stringContaining('Invalid FCCS input'),
    })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
  it.each([
    ['run_consolidation', false, 'Consolidate'],
    ['run_consolidation', true, 'ForceConsolidate'],
    ['run_translation', false, 'Translate'],
    ['run_translation', true, 'ForceTranslate'],
  ] as const)('submits %s force=%s with documented seeded prompts', async (id, force, jobName) => {
    expect(
      await run(id, {
        application: 'Close',
        entity: 'North & West',
        period: 'Jan',
        scenario: 'Actual',
        year: 'FY26',
        force,
      })
    ).toMatchObject({ success: true, output: { jobId: '42' } })
    const body = JSON.parse(
      inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0][2].body as string
    )
    expect(body).toEqual({
      jobType: 'RULES',
      jobName,
      parameters: { Entity: 'North & West', Period: 'Jan', Scenario: 'Actual', Year: 'FY26' },
    })
  })
  it('accepts the documented journal period echo only for the requested POV', async () => {
    const input = {
      application: 'Close',
      scenario: 'Actual',
      year: 'FY26',
      period: 'Jan',
      periodAction: 'OPEN',
    }
    expect(
      await run('update_journal_period', input, {
        scenario: 'Actual',
        year: 'FY26',
        period: 'Jan',
        action: 'OPEN',
        undocumented: 'secret',
      })
    ).toEqual({
      success: true,
      output: { scenario: 'Actual', year: 'FY26', period: 'Jan', action: 'OPEN' },
    })
    expect(
      await run('update_journal_period', input, {
        scenario: 'Other',
        year: 'FY26',
        period: 'Jan',
        action: 'OPEN',
      })
    ).toMatchObject({ success: false, error: expect.stringContaining('different journal period') })
  })
  it('preserves a rejected journal action as failure, not a transport success', async () => {
    expect(
      await run(
        'perform_journal_action',
        {
          application: 'Close',
          scenario: 'Actual',
          year: 'FY26',
          period: 'Jan',
          journalLabel: 'J1',
          journalAction: 'POST',
        },
        { actionStatus: 1, actionDetail: 'Cannot post' }
      )
    ).toMatchObject({ success: false, output: { actionStatus: 1, actionDetail: 'Cannot post' } })
  })
  it('fails closed on malformed successful data and discards raw HTTP error bodies', async () => {
    expect(
      await run('list_applications', {}, { items: [{ unknown: 'provider-secret-canary' }] })
    ).toMatchObject({
      success: false,
      error: 'Oracle EPM FCCS returned an undocumented or malformed response',
    })
    inputValidationMockFns.mockSecureFetchWithPinnedIP.mockResolvedValue(
      Response.json({ details: 'provider-secret-canary' }, { status: 403 })
    )
    const response = await request('list_applications', auth)
    expect(response.status).toBe(403)
    expect(await response.json()).toMatchObject({
      success: false,
      error: 'Oracle EPM denied the request',
    })
  })
  it.each([
    {
      id: 'generate_intercompany_report',
      values: { application: 'Close', manualJobName: 'IC Match' },
      response: { jobId: 42, status: -1 },
      body: { jobType: 'GENERATE_INTERCOMPANY_REPORT', jobName: 'IC Match', parameters: {} },
    },
    {
      id: 'perform_journal_action',
      values: {
        application: 'Close',
        journalLabel: 'J1',
        scenario: 'Actual',
        year: 'FY26',
        period: 'Jan',
        journalAction: 'SUBMIT',
      },
      response: { actionStatus: 0, actionDetail: 'Submitted' },
      body: { parameters: { scenario: 'Actual', year: 'FY26', period: 'Jan', action: 'SUBMIT' } },
    },
  ])('$id works through the block when optional overrides are unset', async (contract) => {
    const params = mapFccsBlockParams({
      operation: `oracle_epm_fccs_${contract.id}`,
      oauthCredential: 'chosen',
      ...contract.values,
    })
    expect(await run(contract.id, params, contract.response)).toMatchObject({ success: true })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).toHaveBeenCalledTimes(1)
    expect(
      JSON.parse(inputValidationMockFns.mockSecureFetchWithPinnedIP.mock.calls[0][2].body as string)
    ).toEqual(contract.body)
  })
  it('propagates caller cancellation without converting it to a provider error', async () => {
    await expect(
      request(
        'list_applications',
        auth,
        AbortSignal.abort(new DOMException('stopped', 'AbortError'))
      )
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(inputValidationMockFns.mockSecureFetchWithPinnedIP).not.toHaveBeenCalled()
  })
})
