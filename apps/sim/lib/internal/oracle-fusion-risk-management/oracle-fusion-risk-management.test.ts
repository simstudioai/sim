/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'
import { executeOracleFusionRiskManagementTool } from '@/lib/internal/oracle-fusion-risk-management/execute-tool'
import { executeRiskOperation } from '@/lib/internal/oracle-fusion-risk-management/operations'
import {
  parseRiskBody,
  riskWriteSchemas,
} from '@/lib/internal/oracle-fusion-risk-management/schema'
import { getRegisteredInternalToolOperationIds } from '@/lib/internal/tool-operations/registry.server'
import * as riskTools from '@/tools/oracle_fusion_risk_management'
import { RISK_OPERATIONS } from '@/tools/oracle_fusion_risk_management/types'

const mocks = vi.hoisted(() => ({ request: vi.fn(), empty: vi.fn(), resolveAccount: vi.fn() }))
vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.request,
  requestOracleFusionEmpty: mocks.empty,
}))
vi.mock('@/lib/oauth/credential-service', () => ({ resolveOAuthAccountId: mocks.resolveAccount }))

const ORIGIN = 'https://example.fa.us2.oraclecloud.com'
const ROOT = '/fscmRestApi/resources/11.13.18.05/'
const ID = '9007199254740993'
const KEY = '00020000ABCD'
const AUTH = { oauthCredential: 'credential', instanceUrl: ORIGIN, accessToken: 'injected-token' }
function record(path: string, fields: Record<string, unknown>) {
  return { ...fields, '@context': { links: [{ rel: 'self', href: ORIGIN + ROOT + path }] } }
}
function page(items: unknown[], hasMore = false, offset = 0) {
  return { items, count: items.length, hasMore, offset, limit: 100 }
}
function execute(action: string, input: Record<string, unknown> = {}, signal?: AbortSignal) {
  return executeRiskOperation(
    `oracle_fusion_risk_management_${action}`,
    { ...AUTH, ...input },
    signal
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  mocks.resolveAccount.mockResolvedValue({
    credentialType: 'service_account',
    providerId: 'oracle-fusion-service-account',
  })
})

