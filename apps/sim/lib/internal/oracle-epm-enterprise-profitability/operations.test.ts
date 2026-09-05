/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ fetch: vi.fn(), dns: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  DEFAULT_MAX_RESPONSE_BYTES: 100 * 1024 * 1024,
  secureFetchWithPinnedIP: mocks.fetch,
  validateUrlWithDNS: mocks.dns,
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import {
  normalizeOracleEpcmApplications,
  normalizeOracleEpcmExportGrid,
  normalizeOracleEpcmFiles,
  normalizeOracleEpcmJob,
  normalizeOracleEpcmMember,
} from '@/lib/internal/oracle-epm-enterprise-profitability/normalizers'
import { executeOracleEpcmOperation } from '@/lib/internal/oracle-epm-enterprise-profitability/operations'

const auth = {
  oauthCredential: 'credential-1',
  accessToken: Buffer.from('test-user:test-password').toString('base64'),
  instanceUrl: 'https://epm.example.com/gateway',
}
const app = { ...auth, applicationName: 'Profitability' }
const job = {
  ...app,
  jobName: 'Workflow Run',
  modelName: 'Allocation Model',
  povName: 'Actual:2026:Jan',
}
const submitted = { jobId: 123, status: -1, jobName: 'Workflow Run', details: null }

function respond(data: unknown, status = 200) {
  mocks.fetch.mockImplementation(
    () =>
      new Response(JSON.stringify(data), {
        status,
        headers: { 'content-type': 'application/json' },
      })
  )
}
function requestBody() {
  return JSON.parse(mocks.fetch.mock.calls.at(-1)?.[2].body as string)
}

