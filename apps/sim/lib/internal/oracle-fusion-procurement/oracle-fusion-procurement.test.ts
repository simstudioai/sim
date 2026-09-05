/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { NetSuiteIcon } from '@/components/icons'
import type { OracleFusionRequest } from '@/lib/internal/oracle-fusion/client'
import { OracleFusionProviderError } from '@/lib/internal/oracle-fusion/errors'
import { serializeOracleFusionJsonBody } from '@/lib/internal/oracle-fusion/request-body'
import { executeOracleFusionProcurementTool } from '@/lib/internal/oracle-fusion-procurement/execute-tool'
import { executeProcurementOperation } from '@/lib/internal/oracle-fusion-procurement/operations'
import {
  getInternalToolOperationHandler,
  getRegisteredInternalToolOperationIds,
} from '@/lib/internal/tool-operations/registry.server'
import { buildCanonicalIndex, evaluateSubBlockCondition } from '@/lib/workflows/subblocks/visibility'
import {
  OracleFusionProcurementBlock,
  OracleFusionProcurementBlockMeta,
} from '@/blocks/blocks/oracle_fusion_procurement'
import toolMetadata from '@/tools/generated/tool-metadata'
import * as procurementTools from '@/tools/oracle_fusion_procurement'
import { hasToolId } from '@/tools/tool-ids'
import type { InternalToolConfig, ToolResponse } from '@/tools/types'

const mocks = vi.hoisted(() => ({
  request: vi.fn(),
  resolveAccount: vi.fn(),
}))

vi.mock('@/lib/internal/oracle-fusion/client', () => ({
  requestOracleFusionJson: mocks.request,
}))
vi.mock('@/lib/oauth/credential-service', () => ({
  resolveOAuthAccountId: mocks.resolveAccount,
}))

const ORIGIN = 'https://vision.fa.us2.oraclecloud.com'
const ROOT = '/fscmRestApi/resources/11.13.18.05/'
const ID = '9007199254740993'
const KEY = '00020000ABCD'
const AUTH = {
  oauthCredential: 'fusion-credential',
  instanceUrl: ORIGIN,
  accessToken: 'dXNlcjpwYXNz',
}

const fixtureFields: Record<string, Record<string, unknown>> = {
  suppliers: { SupplierId: ID, Supplier: 'Acme', SupplierNumber: 'S100', SupplierPartyId: ID },
  supplierSites: { SupplierSiteId: ID, SupplierSite: 'Headquarters', ProcurementBUId: ID },
  purchaseRequisitions: { RequisitionHeaderId: ID, Requisition: 'REQ100', Description: null },
  purchaseRequisitionLines: { RequisitionLineId: ID, RequisitionHeaderId: ID, LineNumber: 1 },
  draftPurchaseOrders: { POHeaderId: ID, OrderNumber: 'PO100', VersionId: ID, Status: 'Incomplete' },
  draftPurchaseOrderLines: { POLineId: ID, POHeaderId: ID, LineNumber: 1, Quantity: 0 },
  purchaseOrders: { POHeaderId: ID, OrderNumber: 'PO100', FrozenFlag: false },
  purchaseOrderLines: { POLineId: ID, POHeaderId: ID, LineNumber: 1, Quantity: 0 },
  purchaseOrderLifecycleDetails: { POHeaderId: ID, OrderNumber: 'PO100', DeliveredAmount: 0 },
  purchaseOrderReceipts: { ReceiptId: ID, POHeaderId: ID, Receipt: 'RCV100', ReceivedQuantity: 0 },
  supplierNegotiations: { AuctionHeaderId: ID, Negotiation: 'N100', NegotiationTitle: 'Equipment' },
  supplierNegotiationResponses: {
    ResponseNumber: ID, AuctionHeaderId: ID, ResponseAmount: '1200.00', ResponseStatus: 'Active',
  },
  procurementAgents: { AssignmentId: ID, AgentId: ID, Agent: 'Buyer', ManageOrdersAllowedFlag: false },
}

const projectedFixtureFields = {
  ...fixtureFields,
  purchaseRequisitionLines: { ...fixtureFields.purchaseRequisitionLines, LineNumber: '1' },
  draftPurchaseOrderLines: { ...fixtureFields.draftPurchaseOrderLines, LineNumber: '1', Quantity: '0' },
  purchaseOrderLines: { ...fixtureFields.purchaseOrderLines, LineNumber: '1', Quantity: '0' },
  purchaseOrderLifecycleDetails: { ...fixtureFields.purchaseOrderLifecycleDetails, DeliveredAmount: '0' },
  purchaseOrderReceipts: { ...fixtureFields.purchaseOrderReceipts, ReceivedQuantity: '0' },
} satisfies Record<string, Record<string, unknown>>

