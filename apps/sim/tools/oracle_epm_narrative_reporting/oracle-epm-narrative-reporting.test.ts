/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import {
  narrativeCreateFileInputSchema,
  narrativeCreateFolderInputSchema,
  narrativeDownloadInputSchema,
  narrativeExportInputSchema,
  narrativeImportInputSchema,
  narrativeListInputSchema,
  narrativePdfDownloadInputSchema,
  narrativeRefreshInputSchema,
  narrativeResourceInputSchema,
  narrativeSnapshotInputSchema,
  narrativeWaitInputSchema,
} from '@/lib/internal/oracle-epm-narrative-reporting/schemas'
import {
  OracleEpmNarrativeReportingBlock as block,
  OracleEpmNarrativeReportingBlockMeta as meta,
} from '@/blocks/blocks/oracle_epm_narrative_reporting'
import * as tools from '@/tools/oracle_epm_narrative_reporting'

const auth = {
  oauthCredential: 'credential',
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://epm.example.com',
}
const sample = {
  oauthCredential: 'credential',
  accessToken: 'dXNlcjpwYXNz',
  instanceUrl: 'https://epm.example.com',
  reportId: 'report',
  bookId: 'book',
  artifactId: 'artifact',
  snapshotId: 'snapshot',
  packageId: 'package',
  jobId: 'job',
  name: 'Folder',
  systemPath: '/Library',
  providerFile: 'uploaded-id',
  mimeType: 'application/pdf',
  overwrite: 'false',
  snapshotOverwrite: 'false',
  reportPackageName: '/Library/Package',
  importFile: 'provider-file',
  artifactName: '/Library/Report',
  limit: '50',
  offset: '0',
  maxWaitSeconds: '10',
}
const cases = [
  {
    tool: tools.oracleEpmNarrativeReportingListLibraryArtifactsTool,
    schema: narrativeListInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingGetLibraryArtifactTool,
    schema: narrativeResourceInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingCreateLibraryFolderTool,
    schema: narrativeCreateFolderInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingCreateLibraryFileTool,
    schema: narrativeCreateFileInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingDeleteLibraryArtifactTool,
    schema: narrativeResourceInputSchema,
  },
  { tool: tools.oracleEpmNarrativeReportingListReportsTool, schema: narrativeListInputSchema },
  { tool: tools.oracleEpmNarrativeReportingGetReportTool, schema: narrativeResourceInputSchema },
  {
    tool: tools.oracleEpmNarrativeReportingGetReportGlobalPovTool,
    schema: narrativeResourceInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingGetReportPromptsTool,
    schema: narrativeResourceInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingDownloadReportOutputTool,
    schema: narrativePdfDownloadInputSchema,
  },
  { tool: tools.oracleEpmNarrativeReportingListBooksTool, schema: narrativeListInputSchema },
  { tool: tools.oracleEpmNarrativeReportingGetBookTool, schema: narrativeResourceInputSchema },
  {
    tool: tools.oracleEpmNarrativeReportingGetBookGlobalPovTool,
    schema: narrativeResourceInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingDownloadBookOutputTool,
    schema: narrativeDownloadInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingListReportSnapshotsTool,
    schema: narrativeListInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingGetReportSnapshotTool,
    schema: narrativeResourceInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingCreateReportSnapshotTool,
    schema: narrativeSnapshotInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingDownloadReportSnapshotOutputTool,
    schema: narrativePdfDownloadInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingGetReportPackageTool,
    schema: narrativeResourceInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingRefreshReportPackageDataSourcesTool,
    schema: narrativeRefreshInputSchema,
  },
  { tool: tools.oracleEpmNarrativeReportingGetJobTool, schema: narrativeResourceInputSchema },
  { tool: tools.oracleEpmNarrativeReportingWaitForJobTool, schema: narrativeWaitInputSchema },
  {
    tool: tools.oracleEpmNarrativeReportingExportLibraryArtifactTool,
    schema: narrativeExportInputSchema,
  },
  {
    tool: tools.oracleEpmNarrativeReportingImportLibraryArtifactTool,
    schema: narrativeImportInputSchema,
  },
]
describe('Narrative tool and canvas execution contracts', () => {
  it.each([
    ['list_reports', 'limit', '0'],
    ['list_reports', 'limit', '101'],
    ['list_reports', 'limit', '1.5'],
    ['list_reports', 'offset', '-1'],
    ['list_reports', 'offset', '1000001'],
    ['list_reports', 'offset', '0.5'],
    ['wait_for_job', 'maxWaitSeconds', '9'],
    ['wait_for_job', 'maxWaitSeconds', '241'],
    ['wait_for_job', 'maxWaitSeconds', '10.5'],
  ])('rejects out-of-bounds canvas input for %s %s=%s', (operation, field, value) => {
    const map = block.tools.config?.params
    if (!map) throw new Error('Missing block operation adapter')
    expect(() => map({ ...sample, operation, [field]: value })).toThrow()
  })
  it.each(cases)(
    '$tool.id maps the operation and inputs without losing required values',
    ({ tool, schema }) => {
      const operation = tool.id.replace('oracle_epm_narrative_reporting_', '')
      const input = { ...sample, operation }
      const selectTool = block.tools.config?.tool
      if (typeof selectTool !== 'function' || !block.tools.config?.params)
        throw new Error('Missing block operation adapter')
      expect(selectTool(input)).toBe(tool.id)
      const mapped = block.tools.config.params(input)
      expect(schema.safeParse({ ...mapped, ...auth }).success).toBe(true)
      for (const [key, param] of Object.entries(tool.params)) {
        if (param.required) expect(mapped[key], key).toBeDefined()
      }
      expect(tool.id.length).toBeLessThanOrEqual(64)
      expect(tool.operation).toBeDefined()
      expect(tool).not.toHaveProperty('request')
    }
  )
  it('preserves false and zero and excludes inactive or caller-owned authority', () => {
    const map = block.tools.config?.params
    if (!map) throw new Error('Missing block operation adapter')
    expect(
      map({
        ...sample,
        operation: 'list_reports',
        userId: 'attacker',
        instanceUrl: 'https://attacker.example',
      })
    ).toEqual({
      oauthCredential: 'credential',
      limit: 50,
      offset: 0,
      q: undefined,
      orderBy: undefined,
    })
    expect(map({ ...sample, operation: 'create_library_file' })).toMatchObject({ overwrite: false })
    expect(map({ ...sample, operation: 'create_report_snapshot' })).toMatchObject({
      overwrite: 'false',
    })
    expect(() => map({ ...sample, operation: 'list_reports', limit: 'not a number' })).toThrow()
  })
  it('keeps a JSON-array datasource value instead of stringifying it', () => {
    const map = block.tools.config?.params
    if (!map) throw new Error('Missing block operation adapter')
    expect(
      map({
        ...sample,
        operation: 'refresh_package_data_sources',
        refreshableSources: '["source"]',
      })
    ).toMatchObject({ refreshableSources: ['source'] })
    expect(() =>
      map({ ...sample, operation: 'refresh_package_data_sources', refreshableSources: 'bad' })
    ).toThrow('JSON array')
  })
  it('requires service accounts and authoritative credential destinations on every tool', () => {
    for (const { tool } of cases) {
      expect(tool.oauth).toMatchObject({
        required: true,
        provider: 'oracle-epm-narrative-reporting',
        credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
      expect(tool.params.oauthCredential).toMatchObject({ required: true, visibility: 'user-only' })
      expect(tool.params.accessToken.visibility).toBe('hidden')
      expect(tool.params.instanceUrl.visibility).toBe('hidden')
    }
  })
  it('exposes canonical file output and distinguishes submission from wait results', () => {
    expect(tools.oracleEpmNarrativeReportingDownloadReportOutputTool.outputs?.file.type).toBe(
      'file'
    )
    expect(tools.oracleEpmNarrativeReportingExportLibraryArtifactTool.outputs).not.toHaveProperty(
      'completed'
    )
    expect(tools.oracleEpmNarrativeReportingWaitForJobTool.outputs).toHaveProperty('timedOut')
    expect(tools.oracleEpmNarrativeReportingWaitForJobTool.outputs).toHaveProperty('jobId')
  })
  it('has no placeholder operations, duplicate subblocks or new icon', () => {
    expect(cases).toHaveLength(24)
    expect(new Set(block.tools.access)).toEqual(new Set(cases.map(({ tool }) => tool.id)))
    expect(new Set(block.subBlocks.map((field) => field.id)).size).toBe(block.subBlocks.length)
    expect(meta.templates.length).toBeGreaterThanOrEqual(7)
    expect(block.tools.access).not.toContain('oracle_epm_narrative_reporting_download_file')
  })
})
