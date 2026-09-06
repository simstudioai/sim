/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ secureFetch: vi.fn(), validateUrl: vi.fn() }))
vi.mock('@/lib/core/security/input-validation.server', () => ({
  secureFetchWithPinnedIP: mocks.secureFetch,
  validateUrlWithDNS: mocks.validateUrl,
}))
vi.mock('@/components/icons', () => ({ NetSuiteIcon: () => null }))
vi.mock('@/lib/oauth/utils', () => ({ getScopesForService: () => [] }))

import { executeOracleFusionSubscriptionTool } from '@/lib/internal/oracle-fusion-subscription-management/execute-tool'
import { isInternalToolOperationRegistered } from '@/lib/internal/tool-operations/registry.server'
import { OracleFusionSubscriptionManagementBlock } from '@/blocks/blocks/oracle_fusion_subscription_management'
import toolMetadata from '@/tools/generated/tool-metadata'
import * as subscriptionTools from '@/tools/oracle_fusion_subscription_management'
import {
  oracleFusionSubscriptionActivateSubscriptionTool,
  oracleFusionSubscriptionDeleteSubscriptionTool,
  oracleFusionSubscriptionGetSubscriptionTool,
  oracleFusionSubscriptionUpdateSubscriptionTool,
} from '@/tools/oracle_fusion_subscription_management'
import { ORACLE_FUSION_SUBSCRIPTION_OPERATIONS } from '@/tools/oracle_fusion_subscription_management/shared'
import { hasToolId } from '@/tools/tool-ids'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

const TOOLS = Object.values(subscriptionTools) as InternalToolConfig[]
const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const ROOT = `${ORIGIN}/crmRestApi/resources/11.13.18.05`
const BASIC = Buffer.from('integration-user:fixture-password').toString('base64')
const AUTH = { oauthCredential: 'credential-1', accessToken: BASIC, instanceUrl: ORIGIN }

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
  params: Record<string, unknown>
): Promise<ToolResponse> {
  const response = await executeOracleFusionSubscriptionTool({
    toolId: tool.id,
    input: tool.operation.input({ ...AUTH, ...params }),
    headers: new Headers(),
    context: { workflowId: 'workflow-1', workspaceId: 'workspace-1', userId: 'user-1' },
    requestId: 'request-1',
  })
  return response.json()
}

