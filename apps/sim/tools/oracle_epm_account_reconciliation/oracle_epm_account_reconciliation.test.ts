/** @vitest-environment node */
import { describe, expect, it } from 'vitest'
import { NetSuiteIcon } from '@/components/icons'
import { getRegisteredInternalToolOperationIds } from '@/lib/internal/tool-operations/registry.server'
import { buildCanonicalIndex } from '@/lib/workflows/subblocks/visibility'
import { OracleEpmAccountReconciliationBlock as block } from '@/blocks/blocks/oracle_epm_account_reconciliation'
import { AuthMode, type SubBlockConfig } from '@/blocks/types'
import type { UserFile } from '@/executor/types'
import toolMetadata from '@/tools/generated/tool-metadata'
import toolOutputs from '@/tools/generated/tool-outputs'
import * as toolExports from '@/tools/oracle_epm_account_reconciliation'
import { hasToolId } from '@/tools/tool-ids'
import type { InternalToolConfig } from '@/tools/types'

const prefix = 'oracle_epm_account_reconciliation_'
function toolIdForAction(action: string) {
  return (
    prefix + (action === 'import_reconciliation_attributes' ? 'import_recon_attributes' : action)
  )
}
const tools = Object.values(toolExports).filter(
  (value): value is InternalToolConfig =>
    typeof value === 'object' && value !== null && 'id' in value && 'operation' in value
)
const actions = [
  'add_users_to_team',
  'archive_matched_transactions',
  'create_reconciliations',
  'delete_file',
  'delete_profile',
  'download_comment_attachment',
  'download_file',
  'export_user_details_report',
  'get_compliance_job_status',
  'get_matching_job_status',
  'import_balances',
  'import_compliance_transactions',
  'import_matching_transactions',
  'import_premapped_balances',
  'import_profiles',
  'import_rates',
  'import_reconciliation_attributes',
  'list_files',
  'list_periods',
  'list_reconciliation_comments',
  'list_users',
  'monitor_reconciliations',
  'purge_archived_transactions',
  'purge_matched_transactions',
  'remove_users_from_team',
  'run_auto_alert',
  'run_auto_match',
  'run_profile_rules',
  'run_reconciliation_rules',
  'set_period_status',
  'unmatch_auto_match_job',
  'unmatch_transactions',
  'upload_file',
]
const uiAliases: Record<string, string> = {
  list_periods_status: 'periodStatusFilter',
  set_period_status_status: 'periodStatus',
  import_profiles_importType: 'profileImportType',
  import_rates_importType: 'rateImportType',
  monitor_reconciliations_periodName: 'period',
  archive_matched_transactions_fileName: 'outputFileName',
  export_user_details_report_fileName: 'outputFileName',
  upload_file_fileName: 'outputFileName',
}
function isActive(field: SubBlockConfig, action: string) {
  const condition = field.condition
  if (!condition || typeof condition === 'function') return true
  const values = Array.isArray(condition.value) ? condition.value : [condition.value]
  return condition.not ? !values.includes(action) : values.includes(action)
}
function isRequired(field: SubBlockConfig, action: string) {
  if (field.required === true) return true
  if (!field.required || typeof field.required !== 'object') return false
  const value = field.required.value
  return (Array.isArray(value) ? value : [value]).includes(action)
}
function mapParams(input: Record<string, unknown>) {
  if (!block.tools.config.params) throw new Error('Missing parameter mapping')
  return block.tools.config.params(input)
}
describe('Account Reconciliation public integration contract', () => {
  it('exposes exactly the agreed 33 actions everywhere', () => {
    const ids = actions.map(toolIdForAction).sort()
    expect(actions).toHaveLength(33)
    expect(tools.map((tool) => tool.id).sort()).toEqual(ids)
    expect([...block.tools.access].sort()).toEqual(ids)
    expect(
      getRegisteredInternalToolOperationIds()
        .filter((id) => id.startsWith(prefix))
        .sort()
    ).toEqual(ids)
    const options = block.subBlocks.find((field) => field.id === 'operation')?.options
    expect(options?.map((option) => String(option.id)).sort()).toEqual(actions)
    expect(
      Object.keys(toolMetadata)
        .filter((id) => id.startsWith(prefix))
        .sort()
    ).toEqual(ids)
  })
  it('uses provider-safe unique tool IDs while preserving all UI operations', () => {
    expect(new Set(tools.map((tool) => tool.id)).size).toBe(33)
    for (const action of actions) {
      const id = toolIdForAction(action)
      expect(id).toMatch(/^[a-zA-Z0-9_-]{1,64}$/)
      expect(block.tools.config.tool({ operation: action })).toBe(id)
    }
  })
  it.each(tools)(
    '$id uses the in-process boundary and matches generated output contracts',
    (tool) => {
      expect('request' in tool).toBe(false)
      expect(hasToolId(tool.id)).toBe(true)
      expect(
        tool.operation.input({ oauthCredential: 'c', _context: { userId: 'untrusted' } })
      ).toEqual({ oauthCredential: 'c' })
      expect(toolMetadata[tool.id].params).toEqual(tool.params)
      expect(toolOutputs[tool.id]).toEqual(tool.outputs)
      expect(tool.params.instanceUrl.visibility).toBe('hidden')
      expect(tool.params.accessToken.visibility).toBe('hidden')
    }
  )
  it.each(tools)(
    '$id has visible fields with matching requiredness and conditional outputs',
    (tool) => {
      const action = actions.find((action) => toolIdForAction(action) === tool.id)!
      for (const [paramId, param] of Object.entries(tool.params)) {
        if (param.visibility === 'hidden') continue
        const id = uiAliases[`${action}_${paramId}`] ?? paramId
        const fields = block.subBlocks.filter(
          (field) => (field.canonicalParamId ?? field.id) === id && isActive(field, action)
        )
        expect(fields.length, `${action}: ${id}`).toBeGreaterThan(0)
        for (const field of fields)
          expect(isRequired(field, action), `${action}: ${field.id}`).toBe(param.required === true)
      }
      for (const outputId of Object.keys(tool.outputs)) {
        const output = block.outputs[outputId]
        expect(output, `${action}: ${outputId}`).toBeDefined()
        const conditions =
          typeof output === 'object' && 'condition' in output ? output.condition : undefined
        if (conditions && typeof conditions !== 'function') {
          expect(Array.isArray(conditions.value) ? conditions.value : [conditions.value]).toContain(
            action
          )
        }
      }
      // The block must not advertise outputs that this operation cannot produce.
      for (const [outputId, output] of Object.entries(block.outputs)) {
        if (typeof output !== 'object' || !('condition' in output)) continue
        const condition = output.condition
        if (!condition || typeof condition === 'function') continue
        const values = Array.isArray(condition.value) ? condition.value : [condition.value]
        if (values.includes(action))
          expect(tool.outputs, `${action}: ${outputId}`).toHaveProperty(outputId)
      }
    }
  )
  it('only exposes launch acceptance and documented matching artifacts', () => {
    const logActions = [
      'archive_matched_transactions',
      'get_matching_job_status',
      'import_matching_transactions',
      'purge_archived_transactions',
      'purge_matched_transactions',
      'unmatch_auto_match_job',
      'unmatch_transactions',
    ]
    for (const action of actions) {
      const outputs = tools.find((tool) => tool.id === toolIdForAction(action))!.outputs
      expect('logFileName' in outputs, action).toBe(logActions.includes(action))
      expect('archiveFileName' in outputs, action).toBe(
        ['archive_matched_transactions', 'get_matching_job_status'].includes(action)
      )
      if (action === 'get_compliance_job_status' || action === 'get_matching_job_status')
        expect(outputs).not.toHaveProperty('accepted')
    }
  })
  it('uses existing service-account credentials and the Oracle oval', () => {
    expect(block.authMode).toBe(AuthMode.ApiKey)
    expect(block.icon).toBe(NetSuiteIcon)
    expect(block.subBlocks.find((field) => field.id === 'operation')?.value?.({})).toBe(
      'list_periods'
    )
    for (const field of block.subBlocks.filter((field) => field.type === 'oauth-input'))
      expect(field.serviceId).toBe('oracle-epm-account-reconciliation')
    const canonical = buildCanonicalIndex(block.subBlocks)
    expect(canonical).toBeDefined()
    for (const id of ['oauthCredential', 'period', 'fileName', 'file']) {
      const pair = block.subBlocks.filter((field) => field.canonicalParamId === id)
      expect(pair).toHaveLength(2)
      expect(pair.map((field) => field.mode).sort()).toEqual(['advanced', 'basic'])
      expect(pair.every((field) => field.id !== id)).toBe(true)
    }
  })
  it('selects tools before resolution without coercing dynamic inputs', () => {
    expect(
      block.tools.config.tool({
        operation: 'unmatch_transactions',
        matchIds: '<prior.ids>',
        forceReopen: '<prior.flag>',
      })
    ).toBe(`${prefix}unmatch_transactions`)
    expect(
      mapParams({
        operation: 'unmatch_transactions',
        matchTypeId: 'MT',
        matchIds: '[1,2]',
        forceReopen: 'false',
        waitForCompletion: 'true',
        maxWaitSeconds: '60',
      })
    ).toMatchObject({
      matchIds: [1, 2],
      forceReopen: false,
      waitForCompletion: true,
      maxWaitSeconds: 60,
    })
    expect(() => mapParams({ operation: 'run_auto_match', waitForCompletion: 'yes' })).toThrow()
    expect(() => mapParams({ operation: 'run_auto_match', maxWaitSeconds: '301' })).toThrow()
  })
  it('maps canonical period names and exact staged filenames without changing values', () => {
    expect(
      mapParams({
        operation: 'import_profiles',
        period: 'January 2026',
        fileName: 'inbox/Profiles 1.csv',
        profileImportType: 'Update',
        profileType: 'Profiles',
        dateFormat: 'MM/dd/yyyy',
      })
    ).toMatchObject({
      period: 'January 2026',
      fileName: 'inbox/Profiles 1.csv',
      importType: 'Update',
    })
    expect(
      mapParams({
        operation: 'monitor_reconciliations',
        period: 'January 2026',
        filterName: 'Open',
      })
    ).toMatchObject({ periodName: 'January 2026' })
    expect(
      mapParams({ operation: 'list_periods', periodStatusFilter: 'OPEN_PENDING' })
    ).toMatchObject({ status: 'OPEN_PENDING' })
  })
  it('normalizes a file only in the resolved parameter mapping', () => {
    const file: UserFile = {
      id: 'f',
      name: 'balances.csv',
      size: 4,
      type: 'text/csv',
      url: '/api/files/serve/balances.csv',
      key: 'key',
      context: 'workflow',
    }
    expect(block.tools.config.tool({ operation: 'upload_file', file: '<prior.file>' })).toBe(
      `${prefix}upload_file`
    )
    expect(mapParams({ operation: 'upload_file', file: [file] })).toMatchObject({ file })
  })
})
