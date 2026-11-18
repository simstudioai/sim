/**
 * @vitest-environment node
 */
import { permissionGroupScopeMock, permissionGroupScopeMockFns } from '@sim/testing'
import { createSessionPrincipal } from '@sim/testing/factories/principal.factory'
import { apiKeyByokMock, apiKeyByokMockFns } from '@sim/testing/mocks/api-key-byok.mock'
import {
  billingAttributionMock,
  billingAttributionMockFns,
} from '@sim/testing/mocks/billing-attribution.mock'
import { workspaceAuthzMock, workspaceAuthzMockFns } from '@sim/testing/mocks/workspace-authz.mock'
import { workspaceContextMock } from '@sim/testing/mocks/workspace-context.mock'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockScopedOutboundFetch, mockEnrichTableSchema } = vi.hoisted(() => ({
  mockScopedOutboundFetch: vi.fn(),
  mockEnrichTableSchema: vi.fn(),
}))

vi.mock('@sim/platform-authz/workspace', () => workspaceAuthzMock)
vi.mock('@/lib/permission-groups/config-scope.server', () => permissionGroupScopeMock)
vi.mock('@/lib/workspaces/application/context', () => workspaceContextMock)
vi.mock('@/lib/billing/core/attribution', () => billingAttributionMock)
vi.mock('@/lib/api-key/byok', () => apiKeyByokMock)
vi.mock('@/lib/core/network/outbound-fetch.server', () => ({
  scopedOutboundFetch: mockScopedOutboundFetch,
}))
vi.mock('@/lib/table/llm/wand', () => ({ enrichTableSchema: mockEnrichTableSchema }))

import { DEFAULT_PERMISSION_GROUP_CONFIG } from '@/lib/permission-groups/fields'
import { generateWandInWorkspace } from '@/lib/wand/application/generate'

const TABLE_SCHEMA = 'Table schema for orders:\n- secret_margin (number)'

function generate() {
  return generateWandInWorkspace.execute({
    principal: createSessionPrincipal(),
    input: {
      workspaceId: 'workspace-1',
      prompt: 'Filter to big orders',
      stream: false,
      history: [],
      generationType: 'table-schema',
      wandContext: { tableId: 'table-1' },
      requestId: 'request-1',
    },
  })
}

function systemPromptSent(): string {
  const [, init] = mockScopedOutboundFetch.mock.calls[0]
  return JSON.parse(String(init.body)).input[0].content
}

describe('generateWandInWorkspace table-schema context', () => {
  beforeEach(() => {
    workspaceAuthzMockFns.mockResolveEffectiveWorkspacePermission.mockResolvedValue('read')
    apiKeyByokMockFns.mockGetBYOKKey.mockResolvedValue({ apiKey: 'sk-byok' })
    billingAttributionMockFns.mockResolveBillingAttribution.mockResolvedValue({})
    billingAttributionMockFns.mockCheckAttributedBillingBlocks.mockResolvedValue({ blocked: false })
    mockEnrichTableSchema.mockResolvedValue(TABLE_SCHEMA)
    mockScopedOutboundFetch.mockResolvedValue(
      Response.json({
        output: [{ type: 'message', content: [{ type: 'output_text', text: 'amount > 100' }] }],
      })
    )
  })

  it('includes the table schema for a member whose group allows tables', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue(null)

    await generate()

    expect(systemPromptSent()).toContain('secret_margin')
  })

  it('omits the table schema for a member whose group withholds tables', async () => {
    permissionGroupScopeMockFns.mockResolvePermissionGroupConfig.mockResolvedValue({
      ...DEFAULT_PERMISSION_GROUP_CONFIG,
      hideTablesTab: true,
    })

    await generate()

    expect(systemPromptSent()).not.toContain('secret_margin')
  })
})
