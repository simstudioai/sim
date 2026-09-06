/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  oracleFusionHcmListAbsencesBodySchema,
  oracleFusionHcmUpdateElementEntryValueBodySchema,
} from '@/lib/internal/oracle-fusion-hcm/schema'
import {
  buildSelectorContextFromValues,
  getSelectorContextSubBlocks,
} from '@/lib/selectors/context'
import { parseDependsOn } from '@/lib/workflows/subblocks/visibility'
import { OracleFusionHcmBlock } from '@/blocks/blocks/oracle_fusion_hcm'
import {
  oracleFusionHcmCorrectSalaryTool,
  oracleFusionHcmCreateAssignedPayrollTool,
  oracleFusionHcmCreateElementEntryTool,
  oracleFusionHcmCreateSalaryTool,
  oracleFusionHcmCreateTimeEntryTool,
  oracleFusionHcmDeleteTimeEntryTool,
  oracleFusionHcmGetAbsenceTool,
  oracleFusionHcmGetAssignedPayrollTool,
  oracleFusionHcmGetDevelopmentGoalTool,
  oracleFusionHcmGetElementEntryTool,
  oracleFusionHcmGetGoalPlanTool,
  oracleFusionHcmGetPayrollAssignmentTool,
  oracleFusionHcmGetPayrollRelationshipTool,
  oracleFusionHcmGetPerformanceDocumentTool,
  oracleFusionHcmGetPerformanceGoalTool,
  oracleFusionHcmGetPersonProcessResultTool,
  oracleFusionHcmGetSalaryTool,
  oracleFusionHcmGetTalentProfileTool,
  oracleFusionHcmGetTimeCardTool,
  oracleFusionHcmGetTimeRecordRequestTool,
  oracleFusionHcmGetTimeRecordTool,
  oracleFusionHcmGetWorkerAssignmentTool,
  oracleFusionHcmGetWorkerTool,
  oracleFusionHcmListAbsencesTool,
  oracleFusionHcmListAbsenceTypesTool,
  oracleFusionHcmListAssignedPayrollsTool,
  oracleFusionHcmListBusinessUnitsTool,
  oracleFusionHcmListDepartmentsTool,
  oracleFusionHcmListDevelopmentGoalsTool,
  oracleFusionHcmListElementEntriesTool,
  oracleFusionHcmListElementEntryValuesTool,
  oracleFusionHcmListGoalPlansTool,
  oracleFusionHcmListGradeRateValuesTool,
  oracleFusionHcmListGradesTool,
  oracleFusionHcmListJobFamiliesTool,
  oracleFusionHcmListJobsTool,
  oracleFusionHcmListLegalEmployersTool,
  oracleFusionHcmListLocationsTool,
  oracleFusionHcmListPayrollAssignmentsTool,
  oracleFusionHcmListPayrollBalancesTool,
  oracleFusionHcmListPayrollDefinitionsTool,
  oracleFusionHcmListPayrollElementDefinitionsTool,
  oracleFusionHcmListPayrollInputValuesTool,
  oracleFusionHcmListPayrollRelationshipsTool,
  oracleFusionHcmListPayrollRunResultsTool,
  oracleFusionHcmListPayrollTimePeriodsTool,
  oracleFusionHcmListPerformanceDocumentParticipantsTool,
  oracleFusionHcmListPerformanceDocumentRolesTool,
  oracleFusionHcmListPerformanceDocumentsTool,
  oracleFusionHcmListPerformanceDocumentTasksTool,
  oracleFusionHcmListPerformanceGoalsTool,
  oracleFusionHcmListPersonProcessResultsTool,
  oracleFusionHcmListPersonTypesTool,
  oracleFusionHcmListPositionsTool,
  oracleFusionHcmListSalariesTool,
  oracleFusionHcmListSalaryBasesTool,
  oracleFusionHcmListSalaryComponentsTool,
  oracleFusionHcmListTalentProfileCertificationsTool,
  oracleFusionHcmListTalentProfileSectionsTool,
  oracleFusionHcmListTalentProfileSkillsTool,
  oracleFusionHcmListTalentProfilesTool,
  oracleFusionHcmListTimeAttributeCriteriaBindsTool,
  oracleFusionHcmListTimeAttributeDataSourcesTool,
  oracleFusionHcmListTimeAttributesTool,
  oracleFusionHcmListTimeAttributeValuesTool,
  oracleFusionHcmListTimeCardsTool,
  oracleFusionHcmListTimeRecordEventMessagesTool,
  oracleFusionHcmListTimeRecordRequestEventsTool,
  oracleFusionHcmListTimeRecordsTool,
  oracleFusionHcmListWorkerAssignmentsTool,
  oracleFusionHcmListWorkerDirectReportsTool,
  oracleFusionHcmListWorkerManagersTool,
  oracleFusionHcmListWorkersTool,
  oracleFusionHcmUpdateAssignedPayrollTool,
  oracleFusionHcmUpdateElementEntryValueTool,
  oracleFusionHcmUpdateTimeEntryTool,
} from '@/tools/oracle_fusion_hcm'
import { createLLMToolSchema } from '@/tools/params'
import { validateRequiredParametersAfterMerge } from '@/tools/utils'

