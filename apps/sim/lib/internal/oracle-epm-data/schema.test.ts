/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { oracleEpmDataSchemas as schemas } from '@/lib/internal/oracle-epm-data/schema'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'resolved',
  instanceUrl: 'https://epm.example.com',
}
describe('Data Integration inputs', () => {
  it('requires resolved auth and defaults documented jobs to immediate returns', () => {
    expect(schemas.run_batch.parse({ ...auth, jobName: 'Batch' }).waitForCompletion).toBe(false)
    expect(schemas.list_connections.safeParse({ oauthCredential: 'credential' }).success).toBe(
      false
    )
    expect(
      schemas.run_batch.safeParse({ ...auth, jobName: 'Batch', waitForCompletion: 'false' }).success
    ).toBe(false)
  })

  it('preserves tenant option keys and period expressions without permitting arbitrary routes', () => {
    const input = schemas.run_integration.parse({
      ...auth,
      jobName: 'Load',
      periodName: '{Jan-26}{Mar-26}',
      importMode: 'Direct',
      exportMode: 'MERGE',
      executionMode: 'ASYNC',
      sourceFilters: { 'Fiscal Year': 'FY26' },
      targetOptions: { 'Refresh Database': 'Yes' },
      url: 'https://wrong.example.com',
      headers: { Authorization: 'wrong' },
      waitForCompletion: true,
    })
    expect(input.sourceFilters).toEqual({ 'Fiscal Year': 'FY26' })
    expect(input.periodName).toBe('{Jan-26}{Mar-26}')
    expect(input).not.toHaveProperty('url')
    expect(input).not.toHaveProperty('headers')
    expect(input).not.toHaveProperty('waitForCompletion')
  })

  it.each(['x', 'pipeline-code', 'a'.repeat(31)])(
    'rejects invalid pipeline code %s',
    (pipelineCode) => {
      expect(schemas.run_pipeline.safeParse({ ...auth, pipelineCode }).success).toBe(false)
    }
  )

  it('bounds tenant variables and accepts explicitly empty values', () => {
    expect(
      schemas.run_pipeline.parse({ ...auth, pipelineCode: 'Load26', variables: { MONTH: '' } })
        .variables
    ).toEqual({ MONTH: '' })
    expect(
      schemas.run_pipeline.safeParse({
        ...auth,
        pipelineCode: 'Load26',
        variables: Object.fromEntries(
          Array.from({ length: 101 }, (_, index) => [String(index), 'x'])
        ),
      }).success
    ).toBe(false)
  })

  it('uses documented mapping modes and snapshot overwrite spelling', () => {
    expect(
      schemas.import_mappings.parse({ ...auth, dimension: 'ALL', fileName: 'inbox/map.csv' })
        .importMode
    ).toBeUndefined()
    expect(
      schemas.import_mappings.safeParse({
        ...auth,
        dimension: 'ALL',
        fileName: 'inbox/map.csv',
        importMode: 'APPEND',
      }).success
    ).toBe(false)
    expect(
      schemas.export_data_integration.parse({
        ...auth,
        snapshotType: 'SETUP',
        fileName: 'backup.zip',
        overwriteFile: false,
      })
    ).toMatchObject({ overwriteFile: false, waitForCompletion: false })
    expect(
      schemas.import_data_integration.parse({
        ...auth,
        fileName: 'inbox/backup.zip',
        waitForCompletion: true,
      })
    ).not.toHaveProperty('waitForCompletion')
    expect(schemas.get_job_status.safeParse({ ...auth, jobId: '0' }).success).toBe(false)
  })

  it('requires the selected POV scope and confines unlockByLocation to application scope', () => {
    const input = { ...auth, period: 'Jan-26', category: 'Actual', lockOperation: 'unlock' }
    expect(
      schemas.set_pov_lock.safeParse({ ...input, lockType: 'location', application: 'Plan' })
        .success
    ).toBe(false)
    expect(
      schemas.set_pov_lock.safeParse({ ...input, lockType: 'application', locationName: 'Source' })
        .success
    ).toBe(false)
    expect(
      schemas.set_pov_lock.safeParse({
        ...input,
        lockType: 'location',
        locationName: 'Source',
        unlockByLocation: true,
      }).success
    ).toBe(false)
    expect(
      schemas.set_pov_lock.safeParse({
        ...input,
        lockType: 'application',
        application: 'Plan',
        unlockByLocation: false,
      }).success
    ).toBe(true)
  })

  it('requires one canonical UserFile, preserving raw repository filenames', () => {
    const file = {
      id: 'id',
      key: 'workspace/key',
      url: '/api/files/key',
      name: 'data.csv',
      size: 3,
      type: 'text/csv',
    }
    const input = { ...auth, file, fileName: 'outbox/ é.csv' }
    expect(schemas.upload_file.parse(input).fileName).toBe('outbox/ é.csv')
    expect(schemas.upload_file.safeParse({ ...input, file: [file] }).success).toBe(false)
    expect(schemas.upload_file.safeParse({ ...input, file: { name: 'data.csv' } }).success).toBe(
      false
    )
  })
})