interface ContractCase {
  slug: string
  method: 'GET' | 'POST' | 'PATCH'
  path: string
  kind: 'list' | 'detail' | 'create' | 'update' | 'action'
  resource?: string
  wrapper?: string
  actionKind?: string
  params: Record<string, unknown>
}

// Independent endpoint/verb matrix checked against the official 26C operation pages.
const CONTRACTS: ContractCase[] = [
  {
    slug: 'create_draft_purchase_order',
    method: 'POST',
    path: `draftPurchaseOrders`,
    kind: 'create',
    resource: 'draftPurchaseOrders',
    wrapper: 'draftPurchaseOrder',
    params: {
      buyerId: ID,
      documentStyleId: ID,
      procurementBUId: ID,
      supplierId: ID,
      supplierSiteId: ID,
    },
  },
  {
    slug: 'create_purchase_requisition',
    method: 'POST',
    path: `purchaseRequisitions`,
    kind: 'create',
    resource: 'purchaseRequisitions',
    wrapper: 'purchaseRequisition',
    params: {
      preparerId: ID,
      requisitioningBUId: ID,
    },
  },
  {
    slug: 'create_supplier',
    method: 'POST',
    path: `suppliers`,
    kind: 'create',
    resource: 'suppliers',
    wrapper: 'supplier',
    params: {
      supplierName: "Example",
    },
  },
  {
    slug: 'create_supplier_negotiation',
    method: 'POST',
    path: `supplierNegotiations`,
    kind: 'create',
    resource: 'supplierNegotiations',
    wrapper: 'supplierNegotiation',
    params: {
      procurementBUId: ID,
      negotiationTitle: "Example",
    },
  },
  {
    slug: 'create_supplier_site',
    method: 'POST',
    path: `suppliers/${ID}/child/sites`,
    kind: 'create',
    resource: 'supplierSites',
    wrapper: 'supplierSite',
    params: {
      supplierId: ID,
      procurementBUId: ID,
      supplierSiteName: "Example",
      supplierAddressId: ID,
    },
  },
  {
    slug: 'get_draft_purchase_order',
    method: 'GET',
    path: `draftPurchaseOrders/${KEY}`,
    kind: 'detail',
    resource: 'draftPurchaseOrders',
    wrapper: 'draftPurchaseOrder',
    params: {
      draftPurchaseOrderKey: KEY,
    },
  },
  {
    slug: 'get_procurement_agent',
    method: 'GET',
    path: `procurementAgents/${ID}`,
    kind: 'detail',
    resource: 'procurementAgents',
    wrapper: 'procurementAgent',
    params: {
      assignmentId: ID,
    },
  },
  {
    slug: 'get_purchase_order',
    method: 'GET',
    path: `purchaseOrders/${KEY}`,
    kind: 'detail',
    resource: 'purchaseOrders',
    wrapper: 'purchaseOrder',
    params: {
      purchaseOrderKey: KEY,
    },
  },
  {
    slug: 'get_purchase_order_lifecycle_details',
    method: 'GET',
    path: `purchaseOrderLifeCycleDetails/${ID}`,
    kind: 'detail',
    resource: 'purchaseOrderLifecycleDetails',
    wrapper: 'lifecycleDetails',
    params: {
      poHeaderId: ID,
    },
  },
  {
    slug: 'get_purchase_order_receipt',
    method: 'GET',
    path: `purchaseOrderLifeCycleDetails/${ID}/child/receipts/${KEY}`,
    kind: 'detail',
    resource: 'purchaseOrderReceipts',
    wrapper: 'purchaseOrderReceipt',
    params: {
      poHeaderId: ID,
      receiptKey: KEY,
    },
  },
  {
    slug: 'get_purchase_requisition',
    method: 'GET',
    path: `purchaseRequisitions/${KEY}`,
    kind: 'detail',
    resource: 'purchaseRequisitions',
    wrapper: 'purchaseRequisition',
    params: {
      requisitionKey: KEY,
    },
  },
  {
    slug: 'get_supplier',
    method: 'GET',
    path: `suppliers/${ID}`,
    kind: 'detail',
    resource: 'suppliers',
    wrapper: 'supplier',
    params: {
      supplierId: ID,
    },
  },
  {
    slug: 'get_supplier_negotiation',
    method: 'GET',
    path: `supplierNegotiations/${KEY}`,
    kind: 'detail',
    resource: 'supplierNegotiations',
    wrapper: 'supplierNegotiation',
    params: {
      negotiationKey: KEY,
    },
  },
  {
    slug: 'get_supplier_negotiation_response',
    method: 'GET',
    path: `supplierNegotiationResponses/${KEY}`,
    kind: 'detail',
    resource: 'supplierNegotiationResponses',
    wrapper: 'supplierNegotiationResponse',
    params: {
      responseKey: KEY,
    },
  },
  {
    slug: 'get_supplier_site',
    method: 'GET',
    path: `suppliers/${ID}/child/sites/${ID}`,
    kind: 'detail',
    resource: 'supplierSites',
    wrapper: 'supplierSite',
    params: {
      supplierId: ID,
      supplierSiteId: ID,
    },
  },
  {
    slug: 'hold_purchase_order',
    method: 'POST',
    path: `purchaseOrders/${KEY}/action/hold`,
    kind: 'action',
    actionKind: 'string',
    params: {
      purchaseOrderKey: KEY,
    },
  },
  {
    slug: 'list_draft_purchase_order_lines',
    method: 'GET',
    path: `draftPurchaseOrders/${KEY}/child/lines`,
    kind: 'list',
    resource: 'draftPurchaseOrderLines',
    params: {
      draftPurchaseOrderKey: KEY,
    },
  },
  {
    slug: 'list_draft_purchase_orders',
    method: 'GET',
    path: `draftPurchaseOrders`,
    kind: 'list',
    resource: 'draftPurchaseOrders',
    params: {

    },
  },
  {
    slug: 'list_procurement_agents',
    method: 'GET',
    path: `procurementAgents`,
    kind: 'list',
    resource: 'procurementAgents',
    params: {

    },
  },
  {
    slug: 'list_purchase_order_lines',
    method: 'GET',
    path: `purchaseOrders/${KEY}/child/lines`,
    kind: 'list',
    resource: 'purchaseOrderLines',
    params: {
      purchaseOrderKey: KEY,
    },
  },
  {
    slug: 'list_purchase_order_receipts',
    method: 'GET',
    path: `purchaseOrderLifeCycleDetails/${ID}/child/receipts`,
    kind: 'list',
    resource: 'purchaseOrderReceipts',
    params: {
      poHeaderId: ID,
    },
  },
  {
    slug: 'list_purchase_orders',
    method: 'GET',
    path: `purchaseOrders`,
    kind: 'list',
    resource: 'purchaseOrders',
    params: {

    },
  },
  {
    slug: 'list_purchase_requisition_lines',
    method: 'GET',
    path: `purchaseRequisitions/${KEY}/child/lines`,
    kind: 'list',
    resource: 'purchaseRequisitionLines',
    params: {
      requisitionKey: KEY,
    },
  },
  {
    slug: 'list_purchase_requisitions',
    method: 'GET',
    path: `purchaseRequisitions`,
    kind: 'list',
    resource: 'purchaseRequisitions',
    params: {

    },
  },
  {
    slug: 'list_supplier_negotiation_responses',
    method: 'GET',
    path: `supplierNegotiationResponses`,
    kind: 'list',
    resource: 'supplierNegotiationResponses',
    params: {

    },
  },
  {
    slug: 'list_supplier_negotiations',
    method: 'GET',
    path: `supplierNegotiations`,
    kind: 'list',
    resource: 'supplierNegotiations',
    params: {

    },
  },
  {
    slug: 'list_supplier_sites',
    method: 'GET',
    path: `suppliers/${ID}/child/sites`,
    kind: 'list',
    resource: 'supplierSites',
    params: {
      supplierId: ID,
    },
  },
  {
    slug: 'list_suppliers',
    method: 'GET',
    path: `suppliers`,
    kind: 'list',
    resource: 'suppliers',
    params: {

    },
  },
  {
    slug: 'remove_purchase_order_hold',
    method: 'POST',
    path: `purchaseOrders/${KEY}/action/removeHold`,
    kind: 'action',
    actionKind: 'string',
    params: {
      purchaseOrderKey: KEY,
    },
  },
  {
    slug: 'submit_draft_purchase_order',
    method: 'POST',
    path: `draftPurchaseOrders/${KEY}/action/submit`,
    kind: 'action',
    actionKind: 'string',
    params: {
      draftPurchaseOrderKey: KEY,
    },
  },
  {
    slug: 'submit_purchase_requisition',
    method: 'POST',
    path: `purchaseRequisitions/${KEY}/action/submitRequisition`,
    kind: 'action',
    actionKind: 'string',
    params: {
      requisitionKey: KEY,
    },
  },
  {
    slug: 'update_draft_purchase_order',
    method: 'PATCH',
    path: `draftPurchaseOrders/${KEY}`,
    kind: 'update',
    resource: 'draftPurchaseOrders',
    wrapper: 'draftPurchaseOrder',
    params: {
      draftPurchaseOrderKey: KEY,
      body: { Description: 'Updated' },
    },
  },
  {
    slug: 'update_purchase_requisition',
    method: 'PATCH',
    path: `purchaseRequisitions/${KEY}`,
    kind: 'update',
    resource: 'purchaseRequisitions',
    wrapper: 'purchaseRequisition',
    params: {
      requisitionKey: KEY,
      body: { Description: 'Updated' },
    },
  },
  {
    slug: 'update_supplier',
    method: 'PATCH',
    path: `suppliers/${ID}`,
    kind: 'update',
    resource: 'suppliers',
    wrapper: 'supplier',
    params: {
      supplierId: ID,
      body: { Supplier: 'Updated' },
    },
  },
  {
    slug: 'update_supplier_negotiation',
    method: 'PATCH',
    path: `supplierNegotiations/${KEY}`,
    kind: 'update',
    resource: 'supplierNegotiations',
    wrapper: 'supplierNegotiation',
    params: {
      negotiationKey: KEY,
      body: { NegotiationTitle: 'Updated' },
    },
  },
  {
    slug: 'update_supplier_site',
    method: 'PATCH',
    path: `suppliers/${ID}/child/sites/${ID}`,
    kind: 'update',
    resource: 'supplierSites',
    wrapper: 'supplierSite',
    params: {
      supplierId: ID,
      supplierSiteId: ID,
      body: { SupplierSite: 'Updated' },
    },
  },
  {
    slug: 'validate_draft_purchase_order',
    method: 'POST',
    path: `draftPurchaseOrders/${KEY}/action/validateDocument`,
    kind: 'action',
    actionKind: 'validation',
    params: {
      draftPurchaseOrderKey: KEY,
    },
  },
  {
    slug: 'validate_or_publish_supplier_negotiation',
    method: 'POST',
    path: `supplierNegotiations/${KEY}/action/ValidateAndPublishNegotiation`,
    kind: 'action',
    actionKind: 'negotiation',
    params: {
      negotiationKey: KEY,
      actionIntent: 'Validate',
    },
  },
  {
    slug: 'withdraw_purchase_requisition',
    method: 'POST',
    path: `purchaseRequisitions/${KEY}/action/withdraw`,
    kind: 'action',
    actionKind: 'withdraw',
    params: {
      requisitionKey: KEY,
    },
  },
]

