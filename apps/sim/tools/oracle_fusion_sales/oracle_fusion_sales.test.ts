/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  secureFetch: vi.fn(),
  validateUrl: vi.fn(),
}))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetch,
  validateUrlWithDNS: mocks.validateUrl,
}))
vi.mock('@/components/icons', () => ({ NetSuiteIcon: () => null }))
vi.mock('@/lib/oauth/utils', () => ({ getScopesForService: () => [] }))

import { executeOracleFusionSalesTool } from '@/lib/internal/oracle-fusion-sales/execute-tool'
import { isInternalToolOperationRegistered } from '@/lib/internal/tool-operations/registry.server'
import { buildSelectorContextFromValues } from '@/lib/selectors/context'
import {
  buildCanonicalIndex,
  evaluateSubBlockCondition,
  resolveActiveCanonicalValue,
} from '@/lib/workflows/subblocks/visibility'
import {
  OracleFusionSalesBlock,
  OracleFusionSalesBlockMeta,
} from '@/blocks/blocks/oracle_fusion_sales'
import type { SubBlockConfig } from '@/blocks/types'
import toolMetadata from '@/tools/generated/tool-metadata'
import * as salesToolExports from '@/tools/oracle_fusion_sales'
import {
  oracleFusionSalesAcceptLeadTool,
  oracleFusionSalesCreateAccountTool,
  oracleFusionSalesCreateAppointmentTool,
  oracleFusionSalesDeleteAccountTool,
  oracleFusionSalesGetAccountTool,
  oracleFusionSalesGetLeadTool,
  oracleFusionSalesListOpportunityRevenueTool,
} from '@/tools/oracle_fusion_sales'
import {
  getOracleFusionSalesOperation,
  ORACLE_FUSION_SALES_OPERATIONS,
} from '@/tools/oracle_fusion_sales/shared'
import { hasToolId } from '@/tools/tool-ids'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const ROOT = `${ORIGIN}/crmRestApi/resources/11.13.18.05`
const BASIC = Buffer.from('integration-user:fixture-password').toString('base64')
const AUTH = { oauthCredential: 'credential-1', accessToken: BASIC, instanceUrl: ORIGIN }
const TOOLS = Object.values(salesToolExports) as InternalToolConfig[]

function providerResponse(status: number, body: string) {
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: '',
    headers: new Headers(),
    body: null,
    text: vi.fn(async () => body),
    json: vi.fn(async () => JSON.parse(body)),
    arrayBuffer: vi.fn(async () => new TextEncoder().encode(body).buffer),
  }
}

async function invoke(
  tool: InternalToolConfig,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const response = await executeOracleFusionSalesTool({
    toolId: tool.id,
    input: tool.operation.input({ ...AUTH, ...params }),
    headers: new Headers(),
    context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', userId: 'user-1' },
    requestId: 'request-1',
    signal,
  })
  return response.json()
}

function blockParam(toolId: string, param: string) {
  if (param !== 'statusCode') return param
  const operation = getOracleFusionSalesOperation(toolId.slice('oracle_fusion_sales_'.length))
  return `${operation.entity}StatusCode`
}

function conditionOperations(subBlock: SubBlockConfig): string[] {
  return TOOLS.filter((tool) =>
    evaluateSubBlockCondition(subBlock.condition, { operation: tool.id })
  ).map((tool) => tool.id)
}