describe('Oracle EPCM documented operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.dns.mockResolvedValue({ isValid: true, resolvedIP: '203.0.113.10' })
    respond(submitted)
  })

  it('lists applications through the credential-bound HyperionPlanning route', async () => {
    respond({ items: [{ name: 'Profitability', appType: 'tenant-value', ignored: 'not exposed' }] })
    const result = await executeOracleEpcmOperation('list_applications', auth)
    expect(result.output).toEqual({
      applications: [{ name: 'Profitability', appType: 'tenant-value' }],
    })
    expect(mocks.fetch).toHaveBeenCalledWith(
      'https://epm.example.com/gateway/HyperionPlanning/rest/v3/applications',
      '203.0.113.10',
      expect.objectContaining({
        method: 'GET',
        headers: expect.objectContaining({ Authorization: `Basic ${auth.accessToken}` }),
      })
    )
  })

  it.each([
    ['export_data_slice', 'gridDefinition'],
    ['import_data_slice', 'dataGrid'],
  ])(
    'rejects malformed %s grids with an actionable input error before sending',
    async (operation, field) => {
      await expect(
        executeOracleEpcmOperation(operation, { ...app, cubeName: 'PCM_CLC', [field]: '{invalid' })
      ).rejects.toMatchObject({
        status: 400,
        message: expect.stringContaining('must be valid JSON'),
      })
      expect(mocks.fetch).not.toHaveBeenCalled()
    }
  )

  it.each(['get_member', 'add_member'])(
    'uses the documented members resource for %s',
    async (operation) => {
      respond({
        name: 'West & East',
        dimName: 'Entity',
        parentName: 'All Entity',
        children: null,
        description: null,
      })
      const result = await executeOracleEpcmOperation(operation, {
        ...app,
        dimensionName: 'Entity',
        memberName: 'West & East',
        parentName: 'All Entity',
      })
      expect(result.output).toEqual({
        member: {
          name: 'West & East',
          dimName: 'Entity',
          parentName: 'All Entity',
          description: null,
        },
      })
      const url = mocks.fetch.mock.calls[0][0]
      expect(url).toBe(
        'https://epm.example.com/gateway/HyperionPlanning/rest/v3/applications/Profitability/dimensions/Entity/members' +
          (operation === 'get_member' ? '/West%20%26%20East' : '')
      )
      if (operation === 'add_member')
        expect(requestBody()).toEqual({ memberName: 'West & East', parentName: 'All Entity' })
    }
  )

  it('filters saved exchange definitions without inventing a calculation catalog', async () => {
    respond({
      items: [
        { jobType: 'IMPORT_DATA', jobName: 'Data Load' },
        { jobType: 'RULESET', jobName: 'Not an EPCM catalog' },
      ],
    })
    const result = await executeOracleEpcmOperation('list_job_definitions', {
      ...app,
      jobType: 'IMPORT_DATA',
    })
    expect(new URL(mocks.fetch.mock.calls[0][0]).searchParams.get('q')).toBe(
      '{"jobType":"IMPORT_DATA"}'
    )
    expect(result.output).toEqual({
      jobDefinitions: [{ jobType: 'IMPORT_DATA', jobName: 'Data Load' }],
    })
  })

  it.each([
    [
      'generate_model_documentation',
      { fileName: 'model.pdf' },
      'Generate EPCM Report',
      {
        reportName: 'MODEL_DOC',
        outputFileName: 'model.pdf',
        outputType: 'PDF',
        modelName: 'Allocation Model',
      },
    ],
    [
      'validate_model',
      { fileName: 'validation.txt', ruleStatus: 'Disabled' },
      'Validate Model',
      { modelName: 'Allocation Model', fileName: 'validation.txt', ruleStatus: 'Disabled' },
    ],
    ['delete_pov', {}, 'Delete POV', { povName: 'Actual:2026:Jan', povDelimiter: ':' }],
    [
      'clear_pov',
      { cubeName: 'PCM_CLC', clearInput: 'true' },
      'Clear POV',
      {
        povName: 'Actual:2026:Jan',
        povDelimiter: ':',
        cubeName: 'PCM_CLC',
        clearInput: 'true',
        clearAllocatedValues: 'false',
        clearAdjustmentValues: 'false',
      },
    ],
    [
      'copy_pov',
      {
        sourcePOVName: 'Actual:2026:Jan',
        destPOVName: 'Forecast:2026:Jan',
        sourceCubeName: 'PCM_CLC',
        destCubeName: 'PCM_CLC',
        copyType: 'INPUT',
      },
      'Copy POV',
      {
        povDelimiter: ':',
        sourcePOVName: 'Actual:2026:Jan',
        destPOVName: 'Forecast:2026:Jan',
        sourceCubeName: 'PCM_CLC',
        destCubeName: 'PCM_CLC',
        copyType: 'INPUT',
      },
    ],
  ])('constructs %s from documented parameters', async (operation, extra, jobType, parameters) => {
    const result = await executeOracleEpcmOperation(operation as string, {
      ...job,
      ...(extra as object),
    })
    expect(requestBody()).toEqual({ jobType, jobName: 'Workflow Run', parameters })
    expect(result.output).toMatchObject({ jobId: '123', state: 'pending', status: -1 })
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it.each(['_', '#', '~', '%', ';', ':', '-'])(
    'sends the supported explicit delimiter %s',
    async (delimiter) => {
      await executeOracleEpcmOperation('calculate_model', { ...job, povDelimiter: delimiter })
      expect(requestBody().parameters).toEqual({
        modelName: 'Allocation Model',
        povName: 'Actual:2026:Jan',
        povDelimiter: delimiter,
        executionType: 'ALL_RULES',
        clearCalculatedData: 'false',
        executeCalculations: 'true',
        optimizeForReporting: 'false',
        captureDebugScripts: 'false',
      })
    }
  )

  it.each(['SINGLE_RULE', 'RUN_FROM_RULE', 'STOP_AFTER_RULE'])(
    'requires a rule for %s',
    async (executionType) => {
      await expect(
        executeOracleEpcmOperation('calculate_model', { ...job, executionType })
      ).rejects.toThrow('ruleName')
      expect(mocks.fetch).not.toHaveBeenCalled()
      await executeOracleEpcmOperation('calculate_model', {
        ...job,
        executionType,
        ruleName: 'Allocate Cost',
        rulesetSeqNumStart: 1,
      })
      expect(requestBody().parameters).toMatchObject({ executionType, ruleName: 'Allocate Cost' })
      expect(requestBody().parameters).not.toHaveProperty('rulesetSeqNumStart')
    }
  )

  it('validates an ordered rule-set subset and rejects undocumented delimiters', async () => {
    await expect(
      executeOracleEpcmOperation('calculate_model', {
        ...job,
        executionType: 'RULESET_SUBSET',
        rulesetSeqNumStart: 3,
        rulesetSeqNumEnd: 1,
      })
    ).rejects.toThrow('range')
    await expect(
      executeOracleEpcmOperation('calculate_model', { ...job, povDelimiter: '::' })
    ).rejects.toThrow()
    await executeOracleEpcmOperation('calculate_model', {
      ...job,
      executionType: 'RULESET_SUBSET',
      rulesetSeqNumStart: '1',
      rulesetSeqNumEnd: '3',
    })
    expect(requestBody().parameters).toMatchObject({ rulesetSeqNumStart: 1, rulesetSeqNumEnd: 3 })
  })

  it('does not replay a calculation after an ambiguous provider failure', async () => {
    respond({ secret: 'provider details' }, 503)
    await expect(executeOracleEpcmOperation('calculate_model', job)).rejects.toThrow(
      'temporarily unavailable'
    )
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
  })

  it('retains the ID when Oracle immediately reports a failed submission', async () => {
    respond({ jobID: 123, status: 4, details: 'Invalid parameter' })
    expect(await executeOracleEpcmOperation('calculate_model', job)).toMatchObject({
      success: false,
      retryable: false,
      output: { jobId: '123', status: 4, state: 'failed' },
    })
  })

  it('permits saved data jobs and requires complete ad hoc data inputs', async () => {
    await executeOracleEpcmOperation('import_data', {
      ...app,
      jobName: 'Saved Import',
      fileName: 'data.zip',
    })
    expect(requestBody()).toEqual({
      jobType: 'IMPORT_DATA',
      jobName: 'Saved Import',
      parameters: { importFileName: 'data.zip' },
    })
    await expect(
      executeOracleEpcmOperation('import_data', {
        ...app,
        fileName: 'data.txt',
        sourceType: 'Essbase',
      })
    ).rejects.toThrow('cube')
    await executeOracleEpcmOperation('import_data', {
      ...app,
      fileName: 'data.txt',
      sourceType: 'Essbase',
      cubeName: 'PCM_CLC',
    })
    expect(requestBody()).toEqual({
      jobType: 'IMPORT_DATA',
      parameters: { importFileName: 'data.txt', sourceType: 'Essbase', cube: 'PCM_CLC' },
    })
    await expect(executeOracleEpcmOperation('export_data', app)).rejects.toThrow('rowMembers')
    await executeOracleEpcmOperation('export_data', {
      ...app,
      cubeName: 'PCM_CLC',
      rowMembers: 'Account',
      columnMembers: 'Jan',
      povMembers: 'Actual',
      exportDataDecimalScale: '0',
    })
    expect(requestBody().parameters).toMatchObject({ cube: 'PCM_CLC', exportDataDecimalScale: 0 })
  })

  it.each(['import_metadata', 'export_metadata'])(
    'requires a saved job and uses the correct ZIP parameter for %s',
    async (operation) => {
      await expect(executeOracleEpcmOperation(operation, app)).rejects.toThrow('jobName')
      await executeOracleEpcmOperation(operation, {
        ...app,
        jobName: 'Saved Metadata',
        fileName: 'metadata.zip',
      })
      expect(requestBody()).toEqual({
        jobType: operation.toUpperCase(),
        jobName: 'Saved Metadata',
        parameters: {
          [operation === 'import_metadata' ? 'importZipFileName' : 'exportZipFileName']:
            'metadata.zip',
        },
      })
    }
  )

  it('preserves exported financial strings and sends the grid in the request body', async () => {
    const grid = {
      pov: ['Actual'],
      columns: [['Jan']],
      rows: [{ headers: ['Cost'], data: ['123.450000000000001'] }],
    }
    respond(grid)
    const gridDefinition = {
      pov: { dimensions: ['Scenario'], members: [['Actual']] },
      rows: [{ dimensions: ['Account'], members: [['Cost']] }],
      columns: [{ dimensions: ['Period'], members: [['Jan']] }],
    }
    const result = await executeOracleEpcmOperation('export_data_slice', {
      ...app,
      cubeName: 'PCM_CLC',
      gridDefinition: JSON.stringify(gridDefinition),
    })
    expect(result.output).toEqual({ grid })
    expect(requestBody()).toEqual({ exportPlanningData: false, gridDefinition })
  })

  it('preserves mixed input cell values, leaves notes alone, and reports partial rejection', async () => {
    const dataGrid = {
      pov: ['Actual'],
      columns: [['Jan', 'Feb']],
      rows: [{ headers: ['Cost'], data: ['123.450000000000001', 0] }],
    }
    respond({
      numAcceptedCells: 1,
      numUpdateCells: 1,
      numRejectedCells: 1,
      rejectedCells: ['Read-only intersection'],
    })
    const result = await executeOracleEpcmOperation('import_data_slice', {
      ...app,
      cubeName: 'PCM_CLC',
      dataGrid,
    })
    expect(requestBody()).toEqual({
      dataGrid,
      aggregateEssbaseData: false,
      strictDateValidation: true,
      cellNotesOption: 'Skip',
    })
    expect(result).toMatchObject({
      success: false,
      retryable: false,
      output: { numRejectedCells: 1 },
    })
  })

  it('aborts before sending a state-changing request', async () => {
    const controller = new AbortController()
    controller.abort()
    await expect(
      executeOracleEpcmOperation('calculate_model', job, controller.signal)
    ).rejects.toThrow()
    expect(mocks.fetch).not.toHaveBeenCalled()
  })
})

