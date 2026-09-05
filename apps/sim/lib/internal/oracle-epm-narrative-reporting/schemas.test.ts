/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  narrativeArtifactSchema,
  narrativeBookSchema,
  narrativeExportInputSchema,
  narrativeImportInputSchema,
  narrativeJobSchema,
  narrativeListInputSchema,
  narrativePageSchema,
  narrativeRefreshInputSchema,
  narrativeReportSchema,
  narrativeSnapshotInputSchema,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://example.oraclecloud.com',
}

describe('Narrative Reporting contracts', () => {
  it('does not advertise unselected validation or metadata as successful empty values', () => {
    const report = narrativeReportSchema.parse({
      reportId: 'report',
      name: 'Report',
      validationMessages: ['Invalid member'],
      invalidFields: ['grid'],
    })
    expect(report).not.toHaveProperty('validationMessages')
    expect(report).not.toHaveProperty('invalidFields')
    const artifact = narrativeArtifactSchema.parse({
      artifactId: 'artifact',
      name: 'Artifact',
      typeLabel: 'Report',
      systemPath: '/Library',
      mimeType: 'application/pdf',
    })
    for (const field of ['typeLabel', 'systemPath', 'mimeType']) {
      expect(artifact).not.toHaveProperty(field)
    }
    expect(
      narrativeBookSchema.parse({ bookId: 'book', name: 'Book', primaryDatasource: 'Source' })
    ).not.toHaveProperty('primaryDatasource')
  })
  it('distinguishes unknown book validation from returned empty or failing validation', () => {
    const book = { bookId: 'book', name: 'Book' }
    expect(narrativeBookSchema.parse(book).validationMessages).toBeNull()
    expect(
      narrativeBookSchema.parse({ ...book, validationMessages: null }).validationMessages
    ).toBeNull()
    expect(
      narrativeBookSchema.parse({ ...book, validationMessages: [] }).validationMessages
    ).toEqual([])
    expect(
      narrativeBookSchema.parse({ ...book, validationMessages: ['Invalid member'] })
        .validationMessages
    ).toEqual(['Invalid member'])
  })
  it('requires documented collection envelopes instead of guessing missing items', () => {
    const schema = narrativePageSchema(narrativeBookSchema)
    expect(schema.safeParse({ bookId: 'b', name: 'Book' }).success).toBe(false)
    expect(schema.safeParse({}).success).toBe(false)
    expect(schema.safeParse({ items: [{ bookId: 'b', name: 'Book' }] }).success).toBe(true)
    expect(
      schema.safeParse({
        items: Array.from({ length: 101 }, () => ({ bookId: 'b', name: 'Book' })),
      }).success
    ).toBe(false)
  })
  it('projects meaningful metadata without retaining unknown provider fields', () => {
    expect(
      narrativeArtifactSchema.parse({ artifactId: 'id::202', name: 'Budget', secret: 'not output' })
    ).toMatchObject({
      artifactId: 'id::202',
      name: 'Budget',
      description: null,
    })
    expect(
      narrativeArtifactSchema.parse({ artifactId: 'id', name: 'Budget', secret: 'not output' })
    ).not.toHaveProperty('secret')
  })
  it('accepts both documented job-ID spellings and rejects conflicting IDs', () => {
    expect(narrativeJobSchema.parse({ jobID: 'job', status: -1 })).toMatchObject({
      jobId: 'job',
      status: -1,
    })
    expect(
      narrativeJobSchema.parse({ jobId: 'job', status: 0, jobType: 'REFRESH_RP_DS' }).jobType
    ).toBe('REFRESH_RP_DS')
    expect(narrativeJobSchema.safeParse({ jobId: 'one', jobID: 'two', status: 0 }).success).toBe(
      false
    )
    expect(narrativeJobSchema.safeParse({ status: 0 }).success).toBe(false)
  })
  it('bounds pages and preserves false and zero', () => {
    expect(narrativeListInputSchema.parse({ ...auth, offset: 0 })).toMatchObject({
      limit: 50,
      offset: 0,
    })
    expect(narrativeListInputSchema.safeParse({ ...auth, limit: 101 }).success).toBe(false)
    expect(
      narrativeImportInputSchema.parse({ ...auth, importFile: 'temporary-id', overwrite: false })
        .overwrite
    ).toBe(false)
  })
  it('validates LCM requirements and snapshot wire semantics', () => {
    expect(
      narrativeExportInputSchema.safeParse({ ...auth, artifactName: 'Report', exportFormat: 'LCM' })
        .success
    ).toBe(false)
    expect(
      narrativeExportInputSchema.safeParse({
        ...auth,
        artifactName: 'Report',
        exportFormat: 'LCM',
        applicationName: 'App',
        artifactType: 'BookResourceType',
      }).success
    ).toBe(false)
    expect(narrativeSnapshotInputSchema.safeParse(auth).success).toBe(false)
    expect(
      narrativeSnapshotInputSchema.safeParse({ ...auth, reportId: 'report', overwrite: true })
        .success
    ).toBe(false)
    expect(
      narrativeSnapshotInputSchema.parse({
        ...auth,
        reportId: 'report',
        overwrite: 'false',
        snapShotName: 'Snapshot',
      })
    ).toMatchObject({ overwrite: 'false', snapShotName: 'Snapshot' })
  })
  it('bounds datasource arrays and does not invent a refresh response enum', () => {
    expect(
      narrativeRefreshInputSchema.parse({
        ...auth,
        reportPackageName: '/Library/Package',
        refreshableSources: [],
      }).refreshableSources
    ).toEqual([])
    expect(
      narrativeRefreshInputSchema.safeParse({
        ...auth,
        reportPackageName: 'Package',
        refreshableSources: Array(101).fill('source'),
      }).success
    ).toBe(false)
  })
})
