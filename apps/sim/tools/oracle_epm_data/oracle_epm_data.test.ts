/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { NetSuiteIcon } from '@/components/icons'
import { OAUTH_PROVIDERS } from '@/lib/oauth/oauth'
import { selectorManifest } from '@/lib/selectors/manifest'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
} from '@/lib/workflows/subblocks/visibility'
import {
  OracleEpmDataBlock as block,
  OracleEpmDataBlockMeta as meta,
} from '@/blocks/blocks/oracle_epm_data'
import type { SubBlockConfig } from '@/blocks/types'
import toolMetadata from '@/tools/generated/tool-metadata'
import * as tools from '@/tools/oracle_epm_data'
import { hasToolId } from '@/tools/tool-ids'

const actions = [
  'list_connections',
  'get_connection',
  'update_connection',
  'get_pipeline_details',
  'run_integration',
  'run_pipeline',
  'run_data_rule',
  'run_batch',
  'get_job_status',
  'execute_report',
  'import_mappings',
  'export_mappings',
  'import_data_integration',
  'export_data_integration',
  'get_pov_status',
  'set_pov_lock',
  'list_files',
  'upload_file',
  'download_file',
  'delete_file',
]
const declarations = Object.values(tools).filter((value) => 'operation' in value)
function map(params: Record<string, unknown>) {
  if (!block.tools.config.params) throw new Error('Missing parameter mapper')
  return block.tools.config.params(params)
}
function field(id: string) {
  const result = block.subBlocks.find((subBlock) => subBlock.id === id)
  if (!result) throw new Error(`Missing field ${id}`)
  return result
}
function required(subBlock: SubBlockConfig, values: Record<string, unknown>) {
  const condition =
    typeof subBlock.required === 'function' ? subBlock.required(values) : subBlock.required
  return typeof condition === 'boolean'
    ? condition
    : condition
      ? evaluateSubBlockCondition(condition, values)
      : false
}