describe('Oracle Fusion Sales integration', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.validateUrl.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: 'vision.fa.us2.oraclecloud.com',
    })
    mocks.secureFetch.mockResolvedValue(providerResponse(200, '{"result":"Successful"}'))
  })

  it('exposes the same 55 tools through the barrel, block, metadata, and internal registry', () => {
    const expected = Object.keys(ORACLE_FUSION_SALES_OPERATIONS)
      .map((name) => `oracle_fusion_sales_${name}`)
      .sort()
    expect(expected).toHaveLength(55)
    expect(TOOLS.map((tool) => tool.id).sort()).toEqual(expected)
    expect([...OracleFusionSalesBlock.tools.access].sort()).toEqual(expected)
    const options = OracleFusionSalesBlock.subBlocks.find(
      (field) => field.id === 'operation'
    )?.options
    if (!Array.isArray(options)) throw new Error('Expected operation options')
    expect(options.map((option) => String(option.id)).sort()).toEqual(expected)
    for (const tool of TOOLS) {
      expect(OracleFusionSalesBlock.tools.config.tool({ operation: tool.id })).toBe(tool.id)
      expect(isInternalToolOperationRegistered(tool.id), tool.id).toBe(true)
      expect(hasToolId(tool.id), tool.id).toBe(true)
      expect(toolMetadata[tool.id]?.id, tool.id).toBe(tool.id)
      expect(tool.oauth).toMatchObject({
        provider: 'oracle_fusion_sales',
        credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
    }
  })

  it('aligns active and required canvas controls with every tool input', () => {
    const problems: string[] = []
    for (const tool of TOOLS) {
      for (const [name, definition] of Object.entries(tool.params)) {
        if (definition.visibility === 'hidden') continue
        const param = blockParam(tool.id, name)
        const visible = OracleFusionSalesBlock.subBlocks.filter(
          (field) =>
            (field.canonicalParamId ?? field.id) === param &&
            conditionOperations(field).includes(tool.id)
        )
        if (!visible.length) problems.push(`${tool.id}: missing ${param}`)
        if (
          definition.required &&
          !visible.some(
            (field) =>
              field.required === true ||
              (typeof field.required === 'object' &&
                evaluateSubBlockCondition(field.required, { operation: tool.id }))
          )
        )
          problems.push(`${tool.id}: not required ${param}`)
        if (OracleFusionSalesBlock.inputs?.[param]?.type !== definition.type) {
          problems.push(`${tool.id}: wrong input type for ${param}`)
        }
      }
    }
    expect(problems).toEqual([])
  })

  it('keeps canonical pairs distinct, active, and consistent', () => {
    const block = OracleFusionSalesBlock
    const ids = block.subBlocks.map((field) => field.id)
    expect(new Set(ids).size).toBe(ids.length)
    const index = buildCanonicalIndex(block.subBlocks)
    for (const [canonicalId, group] of Object.entries(index.groupsById)) {
      expect(ids).not.toContain(canonicalId)
      expect(group.basicId).toBeTruthy()
      expect(group.advancedIds).toHaveLength(1)
      const members = block.subBlocks.filter((field) => field.canonicalParamId === canonicalId)
      expect(new Set(members.map((field) => JSON.stringify(field.condition))).size).toBe(1)
      expect(new Set(members.map((field) => JSON.stringify(field.required))).size).toBe(1)
    }
    const ownerGroup = index.groupsById.ownerId
    expect(
      resolveActiveCanonicalValue(
        ownerGroup,
        {
          ownerIdSelector: '123',
          ownerIdManual: '<upstream.ownerId>',
        },
        { ownerId: 'advanced' }
      )
    ).toBe('<upstream.ownerId>')
  })

  it('converts only resolved scalar values and keeps identifiers exact', () => {
    const config = OracleFusionSalesBlock.tools.config
    const params = {
      operation: 'oracle_fusion_sales_update_opportunity',
      oauthCredential: 'credential-1',
      opportunityNumber: 'O001',
      ownerId: '9007199254740993',
      opportunityStatusCode: 'TENANT_WON',
      revenue: '1250.5',
      winProbability: '100',
      accountNumber: 'inactive-account',
    }
    expect(config.tool({ ...params, revenue: '<upstream.amount>' })).toBe(params.operation)
    const mapped = config.params?.(params)
    expect(mapped).toMatchObject({
      opportunityNumber: 'O001',
      ownerId: '9007199254740993',
      statusCode: 'TENANT_WON',
      revenue: 1250.5,
      winProbability: 100,
    })
    expect(mapped).not.toHaveProperty('accountNumber')
    const tool = TOOLS.find((tool) => tool.id === params.operation)
    if (!tool) throw new Error('Missing tool')
    const input = tool.operation.input({
      ...params,
      ...mapped,
      _context: { workflowId: 'private' },
    })
    expect(input).not.toHaveProperty('_context')
    expect(input).not.toHaveProperty('opportunityStatusCode')
    expect(input).not.toHaveProperty('accountNumber')
  })

  it('projects selector dependencies from canonical active fields without destination overrides', () => {
    const context = buildSelectorContextFromValues({
      selectorKey: 'oracleFusionSales.salesStages',
      contextConfigs: OracleFusionSalesBlock.subBlocks,
      values: {
        operation: 'oracle_fusion_sales_create_opportunity',
        credential: '{{FUSION_CREDENTIAL}}',
        salesMethodIdSelector: '123',
        salesMethodIdManual: '456',
        instanceUrl: 'https://attacker.example',
      },
      canonicalModes: { salesMethodId: 'advanced' },
      dependsOn: ['oauthCredential', 'salesMethodId'],
    })
    expect(context).toEqual({ oauthCredential: '{{FUSION_CREDENTIAL}}', salesMethodId: '456' })
  })

  it('sends an exact action ID through the tool, handler, foundation serializer, and pinned transport', async () => {
    const signal = new AbortController().signal
    const result = await invoke(
      oracleFusionSalesAcceptLeadTool,
      {
        leadId: '9007199254740993',
      },
      signal
    )
    expect(result).toEqual({ success: true, output: { result: 'Successful' } })
    expect(mocks.secureFetch).toHaveBeenCalledTimes(1)
    const [url, ip, init] = mocks.secureFetch.mock.calls[0]
    expect(url).toBe(`${ROOT}/leads/action/acceptLead`)
    expect(ip).toBe('203.0.113.10')
    expect(init).toMatchObject({
      method: 'POST',
      body: '{"leadId":9007199254740993}',
      headers: {
        Authorization: `Basic ${BASIC}`,
        'REST-Framework-Version': '9',
        'Content-Type': 'application/vnd.oracle.adf.action+json',
      },
      maxRedirects: 0,
    })
  })

  it('preserves an unsafe JSON integer and a distinct framework-9 lead key across the entire response path', async () => {
    mocks.secureFetch.mockResolvedValue(
      providerResponse(
        200,
        `{"LeadId":9007199254740993,"LeadNumber":"L001","Name":"Inbound","@context":{"links":[{"rel":"self","href":"${ROOT}/leads/OPAQUE-KEY"}]}}`
      )
    )
    const result = await invoke(oracleFusionSalesGetLeadTool, { leadKey: 'OPAQUE-KEY' })
    expect(result.output.record).toMatchObject({
      LeadId: '9007199254740993',
      LeadNumber: 'L001',
      resourceKey: 'OPAQUE-KEY',
    })
    expect(mocks.secureFetch.mock.calls[0][0]).toBe(`${ROOT}/leads/OPAQUE-KEY`)
  })

  it.each([
    ['ACCOUNT/123', 'ACCOUNT%252F123'],
    ['ACCOUNT%2F123', 'ACCOUNT%25252F123'],
    ['A,123', 'A%252C123'],
  ])('keeps public number %s distinct from its encoded path', async (number, segment) => {
    mocks.secureFetch.mockResolvedValue(
      providerResponse(
        200,
        JSON.stringify({
          PartyId: 123,
          PartyNumber: number,
          OrganizationName: 'Example',
          '@context': { links: [{ rel: 'self', href: `${ROOT}/accounts/${segment}` }] },
        })
      )
    )
    const result = await invoke(oracleFusionSalesGetAccountTool, { accountNumber: number })
    expect(result.output.record?.PartyNumber).toBe(number)
    expect(mocks.secureFetch.mock.calls[0][0]).toBe(`${ROOT}/accounts/${segment}`)
  })

  it('encodes a public parent separately from an opaque child key', async () => {
    const collection = '/opportunities/OPP%252F123/child/ChildRevenue'
    mocks.secureFetch.mockResolvedValue(
      providerResponse(
        200,
        JSON.stringify({
          items: [
            {
              RevnId: 123,
              OptyNumber: 'OPP/123',
              '@context': { links: [{ rel: 'self', href: `${ROOT}${collection}/key%252Fpart` }] },
            },
          ],
          count: 1,
          limit: 50,
          offset: 0,
          hasMore: false,
        })
      )
    )
    const result = await invoke(oracleFusionSalesListOpportunityRevenueTool, {
      opportunityNumber: 'OPP/123',
    })
    expect(result.output.items?.[0]).toMatchObject({
      OptyNumber: 'OPP/123',
      resourceKey: 'key%2Fpart',
    })
    expect(mocks.secureFetch.mock.calls[0][0]).toContain(`${ROOT}${collection}?`)
  })

  it('writes framework-9 activity CLOB text without legacy Base64 encoding', async () => {
    mocks.secureFetch.mockResolvedValue(
      providerResponse(
        201,
        JSON.stringify({
          ActivityId: 123,
          ActivityNumber: 'ACT001',
          Subject: 'Review',
          '@context': { links: [{ rel: 'self', href: `${ROOT}/activities/ACT001` }] },
        })
      )
    )
    const result = await invoke(oracleFusionSalesCreateAppointmentTool, {
      subject: 'Review',
      startDateTime: '2026-09-01T12:00:00Z',
      endDateTime: '2026-09-01T13:00:00Z',
      description: 'Discuss renewal',
    })
    expect(result.success).toBe(true)
    expect(JSON.parse(mocks.secureFetch.mock.calls[0][2].body)).toMatchObject({
      ActivityFunctionCode: 'APPOINTMENT',
      ActivityDescription: 'Discuss renewal',
    })
  })

  it('consumes a real no-content delete response without parsing JSON', async () => {
    const response = providerResponse(204, '')
    mocks.secureFetch.mockResolvedValue(response)
    expect(
      await invoke(oracleFusionSalesDeleteAccountTool, {
        accountNumber: 'A001',
      })
    ).toEqual({ success: true, output: { deleted: true } })
    expect(response.json).not.toHaveBeenCalled()
    expect(response.text).not.toHaveBeenCalled()
  })

  it('fails required validation before DNS or network access', async () => {
    const result = await invoke(oracleFusionSalesCreateAccountTool, { organizationName: '' })
    expect(result.success).toBe(false)
    expect(mocks.validateUrl).not.toHaveBeenCalled()
    expect(mocks.secureFetch).not.toHaveBeenCalled()
  })

  it('includes read-first defaults, operation-specific canvas sentences, and grounded workflows', () => {
    const operation = OracleFusionSalesBlock.subBlocks.find((field) => field.id === 'operation')
    expect(operation?.value?.({})).toBe('oracle_fusion_sales_list_accounts')
    expect(
      Object.keys(OracleFusionSalesBlock.canvasPresentation?.sentences?.byOperation ?? {}).sort()
    ).toEqual(TOOLS.map((tool) => tool.id).sort())
    for (const tool of TOOLS.filter((tool) => tool.id.startsWith('oracle_fusion_sales_list_'))) {
      const sentence = OracleFusionSalesBlock.canvasPresentation?.sentences?.byOperation?.[tool.id]
      expect(sentence?.[0]).toMatch(/^List /)
      expect(sentence).toContainEqual({
        text: ', up to',
        field: 'limit',
        after: 'records',
      })
    }
    expect(OracleFusionSalesBlockMeta.templates.length).toBeGreaterThanOrEqual(7)
    expect(
      OracleFusionSalesBlockMeta.skills.every((skill) =>
        skill.content.includes('https://docs.oracle.com/')
      )
    ).toBe(true)
  })
})