describe('Subscription Management integration boundaries', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.validateUrl.mockResolvedValue({
      isValid: true,
      resolvedIP: '203.0.113.10',
      originalHostname: 'vision.fa.us2.oraclecloud.com',
    })
    mocks.secureFetch.mockResolvedValue(providerResponse(200, '{"result":"Successful"}'))
  })

  it('registers the agreed 61 internal tools, block operations, and generated metadata', () => {
    const expected = Object.keys(ORACLE_FUSION_SUBSCRIPTION_OPERATIONS)
      .map((name) => `oracle_fusion_subscription_management_${name}`)
      .sort()
    expect(expected).toHaveLength(61)
    expect(TOOLS.map((tool) => tool.id).sort()).toEqual(expected)
    expect([...OracleFusionSubscriptionManagementBlock.tools.access].sort()).toEqual(expected)
    expect(
      Object.keys(
        OracleFusionSubscriptionManagementBlock.canvasPresentation?.sentences?.byOperation ?? {}
      ).sort()
    ).toEqual(expected)
    for (const tool of TOOLS) {
      expect(isInternalToolOperationRegistered(tool.id), tool.id).toBe(true)
      expect(hasToolId(tool.id), tool.id).toBe(true)
      expect(toolMetadata[tool.id]?.id, tool.id).toBe(tool.id)
      expect(tool.oauth).toMatchObject({
        provider: 'oracle_fusion_subscription_management',
        credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
      expect(tool.params.oauthCredential).toMatchObject({ visibility: 'user-only', required: true })
      expect(tool.params.accessToken.visibility).toBe('hidden')
      expect(tool.params.instanceUrl.visibility).toBe('hidden')
    }
  })

  it('sends flat lifecycle bodies through the real foundation CRM client and pinned transport', async () => {
    expect(
      await invoke(oracleFusionSubscriptionActivateSubscriptionTool, {
        subscriptionNumber: 'SUB-001',
        ignoreWarnings: 'Y',
        staleDescription: 'unused',
      })
    ).toEqual({ success: true, output: { result: 'Successful' } })
    expect(mocks.secureFetch).toHaveBeenCalledTimes(1)
    expect(mocks.secureFetch.mock.calls[0]).toMatchObject([
      `${ROOT}/subscriptions/SUB-001/action/activate`,
      '203.0.113.10',
      {
        method: 'POST',
        body: '{"ignoreWarnings":"Y"}',
        headers: {
          Authorization: `Basic ${BASIC}`,
          'REST-Framework-Version': '9',
          'Content-Type': 'application/vnd.oracle.adf.action+json',
        },
        maxRedirects: 0,
      },
    ])
  })

  it('preserves unsafe provider integers and exact body identifiers across the entire transport', async () => {
    const responseBody =
      '{"SubscriptionId":9007199254740993,"SubscriptionNumber":"SUB-001",' +
      '"@context":{"links":[{"rel":"self","href":"' +
      ROOT +
      '/subscriptions/SUB-001"}]}}'
    mocks.secureFetch.mockResolvedValue(providerResponse(200, responseBody))
    const read = await invoke(oracleFusionSubscriptionGetSubscriptionTool, {
      subscriptionNumber: 'SUB-001',
    })
    expect(read.output.record).toMatchObject({ SubscriptionId: '9007199254740993' })
    const updated = await invoke(oracleFusionSubscriptionUpdateSubscriptionTool, {
      subscriptionNumber: 'SUB-001',
      billToAccountId: '9007199254740995',
      accountingRuleId: '-2',
    })
    expect(updated.success).toBe(true)
    expect(mocks.secureFetch.mock.calls[1][2].body).toBe(
      '{"BillToAccountId":9007199254740995,"AccountingRuleId":-2}'
    )
  })

  it('consumes no-content deletes and leaves mutation throttling nonretryable', async () => {
    const empty = providerResponse(204, '')
    mocks.secureFetch.mockResolvedValue(empty)
    expect(
      await invoke(oracleFusionSubscriptionDeleteSubscriptionTool, {
        subscriptionNumber: 'SUB-001',
      })
    ).toEqual({ success: true, output: { deleted: true } })
    expect(empty.text).not.toHaveBeenCalled()
    mocks.secureFetch.mockClear()
    mocks.secureFetch.mockResolvedValue(providerResponse(429, '{}'))
    expect(
      await invoke(oracleFusionSubscriptionActivateSubscriptionTool, {
        subscriptionNumber: 'SUB-001',
      })
    ).toMatchObject({ success: false, retryable: false })
    expect(mocks.secureFetch).toHaveBeenCalledTimes(1)
  })

  it('declares distinct projected record, page, deletion, and action outputs', () => {
    for (const tool of TOOLS) {
      const name = tool.id.slice('oracle_fusion_subscription_management_'.length)
      const operation = ORACLE_FUSION_SUBSCRIPTION_OPERATIONS[name]
      const keys = Object.keys(tool.outputs ?? {})
      if (operation.kind === 'action') expect(keys).toEqual(['result'])
      else if (operation.kind === 'delete') expect(keys).toEqual(['deleted'])
      else if (operation.kind === 'list') {
        expect(keys).toContain('items')
        expect(keys).toContain('nextOffset')
        expect(tool.outputs?.items).toMatchObject({ type: 'array' })
      } else {
        expect(keys).toEqual(['record'])
        expect(tool.outputs?.record).toMatchObject({ type: 'json', properties: expect.any(Object) })
      }
    }
  })
})
