/** @vitest-environment node */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { OracleEpmClient } from '@/lib/internal/oracle-epm'
import { getOracleEpmEndpoint } from '@/lib/internal/oracle-epm/endpoint'

const { request, validateReturnedLink } = vi.hoisted(() => ({
  request: vi.fn(),
  validateReturnedLink: vi.fn(),
}))
vi.mock('@/lib/internal/oracle-epm/client.server', () => ({
  createOracleEpmClient: () => ({ request, validateReturnedLink }),
}))
vi.mock('@/lib/internal/oracle-epm/files.server', () => ({
  openOracleEpmSourceFile: vi.fn(),
  storeOracleEpmDownload: vi.fn(),
}))

import {
  executeOraclePcmOperation,
  normalizeOraclePcmSubmission,
} from '@/lib/internal/oracle-epm-profitability/operations'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'token',
  instanceUrl: 'https://example.com',
  applicationName: 'Model',
}
const submission = {
  status: -1,
  statusMessage: 'In Progress',
  details: 'Task_1',
  links: [
    {
      rel: 'Job Status',
      action: 'GET',
      href: 'https://example.com/epm/rest/v1/applications/jobs/ChecktaskStatusJob/Task_1',
    },
  ],
}

const cases = [
  [
    'create_application',
    { description: 'Allocation', ruleDimensionName: 'Rule', balanceDimensionName: 'Balance' },
    'fileApplications/:applicationName',
    { description: 'Allocation', ruleDimensionName: 'Rule', balanceDimensionName: 'Balance' },
  ],
  ['enable_application', {}, 'fileApplications/:applicationName/enableApplication', {}],
  [
    'deploy_cube',
    { isKeepData: true, isReplaceCube: false, comment: 'Deploy' },
    'applications/:applicationName/jobs/ledgerDeployCubeJob',
    { isKeepData: 'true', isReplaceCube: 'false', comment: 'Deploy', isRunNow: 'true' },
  ],
  [
    'update_dimensions',
    { dataFileName: 'Account.csv,Product.csv', acceptableDecreasePercentage: 5 },
    'fileApplications/:applicationName/jobs/updateDimension',
    { dataFileName: 'Account.csv,Product.csv', acceptableDecreasePercentage: '5' },
  ],
  [
    'load_data',
    { clearAllDataFlag: false, dataLoadValue: 'ADD_EXISTING_VALUES', dataFileName: 'Data.csv' },
    'applications/:applicationName/jobs/essbaseDataLoadJob',
    { clearAllDataFlag: 'false', dataLoadValue: 'ADD_EXISTING_VALUES', dataFileName: 'Data.csv' },
  ],
  [
    'run_calculation',
    { povName: 'FY26_Jan_Actual', exeType: 'ALL_RULES' },
    'applications/:applicationName/povs/:povName/jobs/runLedgerCalculationJob',
    { exeType: 'ALL_RULES', isRunNow: 'true', isExecuteCalculations: 'true' },
  ],
  [
    'copy_pov',
    {
      povName: 'Source',
      destinationPovName: 'Target',
      isManageRule: true,
      isInputData: false,
      createDestPOV: true,
      stringDelimiter: '_',
    },
    'applications/:applicationName/povs/:povName/jobs/copyPOVJob/:destinationPovName',
    { isManageRule: 'true', isInputData: 'false', createDestPOV: 'true', stringDelimiter: '_' },
  ],
  [
    'clear_pov',
    { povName: 'FY26_Jan_Actual', isInputData: true, queryName: 'Input' },
    'applications/:applicationName/povs/:povName/jobs/clearPOVJob',
    { isInputData: 'true', queryName: 'Input' },
  ],
  [
    'generate_program_documentation',
    { povName: 'FY26_Jan_Actual', fileName: 'Program.pdf', skipFilters: true },
    'applications/:applicationName/povs/:povName/jobs/programDocReportJob',
    { fileName: 'Program.pdf', skipFilters: true },
  ],
  [
    'export_query_results',
    { fileName: 'Results.txt', queryName: 'Profitability', roundingPrecision: 3 },
    'applications/:applicationName/jobs/exportQueryResultsJob',
    { fileName: 'Results.txt', queryName: 'Profitability', roundingPrecision: '3' },
  ],
  [
    'import_template',
    { description: 'Import', fileName: 'Template.zip', isApplicationOverwrite: false },
    'applications/:applicationName/jobs/templateImportJob',
    { description: 'Import', fileName: 'Template.zip', isApplicationOverwrite: 'false' },
  ],
  ['apply_data_grants', {}, 'applications/:applicationName/jobs/applyDataGrants', {}],
  [
    'merge_slices',
    { removeZeroCells: true },
    'applications/:applicationName/jobs/mergeSlices',
    { removeZeroCells: 'true' },
  ],
  [
    'optimize_cube',
    { type: 'createAggregations' },
    'applications/:applicationName/jobs/optimizeASOCube',
    { type: 'createAggregations' },
  ],
] as const