function resourceItem(resource: string, path: string, contextVersion = true) {
  const links = [{ rel: 'self', href: ORIGIN + ROOT + path }]
  return {
    ...fixtureFields[resource],
    ...(contextVersion ? { '@context': { key: 'not-authoritative', links } } : { links }),
    providerSecret: 'must-not-be-projected',
    TaxpayerId: 'not-a-procurement-output',
  }
}

function page(items: unknown[], offset = 0, hasMore = false) {
  return { items, count: items.length, limit: 100, offset, hasMore }
}

function responseFor(testCase: ContractCase): unknown {
  if (testCase.kind === 'action') {
    if (testCase.actionKind === 'withdraw') return { result: { STATUS: [{ CODE: 'SUCCESS' }] } }
    if (testCase.actionKind === 'validation') return { result: [] }
    if (testCase.actionKind === 'negotiation') {
      return { result: { Status: 'SUCCESS', Message: 'Validated', Negotiation: 43653, ErrorsListId: null } }
    }
    return { result: 'SUCCESS' }
  }
  const opaque = [
    'purchaseRequisitions', 'draftPurchaseOrders', 'purchaseOrders',
    'purchaseOrderReceipts', 'supplierNegotiations', 'supplierNegotiationResponses',
  ].includes(testCase.resource!)
  const itemPath = testCase.kind === 'list' || testCase.kind === 'create'
    ? `${testCase.path}/${opaque ? KEY : ID}` : testCase.path
  const item = resourceItem(testCase.resource!, itemPath)
  return testCase.kind === 'list' ? page([item]) : item
}