describe('Risk Management provider contracts', () => {
  it('projects one process page without rounding identifiers or following next links', async () => {
    mocks.request.mockResolvedValue(
      page(
        [record(`frcProcesses/${ID}`, { ProcessId: ID, Name: 'Review', AssessmentFlag: false })],
        true,
        5
      )
    )
    const result = await execute('list_processes', { offset: 5 })
    expect(result.output).toMatchObject({
      items: [{ ProcessId: ID, Name: 'Review', AssessmentFlag: false }],
      count: 1,
      nextOffset: 6,
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      address: { family: 'fscm', relativePath: 'frcProcesses' },
      query: { limit: 100, offset: 5 },
    })
    expect(JSON.stringify(result.output)).not.toContain('@context')
  })

  it('creates a named risk while preserving exact numeric request values', async () => {
    mocks.request.mockResolvedValue(record(`frcRisks/${ID}`, { RiskId: ID, Name: 'Risk' }))
    await execute('create_risk', { body: { Name: 'Risk', RiskAnalysisModelId: ID } })
    const request = mocks.request.mock.calls[0][1]
    expect(request).toMatchObject({ method: 'POST', address: { relativePath: 'frcRisks' } })
    expect(serializeOracleFusionJsonBody(request.body)).toBe(
      `{"Name":"Risk","RiskAnalysisModelId":${ID}}`
    )
  })

  it.each([
    'update_risk',
    'create_issue',
    'run_advanced_controls',
    'approve_assessment',
    'approve_access_request',
  ])('does not expose %s', async (action) => {
    await expect(execute(action)).rejects.toThrow('Unsupported')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it.each([
    ['create_process', { body: { Status: 'ACTIVE' } }],
    ['update_issue', { issueId: ID, body: { Status: 'CLOSED' } }],
    ['update_control', { controlId: ID, body: { relatedRisks: [{ RiskId: ID }] } }],
    ['update_advanced_control', { advancedControlId: ID, body: { LatestJobId: ID } }],
    ['update_assignment_group', { groupKey: 'group', body: { RoleType: 'OWNER' } }],
    ['update_control_test_plan', { controlId: ID, testPlanId: '4', body: { TestPlanId: '5' } }],
  ])('rejects unsupported or missing fields for %s before transport', async (action, input) => {
    await expect(execute(action, input)).rejects.toThrow()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('keeps process boolean flags distinct from control string flags', () => {
    expect(riskWriteSchemas.update_process.parse({ AssessmentFlag: false })).toEqual({
      AssessmentFlag: false,
    })
    expect(() => riskWriteSchemas.update_control.parse({ AssessmentFlag: false })).toThrow()
    expect(riskWriteSchemas.update_control.parse({ AssessmentFlag: 'N' })).toEqual({
      AssessmentFlag: 'N',
    })
  })

  it('uses assessment-specific response codes and does not certify results', async () => {
    mocks.request.mockResolvedValue(
      record(`frcRiskAssessmentResults/${ID}`, { ResultId: ID, ResponseCode: 'MEETS_GUIDANCE' })
    )
    await execute('update_risk_assessment_result', {
      riskAssessmentResultId: ID,
      body: { ResponseCode: 'MEETS_GUIDANCE' },
    })
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      address: { relativePath: `frcRiskAssessmentResults/${ID}` },
    })
    expect(() =>
      riskWriteSchemas.update_control_assessment_result.parse({ ResponseCode: 'MEETS_GUIDANCE' })
    ).toThrow()
    expect(() =>
      riskWriteSchemas.update_risk_assessment_result.parse({ ApprovedBy: 'someone' })
    ).toThrow()
  })

  it('derives relationship keys from validated self links, not numeric parent IDs', async () => {
    mocks.request.mockResolvedValue(
      page([record(`frcProcesses/${ID}/child/relatedRisks/${KEY}`, { ProcessId: ID, RiskId: '8' })])
    )
    const result = await execute('list_process_risks', { processId: ID })
    expect(result.output).toMatchObject({ items: [{ key: KEY, ProcessId: ID, RiskId: '8' }] })
    await execute('delete_process_risk', { processId: ID, relationshipKey: KEY })
    expect(mocks.empty.mock.calls[0][1]).toEqual({
      method: 'DELETE',
      address: { family: 'fscm', relativePath: `frcProcesses/${ID}/child/relatedRisks/${KEY}` },
    })
  })

  it('rejects a relationship self link belonging to another parent', async () => {
    mocks.request.mockResolvedValue(
      page([
        record(`frcProcesses/999/child/relatedRisks/${KEY}`, { ProcessId: '999', RiskId: '8' }),
      ])
    )
    await expect(execute('list_process_risks', { processId: ID })).rejects.toThrow('invalid')
  })

  it('returns the new opaque key when updating an assertion composite key', async () => {
    mocks.request.mockResolvedValue(
      record(`frcControls/${ID}/child/assertions/NEWKEY`, {
        ControlId: ID,
        AssertionCode: 'ACCURACY',
      })
    )
    const result = await execute('update_control_assertion', {
      controlId: ID,
      assertionKey: KEY,
      body: { AssertionCode: 'ACCURACY' },
    })
    expect(result.output).toMatchObject({
      record: { key: 'NEWKEY', ControlId: ID, AssertionCode: 'ACCURACY' },
    })
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      address: { relativePath: `frcControls/${ID}/child/assertions/${KEY}` },
    })
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it.each([
    ['999', 'ACCURACY'],
    [ID, 'EXISTENCE'],
  ])(
    'rejects an assertion update response for the wrong parent or code',
    async (controlId, code) => {
      mocks.request.mockResolvedValue(
        record(`frcControls/${controlId}/child/assertions/NEWKEY`, {
          ControlId: controlId,
          AssertionCode: code,
        })
      )
      await expect(
        execute('update_control_assertion', {
          controlId: ID,
          assertionKey: KEY,
          body: { AssertionCode: 'ACCURACY' },
        })
      ).rejects.toThrow()
      expect(mocks.request).toHaveBeenCalledTimes(1)
    }
  )

  it('binds relationship creation to the selected process', async () => {
    mocks.request.mockResolvedValue(
      record(`frcProcesses/${ID}/child/relatedRisks/${KEY}`, { ProcessId: ID, RiskId: '8' })
    )
    await execute('create_process_risk', { processId: ID, body: { RiskId: '8' } })
    expect(serializeOracleFusionJsonBody(mocks.request.mock.calls[0][1].body)).toBe(
      `{"ProcessId":${ID},"RiskId":8}`
    )
    mocks.request.mockClear()
    await expect(
      execute('create_process_risk', { processId: ID, body: { ProcessId: '7', RiskId: '8' } })
    ).rejects.toThrow('parent')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('keeps group navigation keys separate from business IDs in child mutations', async () => {
    mocks.request.mockResolvedValueOnce(
      record(`userAssignmentGroups/${KEY}`, { GroupId: 'group-business-id', Name: 'Reviewers' })
    )
    mocks.request.mockResolvedValueOnce(
      record(`userAssignmentGroups/${KEY}/child/members/7`, {
        Id: '7',
        GroupId: 'group-business-id',
        UserId: 'user-guid',
      })
    )
    await execute('create_group_member', { groupKey: KEY, body: { UserId: 'user-guid' } })
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      method: 'GET',
      address: { relativePath: `userAssignmentGroups/${KEY}` },
    })
    expect(mocks.request.mock.calls[1][1]).toMatchObject({
      method: 'POST',
      address: { relativePath: `userAssignmentGroups/${KEY}/child/members` },
    })
    expect(serializeOracleFusionJsonBody(mocks.request.mock.calls[1][1].body)).toBe(
      '{"GroupId":"group-business-id","UserId":"user-guid"}'
    )
    expect(mocks.request).toHaveBeenCalledTimes(2)
  })

  it('does not mutate when the selected group resolves to a different parent', async () => {
    mocks.request.mockResolvedValue(
      record('userAssignmentGroups/wrong-key', { GroupId: 'group-business-id' })
    )
    await expect(
      execute('create_group_member', { groupKey: KEY, body: { UserId: 'user-guid' } })
    ).rejects.toThrow('different resource')
    expect(mocks.request).toHaveBeenCalledTimes(1)
    expect(mocks.request.mock.calls[0][1].method).toBe('GET')
  })

  it('uses an incident hash key even when the nullable business ID is absent', async () => {
    const path = `advancedControls/${ID}/child/incidents/${KEY}`
    mocks.request.mockResolvedValue(record(path, { Id: null, Status: 'Accepted' }))
    const result = await execute('get_incident', { advancedControlId: ID, incidentKey: KEY })
    expect(result.output).toMatchObject({ record: { key: KEY, Id: null, Status: 'Accepted' } })
    mocks.request.mockResolvedValue(page([record(path, { Id: null, Status: 'Accepted' })]))
    expect((await execute('list_incidents', { advancedControlId: ID })).output).toMatchObject({
      items: [{ key: KEY, Id: null }],
    })
    mocks.request.mockResolvedValue(
      record(`${path}/child/dynamicAttributes/attribute-hash`, {
        Id: 'business-attribute-id',
        AttributeName: 'Amount',
        AttributeValue: '1',
      })
    )
    expect(
      (
        await execute('get_incident_attribute', {
          advancedControlId: ID,
          incidentKey: KEY,
          attributeKey: 'attribute-hash',
        })
      ).output
    ).toMatchObject({ record: { key: 'attribute-hash', Id: 'business-attribute-id' } })
  })

  it('uses the full control/test-plan path for a step mutation', async () => {
    const path = `frcControls/${ID}/child/testPlans/4/child/steps/5`
    mocks.request.mockResolvedValue(record(path, { StepId: '5', TestPlanId: '4', StepOrder: 2 }))
    await execute('update_test_plan_step', {
      controlId: ID,
      testPlanId: '4',
      stepId: '5',
      body: { StepOrder: 2 },
    })
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      address: { relativePath: path },
      body: { StepOrder: 2 },
    })
  })

  it('updates process action items through the parent PATCH only', async () => {
    mocks.request.mockResolvedValue(record(`frcProcesses/${ID}`, { ProcessId: ID }))
    await execute('update_process', {
      processId: ID,
      body: { actionItems: [{ ActionId: '7', ProgressCode: 'Blocked' }] },
    })
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      address: { relativePath: `frcProcesses/${ID}` },
    })
    expect(() =>
      riskWriteSchemas.update_process.parse({ actionItems: [{ ProgressCode: 'Blocked' }] })
    ).toThrow()
  })

  it('keeps incident updates scoped to one incident and preserves attribute name/value pairs', async () => {
    const path = `advancedControls/${ID}/child/incidents/incident-key`
    mocks.request.mockResolvedValue(record(path, { Id: 'incident-key', Status: 'Accepted' }))
    await execute('update_incident', {
      advancedControlId: ID,
      incidentKey: 'incident-key',
      body: { Status: 'Accepted' },
    })
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      method: 'PATCH',
      address: { relativePath: path },
    })
    mocks.request.mockResolvedValue(
      page([
        record(`${path}/child/dynamicAttributes/attribute-key`, {
          Id: 'attribute-key',
          AttributeName: 'Amount',
          AttributeValue: '123.45',
        }),
      ])
    )
    const result = await execute('list_incident_attributes', {
      advancedControlId: ID,
      incidentKey: 'incident-key',
    })
    expect(result.output).toMatchObject({
      items: [{ AttributeName: 'Amount', AttributeValue: '123.45' }],
    })
  })

  it('submits simulation and retrieves status/results separately without provisioning', async () => {
    mocks.request.mockResolvedValue({ result: ID })
    const result = await execute('run_access_simulation', {
      userName: 'example-user',
      provisioningInfo: { EXAMPLE_ROLE: ['BUSINESS_UNIT = Example'] },
    })
    expect(result.output).toEqual({ requestId: ID })
    expect(mocks.request.mock.calls[0][1]).toMatchObject({
      method: 'POST',
      address: {
        relativePath: 'advancedControlsRolesProvisioning/action/runUserProvisioningAnalysis',
      },
    })
    mocks.request.mockResolvedValue({ result: 'Queued' })
    expect((await execute('get_access_simulation_status', { requestId: ID })).output).toEqual({
      status: 'Queued',
    })
    expect(serializeOracleFusionJsonBody(mocks.request.mock.calls[1][1].body)).toBe(
      `{"requestId":${ID}}`
    )
    mocks.request.mockResolvedValue(page([]))
    await execute('list_simulation_results', { requestId: ID })
    expect(mocks.request.mock.calls[2][1].query.finder).toBe(
      `getUserProvisioningAnalysisIncidents;requestId=${ID}`
    )
  })

  it.each([
    { items: [], count: 0, limit: 100, offset: 0, hasMore: true },
    { items: [], count: 1, limit: 100, offset: 0, hasMore: false },
    { items: [], count: 0, limit: 100, offset: 5, hasMore: false },
  ])('rejects malformed or mismatched collection pages', async (value) => {
    mocks.request.mockResolvedValue(value)
    await expect(execute('list_processes')).rejects.toThrow('collection')
  })

  it('rejects unsafe numeric IDs, unbounded pages and oversized inline children', async () => {
    await expect(execute('get_process', { processId: Number(ID) })).rejects.toThrow()
    await expect(execute('list_processes', { limit: 101 })).rejects.toThrow()
    await expect(execute('list_processes', { offset: 1_000_001 })).rejects.toThrow()
    expect(() =>
      riskWriteSchemas.update_process.parse({
        perspectives: Array.from({ length: 101 }, () => ({ PerspItemId: '4' })),
      })
    ).toThrow()
    const cyclic: Record<string, unknown> = {}
    cyclic.self = cyclic
    expect(() => parseRiskBody(cyclic)).toThrow('bounded')
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('does not retry a mutation with an uncertain provider outcome', async () => {
    mocks.request.mockRejectedValue(
      new OracleFusionProviderError('Oracle Fusion request timed out', 504)
    )
    await expect(execute('create_process', { body: { Name: 'Review' } })).rejects.toThrow()
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('forwards cancellation and stops before a pre-aborted request', async () => {
    const controller = new AbortController()
    mocks.request.mockResolvedValue(page([]))
    await execute('list_processes', {}, controller.signal)
    expect(mocks.request.mock.calls[0][2]).toBe(controller.signal)
    controller.abort()
    await expect(execute('list_processes', {}, controller.signal)).rejects.toThrow()
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it('enforces the Fusion credential family before provider execution', async () => {
    mocks.resolveAccount.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'other-service',
    })
    const response = await executeOracleFusionRiskManagementTool({
      toolId: 'oracle_fusion_risk_management_list_processes',
      input: AUTH,
      headers: new Headers(),
      context: { workflowId: 'workflow' },
      requestId: 'request',
    })
    expect(response.status).toBe(403)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('registers every declared action and projects only its declared inputs', () => {
    const tools = Object.values(riskTools)
    const registered = new Set(getRegisteredInternalToolOperationIds())
    expect(tools.map((tool) => tool.id).sort()).toEqual(Object.keys(RISK_OPERATIONS).sort())
    for (const tool of tools) {
      expect(registered.has(tool.id)).toBe(true)
      expect(tool.oauth).toMatchObject({
        credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
      const projected = tool.operation.input({
        ...AUTH,
        arbitraryUrl: 'https://example.com',
        body: { Name: 'unused' },
      })
      expect(projected).not.toHaveProperty('arbitraryUrl')
    }
  })
})
