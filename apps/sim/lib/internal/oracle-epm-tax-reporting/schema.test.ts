/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  applicationListSchema,
  clearSliceResponseSchema,
  importSliceResponseSchema,
  jobResponseSchema,
  memberResponseSchema,
  parseTaxInput,
} from '@/lib/internal/oracle-epm-tax-reporting/schema'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'token',
  instanceUrl: 'https://epm.example.com',
}

describe('Tax Reporting documented schemas', () => {
  it('rejects oversized aggregate grids before schema cloning and rejects cyclic caller data', () => {
    const largeCell = 'x'.repeat(16000)
    expect(() =>
      parseTaxInput('import_data_slice', {
        ...auth,
        application: 'Tax',
        planType: 'Consol',
        dataGrid: {
          pov: ['Actual'],
          columns: [['Jan']],
          rows: [{ headers: ['US'], data: Array(150).fill(largeCell) }],
        },
      })
    ).toThrow('2 MiB')
    const cycle: Record<string, unknown> = { ...auth }
    cycle.self = cycle
    expect(() => parseTaxInput('list_applications', cycle)).toThrow('cycles')
    expect(jobResponseSchema.parse({ status: 0, jobId: 224, detailedStatus: 2 })).toMatchObject({
      detailedStatus: 2,
    })
  })

  it('rejects unrelated EPM jobs and undocumented metadata parameters before submission', () => {
    for (const jobType of ['IMPORT_DATA', 'EXPORT_DATA', 'REFRESH_CUBE', 'DELETE_APPLICATION']) {
      expect(() =>
        parseTaxInput('execute_job', { ...auth, application: 'Tax', jobName: 'Job', jobType })
      ).toThrow()
    }
    expect(() =>
      parseTaxInput('execute_job', {
        ...auth,
        application: 'Tax',
        jobName: 'Job',
        jobType: 'IMPORT_METADATA',
        parameters: { unknownField: true },
      })
    ).toThrow()
  })

  it('preserves exact fully qualified ruleset prompt names without treating them as schema fields', () => {
    const parameters = { 'Ruleset.Rule (2).Entity Prompt': 'North America', Scenario: 'Actual' }
    expect(
      parseTaxInput('run_ruleset', {
        ...auth,
        application: 'Tax',
        jobName: 'Tax Rules',
        parameters,
      })
    ).toMatchObject({ parameters })
    expect(() =>
      parseTaxInput('run_rule', {
        ...auth,
        application: 'Tax',
        jobName: 'Tax Rule',
        parameters: { Scenario: false },
      })
    ).toThrow()
  })

  it('requires the correct context for each job/status family', () => {
    expect(() => parseTaxInput('get_job_status', { ...auth, jobId: '1' })).toThrow('Application')
    expect(
      parseTaxInput('get_job_status', { ...auth, jobId: '1', jobFamily: 'supplemental_dimension' })
    ).toMatchObject({ jobId: '1' })
    expect(() => parseTaxInput('get_report_status', { ...auth, jobId: '1' })).toThrow('module')
    expect(
      parseTaxInput('get_report_status', { ...auth, jobId: '1', reportStatusRoute: 'user_details' })
    ).toMatchObject({ jobId: '1' })
  })

  it('cannot override supplemental protocol fields with frequency dimensions', () => {
    const collection = {
      ...auth,
      application: 'Tax',
      fileName: 'data.csv',
      collection: 'Tax',
      year: 'FY26',
      period: 'Jan',
    }
    expect(() =>
      parseTaxInput('import_supplemental_collection_data', {
        ...collection,
        frequencyDimensions: { Year: 'FY27' },
      })
    ).toThrow('override')
    expect(() =>
      parseTaxInput('deploy_form_templates', {
        ...auth,
        application: 'Tax',
        collectionIntervalName: 'Monthly',
        templates: [],
        frequencyDimensions: { ResetWorkflows: 'true' },
      })
    ).toThrow('override')
    expect(
      parseTaxInput('deploy_form_templates', {
        ...auth,
        application: 'Tax',
        collectionIntervalName: 'Monthly',
        templates: [],
        frequencyDimensions: { Year: 'FY26', Period: 'Jan' },
      })
    ).toMatchObject({ templates: [], resetWorkflows: false })
  })

  it('projects only documented fields and preserves documented nullable values', () => {
    expect(
      memberResponseSchema.parse({
        name: 'North America',
        parentName: 'Global',
        description: null,
        dimName: 'Entity',
        twoPass: false,
        internalSecret: 'discard',
      })
    ).toEqual({
      name: 'North America',
      parentName: 'Global',
      description: null,
      dimName: 'Entity',
      twoPass: false,
    })
    expect(jobResponseSchema.parse({ status: -1, jobId: 224, details: null })).toEqual({
      status: -1,
      jobId: '224',
      details: null,
    })
    expect(jobResponseSchema.parse({ status: 0, jobID: 224 })).toEqual({ status: 0, jobId: '224' })
    expect(() => jobResponseSchema.parse({ jobId: 224 })).toThrow()
    expect(() => memberResponseSchema.parse({ status: 400, detail: 'Invalid member' })).toThrow()
  })

  it('validates rejected-cell contracts and bounds discovery responses', () => {
    expect(
      importSliceResponseSchema.parse({
        numAcceptedCells: 4,
        numUpdateCells: 4,
        numRejectedCells: 0,
        rejectedCells: [],
        rejectedCellsWithDetails: [],
      })
    ).toMatchObject({ numAcceptedCells: 4 })
    expect(
      clearSliceResponseSchema.parse({
        numClearedCells: 31,
        numRejectedCells: 1,
        rejectedCells: ['Entity,Jan'],
      })
    ).toMatchObject({ numRejectedCells: 1 })
    expect(() =>
      importSliceResponseSchema.parse({ numAcceptedCells: '4', numRejectedCells: 0 })
    ).toThrow()
    expect(() =>
      applicationListSchema.parse({ items: Array.from({ length: 1001 }, () => ({ name: 'Tax' })) })
    ).toThrow()
  })
})