const tools = [
  oracleFusionHcmListPayrollRelationshipsTool,
  oracleFusionHcmGetPayrollRelationshipTool,
  oracleFusionHcmListPayrollAssignmentsTool,
  oracleFusionHcmGetPayrollAssignmentTool,
  oracleFusionHcmListAssignedPayrollsTool,
  oracleFusionHcmGetAssignedPayrollTool,
  oracleFusionHcmCreateAssignedPayrollTool,
  oracleFusionHcmUpdateAssignedPayrollTool,
  oracleFusionHcmListPayrollDefinitionsTool,
  oracleFusionHcmListPayrollTimePeriodsTool,
  oracleFusionHcmListPayrollElementDefinitionsTool,
  oracleFusionHcmListPayrollInputValuesTool,
  oracleFusionHcmListElementEntriesTool,
  oracleFusionHcmGetElementEntryTool,
  oracleFusionHcmListElementEntryValuesTool,
  oracleFusionHcmCreateElementEntryTool,
  oracleFusionHcmUpdateElementEntryValueTool,
  oracleFusionHcmListPersonProcessResultsTool,
  oracleFusionHcmGetPersonProcessResultTool,
  oracleFusionHcmListPayrollRunResultsTool,
  oracleFusionHcmListPayrollBalancesTool,
  oracleFusionHcmListSalariesTool,
  oracleFusionHcmGetSalaryTool,
  oracleFusionHcmCreateSalaryTool,
  oracleFusionHcmCorrectSalaryTool,
  oracleFusionHcmListSalaryBasesTool,
  oracleFusionHcmListSalaryComponentsTool,
  oracleFusionHcmListGradeRateValuesTool,
  oracleFusionHcmListGoalPlansTool,
  oracleFusionHcmGetGoalPlanTool,
  oracleFusionHcmListPerformanceGoalsTool,
  oracleFusionHcmGetPerformanceGoalTool,
  oracleFusionHcmListDevelopmentGoalsTool,
  oracleFusionHcmGetDevelopmentGoalTool,
  oracleFusionHcmListPerformanceDocumentsTool,
  oracleFusionHcmGetPerformanceDocumentTool,
  oracleFusionHcmListPerformanceDocumentRolesTool,
  oracleFusionHcmListPerformanceDocumentParticipantsTool,
  oracleFusionHcmListPerformanceDocumentTasksTool,
  oracleFusionHcmListTalentProfilesTool,
  oracleFusionHcmGetTalentProfileTool,
  oracleFusionHcmListTalentProfileSectionsTool,
  oracleFusionHcmListTalentProfileSkillsTool,
  oracleFusionHcmListTalentProfileCertificationsTool,
  oracleFusionHcmListTimeRecordsTool,
  oracleFusionHcmGetTimeRecordTool,
  oracleFusionHcmListTimeCardsTool,
  oracleFusionHcmGetTimeCardTool,
  oracleFusionHcmListTimeAttributesTool,
  oracleFusionHcmListTimeAttributeDataSourcesTool,
  oracleFusionHcmListTimeAttributeCriteriaBindsTool,
  oracleFusionHcmListTimeAttributeValuesTool,
  oracleFusionHcmCreateTimeEntryTool,
  oracleFusionHcmUpdateTimeEntryTool,
  oracleFusionHcmDeleteTimeEntryTool,
  oracleFusionHcmGetTimeRecordRequestTool,
  oracleFusionHcmListTimeRecordRequestEventsTool,
  oracleFusionHcmListTimeRecordEventMessagesTool,
  oracleFusionHcmListWorkersTool,
  oracleFusionHcmGetWorkerTool,
  oracleFusionHcmListWorkerAssignmentsTool,
  oracleFusionHcmGetWorkerAssignmentTool,
  oracleFusionHcmListWorkerManagersTool,
  oracleFusionHcmListWorkerDirectReportsTool,
  oracleFusionHcmListAbsencesTool,
  oracleFusionHcmGetAbsenceTool,
  oracleFusionHcmListAbsenceTypesTool,
  oracleFusionHcmListJobsTool,
  oracleFusionHcmListJobFamiliesTool,
  oracleFusionHcmListDepartmentsTool,
  oracleFusionHcmListLocationsTool,
  oracleFusionHcmListPositionsTool,
  oracleFusionHcmListBusinessUnitsTool,
  oracleFusionHcmListLegalEmployersTool,
  oracleFusionHcmListGradesTool,
  oracleFusionHcmListPersonTypesTool,
]

