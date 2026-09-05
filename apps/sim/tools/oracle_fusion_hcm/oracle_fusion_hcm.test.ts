/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { oracleFusionHcmListAbsencesBodySchema } from '@/lib/internal/oracle-fusion-hcm/schema'
import { OracleFusionHcmBlock } from '@/blocks/blocks/oracle_fusion_hcm'
import {
  oracleFusionHcmGetAbsenceTool,
  oracleFusionHcmGetWorkerAssignmentTool,
  oracleFusionHcmGetWorkerTool,
  oracleFusionHcmListAbsencesTool,
  oracleFusionHcmListAbsenceTypesTool,
  oracleFusionHcmListBusinessUnitsTool,
  oracleFusionHcmListDepartmentsTool,
  oracleFusionHcmListGradesTool,
  oracleFusionHcmListJobFamiliesTool,
  oracleFusionHcmListJobsTool,
  oracleFusionHcmListLegalEmployersTool,
  oracleFusionHcmListLocationsTool,
  oracleFusionHcmListPersonTypesTool,
  oracleFusionHcmListPositionsTool,
  oracleFusionHcmListWorkerAssignmentsTool,
  oracleFusionHcmListWorkerDirectReportsTool,
  oracleFusionHcmListWorkerManagersTool,
  oracleFusionHcmListWorkersTool,
} from '@/tools/oracle_fusion_hcm'

const tools = [
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