describe('PCM documented operations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    request.mockResolvedValue({ status: 200, data: submission })
  })

  it.each(cases)('%s uses its PCM endpoint and payload', async (operation, params, path, json) => {
    const signal = new AbortController().signal
    const result = await executeOraclePcmOperation(operation, { ...auth, ...params }, signal)
    const [endpoint, input] = request.mock.calls[0]
    const declaration = getOracleEpmEndpoint(endpoint)
    expect(declaration.routeSpace.context).toEqual(['epm', 'rest'])
    expect(declaration.version).toBe('v1')
    expect(declaration.method).toBe('POST')
    expect(
      declaration.path
        .map((part) => (part.kind === 'literal' ? part.value : `:${part.name}`))
        .join('/')
    ).toBe(path)
    expect(input.json).toEqual(json)
    expect(input.pathParams.applicationName).toBe('Model')
    expect(input.signal).toBe(signal)
    expect(input.query).toBeUndefined()
    expect(result.output).toMatchObject({ processName: 'Task_1', state: 'pending' })
    expect(result.retryable).toBe(false)
  })

  it.each([
    ['deploy_cube', { isKeepData: true, isReplaceCube: true, comment: 'Deploy' }],
    ['run_calculation', { povName: 'POV', exeType: 'SINGLE_RULE' }],
    [
      'run_calculation',
      { povName: 'POV', exeType: 'RULESET_SUBSET', subsetStart: 9, subsetEnd: 1 },
    ],
    [
      'run_calculation',
      {
        povName: 'POV',
        exeType: 'SINGLE_RULE',
        ruleName: 'Rule',
        ruleSetName: 'Set',
        dataPOVName: 'Other',
      },
    ],
    ['clear_pov', { povName: 'POV', queryName: 'Input', isManageRule: true }],
  ])('rejects incompatible %s inputs before provider access', async (operation, params) => {
    await expect(
      executeOraclePcmOperation(operation as string, { ...auth, ...params })
    ).rejects.toThrow()
    expect(request).not.toHaveBeenCalled()
  })

  it('drops irrelevant rule-selection fields and blank optional inputs', async () => {
    await executeOraclePcmOperation('run_calculation', {
      ...auth,
      povName: 'POV',
      exeType: 'ALL_RULES',
      subsetStart: 1,
      ruleName: 'Unused',
      comment: '',
    })
    expect(request.mock.calls[0][1].json).toEqual({
      exeType: 'ALL_RULES',
      isRunNow: 'true',
      isExecuteCalculations: 'true',
    })
  })

  it('sends columnar memberFilters as the documented JSON string', async () => {
    const memberFilters = '{"Product":["P1"]}'
    await executeOraclePcmOperation('export_query_results', {
      ...auth,
      fileName: 'Export.txt',
      dataFormat: 'COLUMNAR',
      memberFilters,
    })
    expect(request.mock.calls[0][1].json.memberFilters).toBe(memberFilters)
    request.mockClear()
    await expect(
      executeOraclePcmOperation('export_query_results', {
        ...auth,
        fileName: 'Export.txt',
        memberFilters: '{invalid',
      })
    ).rejects.toThrow('memberFilters')
    expect(request).not.toHaveBeenCalled()
  })

  it('uses queryParameter for rule balancing and projects documented scalar fields only', async () => {
    const item = {
      ruleNumber: '',
      balanceTypeRule: true,
      scale: 2,
      sequence: 0,
      name: 'NoRule',
      description: null,
      runningBalance: 10,
      balance: 10,
      allocationIn: null,
      allocationOut: null,
      adjustmentIn: null,
      adjustmentOut: null,
      input: 10,
      runningRemainder: 10,
      remainder: 10,
      netChange: null,
      offset: null,
      rules: [{ undocumented: 'ignored' }],
    }
    request.mockResolvedValue({ status: 200, data: { status: 0, items: [item] } })
    const result = await executeOraclePcmOperation('get_rule_balancing', {
      ...auth,
      povName: 'POV',
      modelViewName: 'View',
      stringDelimiter: '_',
    })
    expect(request.mock.calls[0][1].query).toEqual({
      queryParameter: '{"modelViewName":"View","stringDelimiter":"_"}',
    })
    expect(result.output).toMatchObject({ items: [{ name: 'NoRule', balance: 10 }] })
    expect('items' in result.output && result.output.items[0]).not.toHaveProperty('rules')
  })

  it('accepts nonnegative integer precision without inventing an Oracle maximum', async () => {
    await executeOraclePcmOperation('export_query_results', {
      ...auth,
      fileName: 'Export.txt',
      queryName: 'Profitability',
      roundingPrecision: 16,
    })
    expect(request.mock.calls[0][1].json.roundingPrecision).toBe('16')
    request.mockClear()
    await expect(
      executeOraclePcmOperation('export_query_results', {
        ...auth,
        fileName: 'Export.txt',
        roundingPrecision: 1.5,
      })
    ).rejects.toThrow('roundingPrecision')
    expect(request).not.toHaveBeenCalled()
  })

  it('takes report processName from the validated link, never descriptive details', async () => {
    request.mockResolvedValue({
      data: { ...submission, details: 'Report Program.pdf generated in the Outbox folder.' },
    })
    const result = await executeOraclePcmOperation('generate_program_documentation', {
      ...auth,
      povName: 'POV',
    })
    expect(result.output).toMatchObject({
      processName: 'Task_1',
      details: 'Report Program.pdf generated in the Outbox folder.',
    })
    expect(validateReturnedLink).toHaveBeenCalledWith(expect.anything(), {
      rel: 'Job Status',
      method: 'GET',
      href: submission.links[0].href,
    })
  })

  it('rejects missing or ambiguous pending-task links and propagates foundation link rejection', () => {
    const client = {
      request,
      validateReturnedLink,
      requestValidatedLink: vi.fn(),
    } as OracleEpmClient
    expect(() => normalizeOraclePcmSubmission({ ...submission, links: [] }, client)).toThrow(
      'unique task'
    )
    expect(() =>
      normalizeOraclePcmSubmission(
        { ...submission, links: [...submission.links, ...submission.links] },
        client
      )
    ).toThrow('unique task')
    validateReturnedLink.mockImplementationOnce(() => {
      throw new Error('Rejected route')
    })
    expect(() => normalizeOraclePcmSubmission(submission, client)).toThrow('Rejected route')
  })

  it('reports positive submission statuses as failure without retrying', async () => {
    request.mockResolvedValue({ data: { status: 2, details: 'Failed' } })
    const result = await executeOraclePcmOperation('apply_data_grants', auth)
    expect(result).toMatchObject({
      success: false,
      retryable: false,
      output: { status: 2, state: 'failed', processName: null },
    })
    expect(request).toHaveBeenCalledTimes(1)
  })
})