describe('Oracle Fusion HCM tool definitions', () => {
  it('uses only active canonical payroll context without requiring optional filters', () => {
    const values = {
      operation: 'get_payroll_assignment',
      credential: 'basic-credential',
      manualCredential: 'manual-credential',
      payrollRelationshipIdPicker: '1',
      payrollRelationshipIdInput: '9007199254740993',
      effectiveDate: '2020-01-01',
      personPicker: 'dormant-person',
    }
    const field = OracleFusionHcmBlock.subBlocks.find(
      (field) => field.id === 'payrollAssignmentIdPicker'
    )
    if (!field) throw new Error('Missing payroll assignment selector')
    const dependencies = parseDependsOn(field.dependsOn)
    expect(dependencies.allFields).toEqual(['oauthCredential', 'payrollRelationshipId'])
    const context = buildSelectorContextFromValues({
      selectorKey: 'oracle_fusion_hcm.payrollAssignments',
      contextConfigs: getSelectorContextSubBlocks(OracleFusionHcmBlock.subBlocks, values),
      values,
      dependsOn: dependencies.allDependsOnFields,
      canonicalModes: { oauthCredential: 'advanced', payrollRelationshipId: 'advanced' },
    })
    expect(context).toEqual({
      oauthCredential: 'manual-credential',
      payrollRelationshipId: '9007199254740993',
      effectiveDate: '2020-01-01',
    })
    expect(context).not.toHaveProperty('personId')
  })

  it('normalizes resolved array inputs while retaining exact IDs and explicit null values', () => {
    const map = OracleFusionHcmBlock.tools.config.params
    if (!map) throw new Error('Expected parameter mapping')
    const result = map({
      operation: 'create_element_entry',
      personId: '9223372036854775807',
      entryValues: '[{"inputValueId":"9223372036854775806","screenEntryValue":null}]',
      screenEntryValue: null,
      timeRecordVersion: '2',
    })
    expect(result).toMatchObject({
      personId: '9223372036854775807',
      entryValues: [{ inputValueId: '9223372036854775806', screenEntryValue: null }],
      screenEntryValue: null,
      timeRecordVersion: 2,
    })
    expect(() =>
      map({ operation: 'create_element_entry', entryValues: 'private invalid JSON' })
    ).toThrow('Oracle Fusion HCM array input must be valid JSON')
    expect(() =>
      map({ operation: 'create_element_entry', entryValues: `${' '.repeat(65_537)}[]` })
    ).toThrow('character limit')
  })
  it('preserves explicit null clearing through post-merge validation but rejects an omitted value', () => {
    const params = {
      instanceUrl: 'https://example.oraclecloud.com',
      accessToken: 'token',
      elementEntryId: '1',
      elementEntryValueId: '2',
      effectiveDate: '2026-01-01',
      rangeMode: 'CORRECTION',
    }
    expect(() =>
      validateRequiredParametersAfterMerge(
        oracleFusionHcmUpdateElementEntryValueTool.id,
        oracleFusionHcmUpdateElementEntryValueTool,
        { ...params, screenEntryValue: null }
      )
    ).not.toThrow()
    expect(
      oracleFusionHcmUpdateElementEntryValueBodySchema.safeParse({
        ...params,
        screenEntryValue: null,
      }).success
    ).toBe(true)
    expect(oracleFusionHcmUpdateElementEntryValueBodySchema.safeParse(params).success).toBe(false)
  })

  it('offers a model-expressible clear flag without accepting an accidental omitted value', async () => {
    const { schema } = await createLLMToolSchema(oracleFusionHcmUpdateElementEntryValueTool, {})
    expect(schema.properties.clearScreenEntryValue.type).toBe('boolean')
    const map = OracleFusionHcmBlock.tools.config.params
    if (!map) throw new Error('Expected parameter mapping')
    const params = map({
      operation: 'update_element_entry_value',
      instanceUrl: 'https://example.oraclecloud.com',
      accessToken: 'token',
      elementEntryId: '1',
      elementEntryValueId: '2',
      effectiveDate: '2026-01-01',
      rangeMode: 'CORRECTION',
      clearScreenEntryValue: 'true',
      screenEntryValue: '',
    })
    expect(oracleFusionHcmUpdateElementEntryValueBodySchema.parse(params).screenEntryValue).toBeNull()
    expect(
      oracleFusionHcmUpdateElementEntryValueBodySchema.safeParse({
        ...params,
        screenEntryValue: '125.00',
      }).success
    ).toBe(false)
    expect(
      oracleFusionHcmUpdateElementEntryValueBodySchema.safeParse({
        ...params,
        clearScreenEntryValue: false,
      }).success
    ).toBe(false)
    for (const clearScreenEntryValue of [undefined, false]) {
      const blank = map({ ...params, screenEntryValue: '', clearScreenEntryValue })
      expect(oracleFusionHcmUpdateElementEntryValueBodySchema.safeParse(blank).success).toBe(false)
      expect(
        oracleFusionHcmUpdateElementEntryValueBodySchema.safeParse({
          ...params,
          screenEntryValue: '',
          clearScreenEntryValue,
        }).success
      ).toBe(false)
    }
  })

  it('maps every selectable block operation to its executable tool', () => {
    const options = OracleFusionHcmBlock.subBlocks.find(
      (field) => field.id === 'operation'
    )?.options
    if (!Array.isArray(options)) throw new Error('Expected operation choices')
    const ids = options.map(({ id }) => OracleFusionHcmBlock.tools.config.tool({ operation: id }))
    expect(ids.sort()).toEqual(tools.map((tool) => tool.id).sort())
    expect(OracleFusionHcmBlock.tools.config.tool({})).toBe('oracle_fusion_hcm_list_workers')
  })

  it('maps canonical credential and exact IDs without numeric precision loss', () => {
    const map = OracleFusionHcmBlock.tools.config.params
    if (!map) throw new Error('Expected parameter mapping')
    expect(
      map({
        operation: 'get_worker_assignment',
        oauthCredential: 'credential-id',
        personId: '9223372036854775807',
        assignmentId: '9223372036854775806',
        limit: '25',
        offset: '',
      })
    ).toEqual({
      oauthCredential: 'credential-id',
      personId: '9223372036854775807',
      assignmentId: '9223372036854775806',
      limit: 25,
    })
  })

  it('clears optional UI values after the executor merges transformed and raw inputs', () => {
    const map = OracleFusionHcmBlock.tools.config.params
    if (!map) throw new Error('Expected parameter mapping')
    const raw = {
      operation: 'list_absences',
      oauthCredential: 'credential-id',
      accessToken: 'opaque',
      instanceUrl: 'https://acme.fa.ocs.oraclecloud.com',
      personId: '9223372036854775807',
      absenceTypeId: null,
      startDate: '',
      endDate: ' ',
      effectiveDate: null,
      search: '',
      limit: null,
      offset: '',
    }
    const merged = { ...raw, ...map(raw) }
    expect(oracleFusionHcmListAbsencesBodySchema.parse(merged)).toMatchObject({
      personId: '9223372036854775807',
      absenceTypeId: undefined,
      startDate: undefined,
      endDate: undefined,
      limit: undefined,
      offset: undefined,
    })
    for (const invalid of [{ offset: false }, { limit: 'many' }, { startDate: 'tomorrow' }]) {
      const input = { ...raw, ...invalid }
      expect(
        oracleFusionHcmListAbsencesBodySchema.safeParse({ ...input, ...map(input) }).success
      ).toBe(false)
    }
  })

  it.each(tools)(
    '$id requires canonical credential auth and an authoritative destination',
    (tool) => {
      expect(tool.oauth).toEqual({
        required: true,
        provider: 'oracle_fusion_hcm',
        requiredScopes: [],
        credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
      expect(tool.params).toMatchObject({
        oauthCredential: { type: 'string', required: true, visibility: 'user-only' },
        accessToken: { type: 'string', required: false, visibility: 'hidden' },
        instanceUrl: { type: 'string', required: false, visibility: 'hidden' },
      })
      expect(tool.params).not.toHaveProperty('tenantUrl')
      expect(tool.params).not.toHaveProperty('username')
      expect(tool.params).not.toHaveProperty('password')
      expect(tool.operation).toBeDefined()
      expect(tool.request).toBeUndefined()
    }
  )

  it('strips execution context before crossing the internal operation boundary', () => {
    const operation = oracleFusionHcmListWorkersTool.operation
    if (!operation) throw new Error('expected internal operation')
    const params = {
      oauthCredential: 'credential-id',
      instanceUrl: 'https://acme.fa.ocs.oraclecloud.com',
      accessToken: 'opaque',
      _context: { private: true },
    }
    expect(operation.input(params)).toEqual({
      oauthCredential: 'credential-id',
      instanceUrl: 'https://acme.fa.ocs.oraclecloud.com',
      accessToken: 'opaque',
    })
  })

  it('uses a fixed non-reflective transform error', async () => {
    await expect(
      oracleFusionHcmListWorkersTool.transformResponse?.(
        new Response(JSON.stringify({ error: 'private upstream detail' }), { status: 502 })
      )
    ).rejects.toThrow('Oracle Fusion HCM request failed')
  })
})