const toolById = new Map(Object.values(procurementTools).map((tool) => [tool.id, tool]))

async function invoke(slug: string, params: Record<string, unknown> = {}, signal?: AbortSignal) {
  const tool = toolById.get(`oracle_fusion_procurement_${slug}`)!
  const input = tool.operation.input({ ...AUTH, ...params })
  const response = await executeOracleFusionProcurementTool({
    toolId: tool.id,
    input,
    headers: new Headers(),
    context: { userId: 'user', workspaceId: 'workspace', workflowId: 'workflow' },
    requestId: 'request',
    signal,
  })
  return { status: response.status, result: await response.json() as ToolResponse }
}

function mappedBlockInputs(params: Record<string, unknown>) {
  return { ...params, ...OracleFusionProcurementBlock.tools.config.params!(params) }
}

describe('Oracle Fusion Procurement integration contracts', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mocks.resolveAccount.mockResolvedValue({
      credentialType: 'service_account',
      providerId: 'oracle-fusion-service-account',
    })
  })

  it.each(CONTRACTS)('$slug uses the documented method, resource and response contract', async (contract) => {
    mocks.request.mockResolvedValue(responseFor(contract))
    const controller = new AbortController()
    const { status, result } = await invoke(contract.slug, contract.params, controller.signal)
    expect(status).toBe(200)
    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(mocks.request).toHaveBeenCalledTimes(1)
    const [credential, request, signal] = mocks.request.mock.calls[0] as [
      typeof AUTH, OracleFusionRequest, AbortSignal,
    ]
    expect(credential).toEqual({ instanceUrl: ORIGIN, accessToken: AUTH.accessToken })
    expect(signal).toBe(controller.signal)
    expect(request.method).toBe(contract.method)
    expect(request.address).toEqual({ family: 'fscm', relativePath: contract.path })
    if (contract.method !== 'GET') {
      expect(request.mediaType).toBe(contract.kind === 'action'
        ? 'application/vnd.oracle.adf.action+json'
        : 'application/vnd.oracle.adf.resourceitem+json')
      expect(serializeOracleFusionJsonBody(request.body)).not.toContain('[object Object]')
    } else {
      expect(request).not.toHaveProperty('body')
      expect(request.query?.fields).toBeTruthy()
      expect(request.query).not.toHaveProperty('onlyData')
    }
    if (contract.kind === 'list') {
      expect(request.query).toMatchObject({ limit: 100, offset: 0 })
      expect(result.output).toMatchObject({ count: 1, hasMore: false, offset: 0 })
      expect(result.output).not.toHaveProperty('nextOffset')
      expect(result.output.items[0]).toMatchObject(projectedFixtureFields[contract.resource!])
    } else if (contract.wrapper) {
      expect(result.output[contract.wrapper]).toMatchObject(projectedFixtureFields[contract.resource!])
    }
    expect(JSON.stringify(result)).not.toContain('must-not-be-projected')
    expect(JSON.stringify(result)).not.toContain('TaxpayerId')
    expect(JSON.stringify(result)).not.toContain('@context')
  })

  it.each([
    {
      slug: 'create_purchase_requisition',
      expected: `{"PreparerId":${ID},"RequisitioningBUId":${ID}}`,
    },
    {
      slug: 'create_supplier',
      expected: '{"Supplier":"Example"}',
    },
    {
      slug: 'create_supplier_site',
      expected: `{"ProcurementBUId":${ID},"SupplierSite":"Example","SupplierAddressId":${ID}}`,
    },
    {
      slug: 'create_supplier_negotiation',
      expected: `{"ProcurementBUId":${ID},"NegotiationTitle":"Example"}`,
    },
  ])('$slug maps required public inputs into the exact documented JSON body', async (testCase) => {
    const contract = CONTRACTS.find((entry) => entry.slug === testCase.slug)!
    mocks.request.mockResolvedValue(responseFor(contract))
    const { result } = await invoke(contract.slug, contract.params)
    expect(result.success).toBe(true)
    expect(serializeOracleFusionJsonBody(mocks.request.mock.calls[0][1].body)).toBe(testCase.expected)
  })

  it('preserves exact nested request integers and false/zero without changing the caller body', async () => {
    const body = {
      SupplierId: '123',
      Description: 'Purchase',
      lines: [{ LineNumber: 1, LineTypeId: ID, Quantity: 0, Price: 0 }],
    }
    const original = structuredClone(body)
    mocks.request.mockResolvedValue(resourceItem('draftPurchaseOrders', `draftPurchaseOrders/${KEY}`))
    const response = await invoke('create_draft_purchase_order', {
      buyerId: ID, documentStyleId: ID, procurementBUId: ID, supplierId: ID, supplierSiteId: ID, body,
    })
    expect(response.result.success).toBe(true)
    expect(body).toEqual(original)
    const serialized = serializeOracleFusionJsonBody(mocks.request.mock.calls[0][1].body)
    expect(serialized).toContain(`"BuyerId":${ID}`)
    expect(serialized).toContain(`"SupplierId":${ID}`)
    expect(serialized).toContain(`"LineTypeId":${ID}`)
    expect(serialized).toContain('"Quantity":0')
    expect(serialized).not.toContain('"SupplierId":"123"')
    expect(serialized).not.toContain('{}')
  })

  it('preserves explicit false and omitted optional action fields as different requests', async () => {
    mocks.request.mockResolvedValue({ result: 'SUCCESS' })
    await invoke('submit_purchase_requisition', { requisitionKey: KEY })
    expect(mocks.request.mock.calls[0][1].body).toEqual({})
    await invoke('submit_purchase_requisition', { requisitionKey: KEY, requestFundsOverrideFlag: false })
    expect(mocks.request.mock.calls[1][1].body).toEqual({ requestFundsOverrideFlag: false })
  })

  it.each([9007199254740992, '9223372036854775808', '-1', '1.5'])(
    'rejects imprecise or invalid request identifier %s before transport',
    async (badId) => {
      const { status } = await invoke('create_purchase_requisition', {
        preparerId: ID, requisitioningBUId: ID,
        body: { lines: [{ LineNumber: 1, RequesterId: badId }] },
      })
      expect(status).toBe(400)
      expect(mocks.request).not.toHaveBeenCalled()
    }
  )

  it('rejects unknown write fields, oversized child arrays and empty updates', async () => {
    for (const body of [{ StatusCode: 'OPEN' }, { lines: Array.from({ length: 101 }, () => ({ LineNumber: 1 })) }]) {
      expect((await invoke('create_purchase_requisition', {
        preparerId: ID, requisitioningBUId: ID, body,
      })).status).toBe(400)
    }
    expect((await invoke('update_supplier', { supplierId: ID, body: {} })).status).toBe(400)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('distinguishes numeric negotiation filtering from opaque resource keys', async () => {
    mocks.request.mockResolvedValue(page([]))
    await invoke('list_supplier_negotiation_responses', {
      negotiationId: ID, q: "ResponseStatusCode='ACTIVE'", limit: 25, offset: 0, totalResults: false,
    })
    const request = mocks.request.mock.calls[0][1]
    expect(request.query).toMatchObject({
      q: `AuctionHeaderId=${ID};ResponseStatusCode='ACTIVE'`,
      limit: 25, offset: 0, totalResults: false,
    })
  })

  it('returns only the requested page and a usable next offset', async () => {
    mocks.request.mockResolvedValue(page([
      resourceItem('suppliers', `suppliers/${ID}`),
    ], 50, true))
    const { result } = await invoke('list_suppliers', { offset: 50, limit: 100 })
    expect(result.output).toMatchObject({ count: 1, offset: 50, hasMore: true, nextOffset: 51 })
    expect(mocks.request).toHaveBeenCalledTimes(1)
  })

  it.each([
    { items: [], count: 1, offset: 0, limit: 100, hasMore: false },
    { items: [], count: 0, offset: 0, limit: 100, hasMore: true },
    { items: [], count: 0, offset: 1, limit: 100, hasMore: false },
    { items: 'not-an-array', count: 0, offset: 0, limit: 100, hasMore: false },
  ])('rejects a malformed collection instead of reporting an empty successful list', async (invalid) => {
    mocks.request.mockResolvedValue(invalid)
    expect((await invoke('list_suppliers')).status).toBe(502)
  })

  it.each([true, false])('uses authoritative self links for opaque keys (v9=%s)', async (v9) => {
    mocks.request.mockResolvedValue(page([
      resourceItem('purchaseOrders', `purchaseOrders/${KEY}`, v9),
    ]))
    const { result } = await invoke('list_purchase_orders')
    expect(result.output.items[0]).toMatchObject({ key: KEY, POHeaderId: ID })
    expect(result.output.items[0].key).not.toBe(ID)
  })

  it('rejects missing, foreign-origin and mismatched self links', async () => {
    const good = resourceItem('purchaseOrders', `purchaseOrders/${KEY}`)
    for (const invalid of [
      { ...fixtureFields.purchaseOrders },
      { ...good, '@context': { links: [{ rel: 'self', href: `https://other.fa.us2.oraclecloud.com${ROOT}purchaseOrders/${KEY}` }] } },
      resourceItem('purchaseOrders', 'purchaseOrders/OTHER'),
    ]) {
      mocks.request.mockResolvedValue(invalid)
      expect((await invoke('get_purchase_order', { purchaseOrderKey: KEY })).status).toBe(502)
    }
  })

  it('checks that PATCH returns the same document', async () => {
    mocks.request.mockResolvedValue(resourceItem('draftPurchaseOrders', 'draftPurchaseOrders/OTHER'))
    expect((await invoke('update_draft_purchase_order', {
      draftPurchaseOrderKey: KEY, body: { Description: 'Update' },
    })).status).toBe(502)
  })

  it('preserves framework-v9 decimal strings while normalizing low-precision numbers', async () => {
    mocks.request.mockResolvedValue({
      ...resourceItem('purchaseOrders', `purchaseOrders/${KEY}`, true),
      Ordered: '123456789012345.678901',
      Total: 123.5,
      Revision: 0,
    })
    const { result } = await invoke('get_purchase_order', { purchaseOrderKey: KEY })
    expect(result.success).toBe(true)
    expect(result.output.purchaseOrder).toMatchObject({
      Ordered: '123456789012345.678901',
      Total: '123.5',
      Revision: '0',
      FrozenFlag: false,
    })
    mocks.request.mockResolvedValue(page([{
      ...resourceItem('purchaseOrderLines', `purchaseOrders/${KEY}/child/lines/${ID}`, true),
      Quantity: '1.234567890123456789E-20',
      Price: null,
    }]))
    const lines = await invoke('list_purchase_order_lines', { purchaseOrderKey: KEY })
    expect(lines.result.success).toBe(true)
    expect(lines.result.output.items[0]).toMatchObject({
      Quantity: '1.234567890123456789E-20',
      Price: null,
    })
  })

  it.each(['', ' 1 ', 'NaN', '1,000.00', '1'.repeat(257), 9007199254740992])(
    'rejects malformed or already-imprecise numeric resource value %s',
    async (Ordered) => {
      mocks.request.mockResolvedValue({
        ...resourceItem('purchaseOrders', `purchaseOrders/${KEY}`, true),
        Ordered,
      })
      expect((await invoke('get_purchase_order', { purchaseOrderKey: KEY })).status).toBe(502)
    }
  )

  it('rejects malformed scalar output and already-imprecise response IDs', async () => {
    for (const invalid of [
      { ...fixtureFields.suppliers, SupplierId: 9007199254740992 },
      { ...fixtureFields.suppliers, Supplier: { unexpected: true } },
    ]) {
      mocks.request.mockResolvedValue(page([invalid]))
      expect((await invoke('list_suppliers')).status).toBe(502)
    }
  })

  it.each([
    ['submit_purchase_requisition', { requisitionKey: KEY }, { result: 'FAILURE' }],
    ['withdraw_purchase_requisition', { requisitionKey: KEY }, { result: { STATUS: [{ CODE: 'FAILURE' }] } }],
    ['hold_purchase_order', { purchaseOrderKey: KEY }, { result: 'Failure' }],
    ['validate_or_publish_supplier_negotiation', { negotiationKey: KEY, actionIntent: 'Validate' }, {
      result: { Status: 'ERROR', Message: 'Resolve validation errors', ErrorsListId: '513428', Negotiation: '35340' },
    }],
  ])('does not confuse HTTP success with business success for %s', async (slug, params, raw) => {
    mocks.request.mockResolvedValue(raw)
    const { status, result } = await invoke(slug as string, params as Record<string, unknown>)
    expect(status).toBe(200)
    expect(result.success).toBe(false)
    expect(result.output.businessSuccess).toBe(false)
    expect(result.error).toBeTruthy()
  })

  it('returns validation messages without inventing a pass/fail schema for dynamic dictionaries', async () => {
    const messages = [{ Message: 'Review before submitting' }]
    mocks.request.mockResolvedValue({ result: messages })
    const { result } = await invoke('validate_draft_purchase_order', { draftPurchaseOrderKey: KEY })
    expect(result.output).toEqual({ result: messages, hasMessages: true })
    expect(result.output).not.toHaveProperty('businessSuccess')
  })

  it('requires explicit negotiation action intent and keeps action BuyerId a JSON string', async () => {
    expect((await invoke('validate_or_publish_supplier_negotiation', { negotiationKey: KEY })).status).toBe(400)
    expect(mocks.request).not.toHaveBeenCalled()
    mocks.request.mockResolvedValue({
      result: { Status: 'SUCCESS', Message: 'Published', ErrorsListId: null, Negotiation: 43653 },
    })
    const { result } = await invoke('validate_or_publish_supplier_negotiation', {
      negotiationKey: KEY, actionIntent: 'Publish', buyerId: ID, ignoreWarnings: false,
    })
    expect(mocks.request.mock.calls[0][1].body).toEqual({
      ActionIntent: 'Publish', BuyerId: ID, IgnoreWarning: 'N',
    })
    expect(result.output.result.Negotiation).toBe('43653')
  })

  it('binds execution to the Fusion service-account family before any Oracle request', async () => {
    mocks.resolveAccount.mockResolvedValue({ credentialType: 'service_account', providerId: 'netsuite-service-account' })
    expect((await invoke('list_suppliers')).status).toBe(403)
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('preserves a safe provider status and propagates cancellation', async () => {
    mocks.request.mockRejectedValue(new OracleFusionProviderError('Oracle Fusion access denied', 403))
    expect((await invoke('list_suppliers')).status).toBe(403)
    const controller = new AbortController()
    controller.abort(new Error('Stopped'))
    await expect(invoke('list_suppliers', {}, controller.signal)).rejects.toThrow('Stopped')
  })

  it('rejects undeclared internal-operation inputs', async () => {
    await expect(executeProcurementOperation('oracle_fusion_procurement_list_suppliers', {
      ...AUTH, _context: { userId: 'forged' }, path: 'invoices',
    })).rejects.toThrow()
    expect(mocks.request).not.toHaveBeenCalled()
  })

  it('registers the same 39 tools in the block, metadata and internal-operation dispatcher', async () => {
    const ids = CONTRACTS.map((contract) => `oracle_fusion_procurement_${contract.slug}`).sort()
    expect(ids).toHaveLength(39)
    expect([...toolById.keys()].sort()).toEqual(ids)
    expect([...OracleFusionProcurementBlock.tools.access].sort()).toEqual(ids)
    expect(getRegisteredInternalToolOperationIds().filter((id) => id.startsWith('oracle_fusion_procurement_')).sort()).toEqual(ids)
    const options = OracleFusionProcurementBlock.subBlocks.find(
      (block) => block.id === 'operation'
    )!.options!
    if (!Array.isArray(options)) throw new Error('Expected static Procurement operations')
    expect(options.map((option) => option.id).sort()).toEqual(ids)
    expect(OracleFusionProcurementBlock.icon).toBe(NetSuiteIcon)
    expect(OracleFusionProcurementBlockMeta.templates.length).toBeGreaterThanOrEqual(7)
    expect(OracleFusionProcurementBlockMeta.skills.length).toBeGreaterThanOrEqual(6)
    for (const id of ids) {
      expect(hasToolId(id)).toBe(true)
      expect(toolMetadata[id]?.oauth).toMatchObject({
        provider: 'oracle_fusion_procurement', credentialKind: 'service-account',
        authoritativeParams: ['instanceUrl'],
      })
      expect(await getInternalToolOperationHandler(id)).toBe(executeOracleFusionProcurementTool)
    }
  })

  it('aligns active block fields, required inputs and outputs with each selected tool', () => {
    const block = OracleFusionProcurementBlock
    for (const tool of Object.values(procurementTools) as InternalToolConfig[]) {
      const values = { operation: tool.id }
      const active = block.subBlocks.filter((field) => evaluateSubBlockCondition(field.condition, values))
      const accepted = new Set(active.map((field) => field.canonicalParamId ?? field.id))
      for (const field of active) {
        if (field.id === 'operation') continue
        const paramId = field.canonicalParamId ?? field.id
        expect(tool.params, `${tool.id} field ${paramId}`).toHaveProperty(paramId)
        const required = typeof field.required === 'boolean'
          ? field.required : field.required ? evaluateSubBlockCondition(field.required, values) : false
        if (required) expect(tool.params[paramId].required).toBe(true)
      }
      for (const [id, param] of Object.entries(tool.params)) {
        if (param.visibility === 'hidden') continue
        if (param.required) expect(accepted.has(id), `${tool.id} missing required ${id}`).toBe(true)
      }
      const produced = Object.entries(block.outputs)
        .filter(([, field]) => evaluateSubBlockCondition(field.condition, values))
        .map(([id]) => id).sort()
      expect(produced, tool.id).toEqual(Object.keys(tool.outputs ?? {}).sort())
    }
  })

  it('keeps canonical selector/manual pairs aligned and clears stale mutation inputs', () => {
    const block = OracleFusionProcurementBlock
    const groups = buildCanonicalIndex(block.subBlocks).groupsById
    expect(Object.keys(groups)).toHaveLength(17)
    for (const [id, group] of Object.entries(groups)) {
      expect(group.basicId, id).toBeTruthy()
      expect(group.advancedIds).toHaveLength(1)
      const members = block.subBlocks.filter((field) => field.canonicalParamId === id)
      expect(members[0].condition).toEqual(members[1].condition)
      expect(members[0].required).toEqual(members[1].required)
    }
    const mapped = mappedBlockInputs({
      ...AUTH, operation: 'oracle_fusion_procurement_list_suppliers',
      supplierId: ID, body: { Supplier: 'Stale' }, actionIntent: 'Publish', limit: '25', offset: '0',
    })
    expect(mapped).toMatchObject({ limit: 25, offset: 0 })
    const projected = procurementTools.oracleFusionProcurementListSuppliersTool.operation.input(mapped as typeof AUTH)
    expect(projected).not.toHaveProperty('body')
    expect(projected).not.toHaveProperty('supplierId')
    expect(projected).not.toHaveProperty('actionIntent')
    expect(projected).not.toHaveProperty('operation')
  })

  it('preserves exact block identifiers and typed agent inputs without an editor operation', () => {
    const mapped = mappedBlockInputs({
      operation: 'oracle_fusion_procurement_get_supplier', supplierId: ID,
    })
    expect(mapped.supplierId).toBe(ID)
    expect(() => mappedBlockInputs({
      operation: 'oracle_fusion_procurement_get_supplier', supplierId: 9007199254740992,
    })).toThrow('must be a string')
    const typed = { ...AUTH, supplierId: ID, body: { OneTimeSupplierFlag: false } }
    expect(mappedBlockInputs(typed)).toEqual(typed)
  })
})