describe('Oracle documented response projections', () => {
  it('accepts empty collections and nullable member descriptions without fabricating children', () => {
    expect(normalizeOracleEpcmApplications({ items: [] })).toEqual([])
    expect(
      normalizeOracleEpcmMember({ name: 'Parent', description: null, children: null })
    ).toEqual({ name: 'Parent', description: null })
  })
  it.each([{}, { items: null }, { items: [{}] }])(
    'rejects malformed application collections',
    (value) => {
      expect(() => normalizeOracleEpcmApplications(value)).toThrow('response contract')
    }
  )
  it.each([{ jobId: 1, jobID: 2, status: 0 }, { status: 0 }, { jobId: 1, status: 99 }])(
    'rejects malformed/unknown jobs',
    (value) => {
      expect(() => normalizeOracleEpcmJob(value)).toThrow()
    }
  )
  it('normalizes file metadata and excludes snapshots', () => {
    expect(
      normalizeOracleEpcmFiles({
        status: 0,
        items: [
          { name: 'data.csv', type: 'EXTERNAL', size: '18', lastmodifiedtime: '1422534438000' },
          { name: 'Artifact Snapshot', type: 'LCM', size: null, lastmodifiedtime: null },
        ],
      })
    ).toEqual([{ name: 'data.csv', type: 'EXTERNAL', size: 18, lastModifiedTime: 1422534438000 }])
    expect(() => normalizeOracleEpcmFiles({ status: 1, items: [] })).toThrow('rejected')
  })
  it('does not coerce undocumented numeric export cells into financial strings', () => {
    expect(() =>
      normalizeOracleEpcmExportGrid({
        pov: [],
        columns: [['Jan']],
        rows: [{ headers: [], data: [12.3] }],
      })
    ).toThrow('response contract')
  })
})