describe('Oracle EPM Data Integration block and tools', () => {
  it('makes every declared tool input reachable in the corresponding block operation', () => {
    for (const tool of declarations) {
      const operation = tool.id.slice('oracle_epm_data_'.length)
      const values = { operation, lockType: 'application' }
      for (const [paramId, param] of Object.entries(tool.params)) {
        if (param.visibility === 'hidden') continue
        const blockParam =
          paramId === 'fileName'
            ? ['upload_file', 'export_mappings', 'export_data_integration'].includes(operation)
              ? 'destinationFileName'
              : 'repositoryFileName'
            : paramId === 'importMode'
              ? operation === 'run_integration'
                ? 'integrationImportMode'
                : operation === 'run_data_rule'
                  ? 'dataRuleImportMode'
                  : 'mappingImportMode'
              : paramId === 'exportMode'
                ? operation === 'run_integration'
                  ? 'integrationExportMode'
                  : 'dataRuleExportMode'
                : paramId
        expect(block.inputs, `${tool.id}.${paramId}`).toHaveProperty(blockParam)
        const visible = block.subBlocks.filter(
          (subBlock) =>
            (subBlock.canonicalParamId ?? subBlock.id) === blockParam &&
            evaluateSubBlockCondition(subBlock.condition, values)
        )
        expect(visible.length, `${tool.id}.${paramId}`).toBeGreaterThan(0)
        if (param.required) {
          expect(
            visible.some((subBlock) => required(subBlock, values)),
            `${tool.id}.${paramId}`
          ).toBe(true)
          expect(
            visible.some((subBlock) => subBlock.mode !== 'advanced'),
            `${tool.id}.${paramId}`
          ).toBe(true)
        }
      }
    }
  })

  it('aligns all 20 operations, tool IDs, generated metadata and canvas sentences', () => {
    expect(declarations).toHaveLength(20)
    expect(declarations.map((tool) => tool.id).sort()).toEqual(
      actions.map((action) => `oracle_epm_data_${action}`).sort()
    )
    expect(field('operation').options?.map((option) => option.id)).toEqual(actions)
    expect(block.tools.access).toEqual(actions.map((action) => `oracle_epm_data_${action}`))
    expect(Object.keys(block.canvasPresentation?.sentences?.byOperation ?? {}).sort()).toEqual(
      [...actions].sort()
    )
    for (const action of actions) {
      const id = `oracle_epm_data_${action}`
      expect(block.tools.config.tool({ operation: action })).toBe(id)
      expect(hasToolId(id)).toBe(true)
      expect(toolMetadata[id]?.id).toBe(id)
    }
    expect(field('operation').value?.({})).toBe('list_connections')
  })

  it('uses registered internal operations and credential-authoritative hidden authentication', () => {
    for (const tool of declarations) {
      expect(tool.operation).toBeDefined()
      expect(tool).not.toHaveProperty('request')
      expect(tool.oauth).toEqual({
        required: true,
        provider: 'oracle-epm-data',
        credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
      expect(tool.params.oauthCredential.visibility).toBe('user-only')
      expect(tool.params.accessToken.visibility).toBe('hidden')
      expect(tool.params.instanceUrl.visibility).toBe('hidden')
    }
    expect(block.icon).toBe(NetSuiteIcon)
    expect(OAUTH_PROVIDERS['oracle-epm-data'].services['oracle-epm-data']).toMatchObject({
      authType: 'service_account',
      serviceAccountProviderId: 'oracle-epm-service-account',
      scopes: [],
    })
    expect(field('credential')).toMatchObject({
      credentialKind: 'service-account',
      serviceId: 'oracle-epm-data',
    })
    expect(tools.oracleEpmDataUpdateConnectionTool.params.sourceSystemOptions.visibility).toBe(
      'user-only'
    )
  })

  it('keeps complete basic/manual pairs with matching visibility and conditional requiredness', () => {
    const ids = block.subBlocks.map((subBlock) => subBlock.id)
    expect(new Set(ids).size).toBe(ids.length)
    const groups = buildCanonicalIndex(block.subBlocks).groupsById
    expect(Object.keys(groups).sort()).toEqual([
      'connectionName',
      'file',
      'locationName',
      'oauthCredential',
      'repositoryFileName',
    ])
    for (const [canonicalId, group] of Object.entries(groups)) {
      expect(ids).not.toContain(canonicalId)
      expect(group.basicId).toBeTruthy()
      expect(group.advancedIds).toHaveLength(1)
      const basic = field(group.basicId!)
      const advanced = field(group.advancedIds[0])
      expect(advanced.condition).toEqual(basic.condition)
      for (const operation of actions)
        for (const lockType of ['application', 'location']) {
          expect(required(basic, { operation, lockType })).toBe(
            required(advanced, { operation, lockType })
          )
        }
    }
    expect(
      required(field('locationSelector'), { operation: 'set_pov_lock', lockType: 'location' })
    ).toBe(true)
    expect(
      required(field('locationSelector'), { operation: 'set_pov_lock', lockType: 'application' })
    ).toBe(false)
    expect(field('uploadFile')).toMatchObject({ multiple: false, maxSize: 100 })
  })

  it('keeps unsupported catalogs manual and scopes location suggestions to POV dependencies', () => {
    expect(
      block.subBlocks
        .filter((subBlock) => subBlock.selectorKey)
        .map((subBlock) => subBlock.selectorKey)
        .sort()
    ).toEqual(['oracle_epm_data.connections', 'oracle_epm_data.files', 'oracle_epm_data.locations'])
    expect(field('locationSelector').dependsOn).toEqual([
      'credential',
      'application',
      'period',
      'category',
    ])
    expect(selectorManifest['oracle_epm_data.locations'].context.readiness).toEqual({
      all: ['oauthCredential', 'application', 'period', 'category'],
    })
    for (const id of ['pipelineCode', 'jobName', 'jobId', 'periodName'])
      expect(field(id).selectorKey).toBeUndefined()
  })

  it('normalizes only resolved active inputs, preserving opaque references until resolution', () => {
    expect(
      map({
        operation: 'run_integration',
        jobName: '<upstream.name>',
        periodName: '{Jan-26}',
        repositoryFileName: 'inbox/data.csv',
        integrationImportMode: 'Direct',
        integrationExportMode: 'Merge',
        sourceFilters: '{"Fiscal Year":"FY26"}',
        parameters: 'stale invalid JSON',
      })
    ).toMatchObject({
      jobName: '<upstream.name>',
      fileName: 'inbox/data.csv',
      importMode: 'Direct',
      exportMode: 'Merge',
      sourceFilters: { 'Fiscal Year': 'FY26' },
      parameters: undefined,
    })
    expect(
      map({
        operation: 'run_batch',
        jobName: 'Batch',
        waitForCompletion: 'false',
        variables: 'stale invalid JSON',
      })
    ).toMatchObject({ waitForCompletion: false, variables: undefined })
    expect(() => map({ operation: 'run_pipeline', variables: 'invalid JSON' })).toThrow()
  })

  it('preserves typed agent parameters when no editor operation is present', () => {
    const params = {
      oauthCredential: 'credential',
      fileName: 'outbox/file.csv',
      importMode: 'REPLACE',
      exportMode: 'MERGE',
      variables: { MONTH: 'Jan-26' },
      parameters: { Location: 'Source' },
      waitForCompletion: true,
    }
    expect(map(params)).toMatchObject(params)
  })

  it('normalizes one resolved UserFile and rejects multiple uploads', () => {
    const file = {
      id: 'id',
      key: 'workspace/data.csv',
      url: '/api/files/data.csv',
      name: 'data.csv',
      size: 3,
      type: 'text/csv',
    }
    expect(
      map({ operation: 'upload_file', file: [file], destinationFileName: 'data.csv' })
    ).toMatchObject({ file, fileName: 'data.csv' })
    expect(() =>
      map({ operation: 'upload_file', file: [file, file], destinationFileName: 'data.csv' })
    ).toThrow()
  })

  it('exposes only raw HTTP/JSON outputs and no wait option for the two opaque submissions', () => {
    for (const tool of [
      tools.oracleEpmDataRunIntegrationTool,
      tools.oracleEpmDataRunPipelineTool,
    ]) {
      expect(Object.keys(tool.outputs)).toEqual(['httpStatus', 'data'])
      expect(tool.params).not.toHaveProperty('waitForCompletion')
      for (const field of ['accepted', 'completed', 'jobId'])
        expect(tool.outputs).not.toHaveProperty(field)
    }
    expect(block.outputs.data.condition).toEqual({
      field: 'operation',
      value: ['run_integration', 'run_pipeline'],
    })
  })

  it('provides grounded workflows and explicitly warns about destructive and limited operations', () => {
    expect(meta.templates?.length).toBeGreaterThanOrEqual(7)
    expect(meta.skills?.length).toBeGreaterThanOrEqual(5)
    expect(block.longDescription).toContain('100 MiB')
    expect(block.longDescription).toContain('Snapshot import clears target data')
    expect(tools.oracleEpmDataImportDataIntegrationTool.description).toMatch(
      /clear|replace|destructive/i
    )
  })
})
