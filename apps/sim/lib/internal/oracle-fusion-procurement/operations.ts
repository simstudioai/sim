import { filterUndefined } from '@sim/utils/object'
import { z } from 'zod'
import {
  type OracleFusionResolvedCredential,
  requestOracleFusionJson,
} from '@/lib/internal/oracle-fusion/client'
import type { OracleFusionResourceAddress } from '@/lib/internal/oracle-fusion/paths'
import {
  encodeOracleFusionPathSegment,
  extractOracleFusionOpaqueKey,
  parseOracleFusionCollection,
  validateOracleFusionSelfLink,
} from '@/lib/internal/oracle-fusion/protocol'
import {
  PROCUREMENT_MAX_OFFSET,
  ProcurementInputError,
  type ProcurementResource,
  ProcurementResponseError,
  type ProcurementWriteOperation,
  parseProcurementBody,
  procurementIdentifierSchema,
  procurementKeySchema,
  procurementPagingSchema,
  procurementResourceSchemas,
  procurementWriteSchemas,
} from '@/lib/internal/oracle-fusion-procurement/schema'
import type { ToolResponse } from '@/tools/types'

interface ResourceDefinition {
  path: string
  idField?: string
  keyParam?: string
  opaque?: boolean
  parent?: { path: string; param: string; numeric?: boolean }
}

export const procurementResources = {
  suppliers: { path: 'suppliers', idField: 'SupplierId', keyParam: 'supplierId' },
  supplierSites: {
    path: 'sites',
    idField: 'SupplierSiteId',
    keyParam: 'supplierSiteId',
    parent: { path: 'suppliers', param: 'supplierId', numeric: true },
  },
  supplierAddresses: {
    path: 'addresses',
    idField: 'SupplierAddressId',
    keyParam: 'supplierAddressId',
    parent: { path: 'suppliers', param: 'supplierId', numeric: true },
  },
  purchaseRequisitions: {
    path: 'purchaseRequisitions',
    idField: 'RequisitionHeaderId',
    keyParam: 'requisitionKey',
    opaque: true,
  },
  purchaseRequisitionLines: {
    path: 'lines',
    idField: 'RequisitionLineId',
    parent: { path: 'purchaseRequisitions', param: 'requisitionKey' },
  },
  draftPurchaseOrders: {
    path: 'draftPurchaseOrders',
    idField: 'POHeaderId',
    keyParam: 'draftPurchaseOrderKey',
    opaque: true,
  },
  draftPurchaseOrderLines: {
    path: 'lines',
    idField: 'POLineId',
    parent: { path: 'draftPurchaseOrders', param: 'draftPurchaseOrderKey' },
  },
  purchaseOrders: {
    path: 'purchaseOrders',
    idField: 'POHeaderId',
    keyParam: 'purchaseOrderKey',
    opaque: true,
  },
  purchaseOrderLines: {
    path: 'lines',
    idField: 'POLineId',
    parent: { path: 'purchaseOrders', param: 'purchaseOrderKey' },
  },
  purchaseOrderLifecycleDetails: {
    path: 'purchaseOrderLifeCycleDetails',
    idField: 'POHeaderId',
    keyParam: 'poHeaderId',
  },
  purchaseOrderReceipts: {
    path: 'receipts',
    keyParam: 'receiptKey',
    opaque: true,
    parent: { path: 'purchaseOrderLifeCycleDetails', param: 'poHeaderId', numeric: true },
  },
  supplierNegotiations: {
    path: 'supplierNegotiations',
    idField: 'AuctionHeaderId',
    keyParam: 'negotiationKey',
    opaque: true,
  },
  supplierNegotiationResponses: {
    path: 'supplierNegotiationResponses',
    idField: 'ResponseNumber',
    keyParam: 'responseKey',
    opaque: true,
  },
  procurementAgents: {
    path: 'procurementAgents',
    idField: 'AssignmentId',
    keyParam: 'assignmentId',
  },
  procurementBusinessUnits: {
    path: 'procurementBusinessUnitsLOV',
    idField: 'ProcurementBUId',
  },
  procurementPersons: {
    path: 'procurementPersonsLOV',
    idField: 'PersonId',
    keyParam: 'preparerId',
  },
  purchasingDocumentStyles: {
    path: 'purchasingDocumentStylesLOV',
    idField: 'StyleId',
    keyParam: 'documentStyleId',
  },
} as const satisfies Record<ProcurementResource, ResourceDefinition>

interface OperationDefinition {
  kind: 'list' | 'detail' | 'create' | 'update' | 'action'
  resource?: ProcurementResource
  wrapper?: string
  required: readonly string[]
  optional: readonly string[]
  write?: ProcurementWriteOperation
}

const procurementOperations = {
  oracle_fusion_procurement_create_draft_purchase_order: {
    kind: 'create',
    resource: 'draftPurchaseOrders',
    wrapper: 'draftPurchaseOrder',
    required: ['buyerId', 'documentStyleId', 'procurementBUId', 'supplierId', 'supplierSiteId'],
    optional: [],
    write: 'createDraftPurchaseOrder',
  },
  oracle_fusion_procurement_create_purchase_requisition: {
    kind: 'create',
    resource: 'purchaseRequisitions',
    wrapper: 'purchaseRequisition',
    required: ['preparerId', 'requisitioningBUId'],
    optional: [],
    write: 'createPurchaseRequisition',
  },
  oracle_fusion_procurement_create_supplier: {
    kind: 'create',
    resource: 'suppliers',
    wrapper: 'supplier',
    required: ['supplierName'],
    optional: [],
    write: 'createSupplier',
  },
  oracle_fusion_procurement_create_supplier_negotiation: {
    kind: 'create',
    resource: 'supplierNegotiations',
    wrapper: 'supplierNegotiation',
    required: ['procurementBUId', 'negotiationTitle'],
    optional: ['buyerId'],
    write: 'createSupplierNegotiation',
  },
  oracle_fusion_procurement_create_supplier_site: {
    kind: 'create',
    resource: 'supplierSites',
    wrapper: 'supplierSite',
    required: ['supplierId', 'procurementBUId', 'supplierSiteName', 'supplierAddressId'],
    optional: [],
    write: 'createSupplierSite',
  },
  oracle_fusion_procurement_get_draft_purchase_order: {
    kind: 'detail',
    resource: 'draftPurchaseOrders',
    wrapper: 'draftPurchaseOrder',
    required: ['draftPurchaseOrderKey'],
    optional: [],
  },
  oracle_fusion_procurement_get_procurement_agent: {
    kind: 'detail',
    resource: 'procurementAgents',
    wrapper: 'procurementAgent',
    required: ['assignmentId'],
    optional: [],
  },
  oracle_fusion_procurement_get_purchase_order: {
    kind: 'detail',
    resource: 'purchaseOrders',
    wrapper: 'purchaseOrder',
    required: ['purchaseOrderKey'],
    optional: [],
  },
  oracle_fusion_procurement_get_purchase_order_lifecycle_details: {
    kind: 'detail',
    resource: 'purchaseOrderLifecycleDetails',
    wrapper: 'lifecycleDetails',
    required: ['poHeaderId'],
    optional: [],
  },
  oracle_fusion_procurement_get_purchase_order_receipt: {
    kind: 'detail',
    resource: 'purchaseOrderReceipts',
    wrapper: 'purchaseOrderReceipt',
    required: ['poHeaderId', 'receiptKey'],
    optional: [],
  },
  oracle_fusion_procurement_get_purchase_requisition: {
    kind: 'detail',
    resource: 'purchaseRequisitions',
    wrapper: 'purchaseRequisition',
    required: ['requisitionKey'],
    optional: [],
  },
  oracle_fusion_procurement_get_supplier: {
    kind: 'detail',
    resource: 'suppliers',
    wrapper: 'supplier',
    required: ['supplierId'],
    optional: [],
  },
  oracle_fusion_procurement_get_supplier_negotiation: {
    kind: 'detail',
    resource: 'supplierNegotiations',
    wrapper: 'supplierNegotiation',
    required: ['negotiationKey'],
    optional: [],
  },
  oracle_fusion_procurement_get_supplier_negotiation_response: {
    kind: 'detail',
    resource: 'supplierNegotiationResponses',
    wrapper: 'supplierNegotiationResponse',
    required: ['responseKey'],
    optional: [],
  },
  oracle_fusion_procurement_get_supplier_site: {
    kind: 'detail',
    resource: 'supplierSites',
    wrapper: 'supplierSite',
    required: ['supplierId', 'supplierSiteId'],
    optional: [],
  },
  oracle_fusion_procurement_hold_purchase_order: {
    kind: 'action',
    required: ['purchaseOrderKey'],
    optional: ['holdReason'],
  },
  oracle_fusion_procurement_list_draft_purchase_order_lines: {
    kind: 'list',
    resource: 'draftPurchaseOrderLines',
    required: ['draftPurchaseOrderKey'],
    optional: [],
  },
  oracle_fusion_procurement_list_draft_purchase_orders: {
    kind: 'list',
    resource: 'draftPurchaseOrders',
    required: [],
    optional: [],
  },
  oracle_fusion_procurement_list_procurement_agents: {
    kind: 'list',
    resource: 'procurementAgents',
    required: [],
    optional: [],
  },
  oracle_fusion_procurement_list_purchase_order_lines: {
    kind: 'list',
    resource: 'purchaseOrderLines',
    required: ['purchaseOrderKey'],
    optional: [],
  },
  oracle_fusion_procurement_list_purchase_order_receipts: {
    kind: 'list',
    resource: 'purchaseOrderReceipts',
    required: ['poHeaderId'],
    optional: [],
  },
  oracle_fusion_procurement_list_purchase_orders: {
    kind: 'list',
    resource: 'purchaseOrders',
    required: [],
    optional: [],
  },
  oracle_fusion_procurement_list_purchase_requisition_lines: {
    kind: 'list',
    resource: 'purchaseRequisitionLines',
    required: ['requisitionKey'],
    optional: [],
  },
  oracle_fusion_procurement_list_purchase_requisitions: {
    kind: 'list',
    resource: 'purchaseRequisitions',
    required: [],
    optional: [],
  },
  oracle_fusion_procurement_list_supplier_negotiation_responses: {
    kind: 'list',
    resource: 'supplierNegotiationResponses',
    required: [],
    optional: ['negotiationId'],
  },
  oracle_fusion_procurement_list_supplier_negotiations: {
    kind: 'list',
    resource: 'supplierNegotiations',
    required: [],
    optional: [],
  },
  oracle_fusion_procurement_list_supplier_sites: {
    kind: 'list',
    resource: 'supplierSites',
    required: ['supplierId'],
    optional: [],
  },
  oracle_fusion_procurement_list_suppliers: {
    kind: 'list',
    resource: 'suppliers',
    required: [],
    optional: [],
  },
  oracle_fusion_procurement_remove_purchase_order_hold: {
    kind: 'action',
    required: ['purchaseOrderKey'],
    optional: ['removeHoldReason'],
  },
  oracle_fusion_procurement_submit_draft_purchase_order: {
    kind: 'action',
    required: ['draftPurchaseOrderKey'],
    optional: ['validateBeforeSubmitFlag'],
  },
  oracle_fusion_procurement_submit_purchase_requisition: {
    kind: 'action',
    required: ['requisitionKey'],
    optional: ['requestFundsOverrideFlag'],
  },
  oracle_fusion_procurement_update_draft_purchase_order: {
    kind: 'update',
    resource: 'draftPurchaseOrders',
    wrapper: 'draftPurchaseOrder',
    required: ['draftPurchaseOrderKey'],
    optional: [],
    write: 'updateDraftPurchaseOrder',
  },
  oracle_fusion_procurement_update_purchase_requisition: {
    kind: 'update',
    resource: 'purchaseRequisitions',
    wrapper: 'purchaseRequisition',
    required: ['requisitionKey'],
    optional: [],
    write: 'updatePurchaseRequisition',
  },
  oracle_fusion_procurement_update_supplier: {
    kind: 'update',
    resource: 'suppliers',
    wrapper: 'supplier',
    required: ['supplierId'],
    optional: [],
    write: 'updateSupplier',
  },
  oracle_fusion_procurement_update_supplier_negotiation: {
    kind: 'update',
    resource: 'supplierNegotiations',
    wrapper: 'supplierNegotiation',
    required: ['negotiationKey'],
    optional: [],
    write: 'updateSupplierNegotiation',
  },
  oracle_fusion_procurement_update_supplier_site: {
    kind: 'update',
    resource: 'supplierSites',
    wrapper: 'supplierSite',
    required: ['supplierId', 'supplierSiteId'],
    optional: [],
    write: 'updateSupplierSite',
  },
  oracle_fusion_procurement_validate_draft_purchase_order: {
    kind: 'action',
    required: ['draftPurchaseOrderKey'],
    optional: [],
  },
  oracle_fusion_procurement_validate_or_publish_supplier_negotiation: {
    kind: 'action',
    required: ['negotiationKey', 'actionIntent'],
    optional: ['buyerId', 'ignoreWarnings'],
  },
  oracle_fusion_procurement_withdraw_purchase_requisition: {
    kind: 'action',
    required: ['requisitionKey'],
    optional: [],
  },
} as const satisfies Record<string, OperationDefinition>

const inputFields = {
  supplierId: procurementIdentifierSchema,
  supplierSiteId: procurementIdentifierSchema,
  supplierAddressId: procurementIdentifierSchema,
  poHeaderId: procurementIdentifierSchema,
  negotiationId: procurementIdentifierSchema,
  assignmentId: procurementIdentifierSchema,
  procurementBUId: procurementIdentifierSchema,
  preparerId: procurementIdentifierSchema,
  requisitioningBUId: procurementIdentifierSchema,
  buyerId: procurementIdentifierSchema,
  documentStyleId: procurementIdentifierSchema,
  requisitionKey: procurementKeySchema,
  draftPurchaseOrderKey: procurementKeySchema,
  purchaseOrderKey: procurementKeySchema,
  receiptKey: procurementKeySchema,
  negotiationKey: procurementKeySchema,
  responseKey: procurementKeySchema,
  supplierName: z.string().trim().min(1).max(360),
  supplierSiteName: z.string().trim().min(1).max(240),
  negotiationTitle: z.string().trim().min(1).max(80),
  actionIntent: z.enum(['Validate', 'Publish']),
  holdReason: z.string().max(240),
  removeHoldReason: z.string().max(240),
  requestFundsOverrideFlag: z.boolean(),
  validateBeforeSubmitFlag: z.boolean(),
  ignoreWarnings: z.boolean(),
} satisfies Record<string, z.ZodTypeAny>

function resourceDefinition(resource: ProcurementResource): ResourceDefinition {
  return procurementResources[resource]
}

function collectionAddress(
  resource: ProcurementResource,
  params: Record<string, unknown>
): OracleFusionResourceAddress {
  const definition = resourceDefinition(resource)
  if (!definition.parent) return { family: 'fscm', relativePath: definition.path }
  const { path, param, numeric } = definition.parent
  const key = numeric
    ? procurementIdentifierSchema.parse(params[param])
    : procurementKeySchema.parse(params[param])
  return {
    family: 'fscm',
    relativePath: `${path}/${encodeOracleFusionPathSegment(key)}/child/${definition.path}`,
  }
}

function detailAddress(
  resource: ProcurementResource,
  params: Record<string, unknown>
): OracleFusionResourceAddress {
  const definition = resourceDefinition(resource)
  if (!definition.keyParam)
    throw new ProcurementInputError('This resource has no direct detail lookup')
  const key = definition.opaque
    ? procurementKeySchema.parse(params[definition.keyParam])
    : procurementIdentifierSchema.parse(params[definition.keyParam])
  const collection = collectionAddress(resource, params)
  return {
    ...collection,
    relativePath: `${collection.relativePath}/${encodeOracleFusionPathSegment(key)}`,
  }
}

function resourceFields(resource: ProcurementResource): string {
  return Object.keys(procurementResourceSchemas[resource].shape).join(',')
}

function projectResource(
  resource: ProcurementResource,
  raw: unknown,
  credential: OracleFusionResolvedCredential,
  collection: OracleFusionResourceAddress
): Record<string, unknown> {
  try {
    /** The raw self link is authoritative, including REST framework v9 @context.links. */
    const key = resourceDefinition(resource).opaque
      ? extractOracleFusionOpaqueKey(raw, credential.instanceUrl, collection)
      : undefined
    const projected = procurementResourceSchemas[resource].parse(raw)
    return key === undefined ? projected : { key, ...projected }
  } catch {
    throw new ProcurementResponseError(`Oracle Fusion returned an invalid ${resource} resource`)
  }
}

/** Exactly one bounded page. Shared transport owns byte limits, cancellation, and GET retries. */
export async function listProcurementResource(
  resource: ProcurementResource,
  credential: OracleFusionResolvedCredential,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  if (resource === 'purchaseOrderLifecycleDetails') {
    throw new ProcurementInputError('Purchase-order lifecycle details require a POHeaderId')
  }
  const paging = procurementPagingSchema.parse(params)
  const address = collectionAddress(resource, params)
  const q =
    resource === 'supplierNegotiationResponses' && params.negotiationId !== undefined
      ? [`AuctionHeaderId=${procurementIdentifierSchema.parse(params.negotiationId)}`, paging.q]
          .filter(Boolean)
          .join(';')
      : paging.q
  const raw = await requestOracleFusionJson(
    credential,
    {
      method: 'GET',
      address,
      query: { ...paging, q: q || undefined, fields: resourceFields(resource) },
    },
    signal
  )
  try {
    const page = parseOracleFusionCollection(
      raw,
      (item) => projectResource(resource, item, credential, address),
      { expectedOffset: paging.offset, maxItems: paging.limit }
    )
    if (page.hasMore && page.nextOffset > PROCUREMENT_MAX_OFFSET) {
      throw new ProcurementResponseError('Oracle Fusion pagination exceeds the supported offset')
    }
    const { nextOffset, ...result } = page
    return { ...result, ...(page.hasMore ? { nextOffset } : {}) }
  } catch (error) {
    if (error instanceof ProcurementResponseError) throw error
    throw new ProcurementResponseError('Oracle Fusion returned an invalid collection page')
  }
}

export async function getProcurementResource(
  resource: ProcurementResource,
  credential: OracleFusionResolvedCredential,
  params: Record<string, unknown>,
  signal?: AbortSignal
) {
  const address = detailAddress(resource, params)
  const raw = await requestOracleFusionJson(
    credential,
    {
      method: 'GET',
      address,
      query: { fields: resourceFields(resource) },
    },
    signal
  )
  const result = projectResource(resource, raw, credential, collectionAddress(resource, params))
  const definition = resourceDefinition(resource)
  try {
    validateOracleFusionSelfLink(raw, credential.instanceUrl, address)
    const expected = definition.opaque
      ? procurementKeySchema.parse(params[definition.keyParam!])
      : procurementIdentifierSchema.parse(params[definition.keyParam!])
    if (result[definition.opaque ? 'key' : definition.idField!] !== expected) {
      throw new Error('Mismatched resource')
    }
  } catch {
    throw new ProcurementResponseError('Oracle Fusion returned a different resource than requested')
  }
  return result
}

/** Numeric IDs for hashed resources must use documented q fields, never a guessed item URL. */
export async function getProcurementSelection(
  resource: ProcurementResource,
  idField: string,
  id: string,
  credential: OracleFusionResolvedCredential,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<Record<string, unknown> | null> {
  const definition = resourceDefinition(resource)
  if (
    idField === 'key' ||
    (idField === definition.idField && definition.keyParam && !definition.opaque)
  ) {
    return getProcurementResource(
      resource,
      credential,
      { ...params, [definition.keyParam!]: id },
      signal
    )
  }
  const permittedQuery =
    (resource === 'purchaseOrders' && idField === 'POHeaderId') ||
    (resource === 'supplierNegotiations' && idField === 'AuctionHeaderId') ||
    (resource === 'procurementAgents' && idField === 'AgentId') ||
    (resource === 'procurementBusinessUnits' && idField === 'ProcurementBUId')
  if (!permittedQuery) throw new ProcurementInputError('Unsupported selection identifier')
  const normalized = procurementIdentifierSchema.parse(id)
  const page = await listProcurementResource(
    resource,
    credential,
    { ...params, q: `${idField}=${normalized}`, limit: 1, offset: 0 },
    signal
  )
  const item = page.items[0]
  if (!item) return null
  if (item[idField] !== normalized) {
    throw new ProcurementResponseError('Oracle Fusion returned a different selector identifier')
  }
  return item
}

function parseOperationInput(definition: OperationDefinition, input: unknown) {
  const shape: Record<string, z.ZodTypeAny> = {
    oauthCredential: z.string().min(1),
    accessToken: z.string().min(1),
    instanceUrl: z.string().min(1),
    ...(definition.kind === 'list' ? procurementPagingSchema.shape : {}),
    ...(definition.write ? { body: z.unknown().optional() } : {}),
  }
  for (const key of definition.required) {
    shape[key] = inputFields[key as keyof typeof inputFields]
  }
  for (const key of definition.optional) {
    shape[key] = inputFields[key as keyof typeof inputFields].optional()
  }
  return z.object(shape).strict().parse(input)
}

const writeHeaderInputs = {
  supplierName: 'Supplier',
  supplierSiteName: 'SupplierSite',
  supplierAddressId: 'SupplierAddressId',
  procurementBUId: 'ProcurementBUId',
  preparerId: 'PreparerId',
  requisitioningBUId: 'RequisitioningBUId',
  buyerId: 'BuyerId',
  documentStyleId: 'DocumentStyleId',
  negotiationTitle: 'NegotiationTitle',
} as const

function buildWriteBody(definition: OperationDefinition, params: Record<string, unknown>) {
  const body = { ...parseProcurementBody(params.body, definition.kind === 'update') }
  if (definition.kind === 'create') {
    for (const [input, field] of Object.entries(writeHeaderInputs)) {
      if (params[input] !== undefined) body[field] = params[input]
    }
    if (definition.resource === 'draftPurchaseOrders') {
      body.SupplierId = params.supplierId
      body.SupplierSiteId = params.supplierSiteId
    }
  }
  return procurementWriteSchemas[definition.write!].parse(body)
}

const actionDefinitions = {
  oracle_fusion_procurement_submit_purchase_requisition: {
    resource: 'purchaseRequisitions',
    action: 'submitRequisition',
    kind: 'string',
  },
  oracle_fusion_procurement_withdraw_purchase_requisition: {
    resource: 'purchaseRequisitions',
    action: 'withdraw',
    kind: 'withdraw',
  },
  oracle_fusion_procurement_validate_draft_purchase_order: {
    resource: 'draftPurchaseOrders',
    action: 'validateDocument',
    kind: 'validation',
  },
  oracle_fusion_procurement_submit_draft_purchase_order: {
    resource: 'draftPurchaseOrders',
    action: 'submit',
    kind: 'string',
  },
  oracle_fusion_procurement_hold_purchase_order: {
    resource: 'purchaseOrders',
    action: 'hold',
    kind: 'string',
  },
  oracle_fusion_procurement_remove_purchase_order_hold: {
    resource: 'purchaseOrders',
    action: 'removeHold',
    kind: 'string',
  },
  oracle_fusion_procurement_validate_or_publish_supplier_negotiation: {
    resource: 'supplierNegotiations',
    action: 'ValidateAndPublishNegotiation',
    kind: 'negotiation',
  },
} as const

const stringActionSchema = z.object({ result: z.string() })
const withdrawActionSchema = z.object({
  result: z.record(z.string(), z.array(z.record(z.string(), z.string()))),
})
const validationActionSchema = z.object({ result: z.array(z.record(z.string(), z.string())) })
/**
 * Oracle's 26C examples explicitly differ from the generic dictionary schema:
 * ErrorsListId may be null; Negotiation may be a JSON integer or a string.
 */
const negotiationActionSchema = z.object({
  result: z.object({
    Status: z.string(),
    Message: z.string(),
    Negotiation: z
      .union([z.string(), z.number().int().safe()])
      .nullable()
      .optional()
      .transform((value) => (value == null ? null : String(value))),
    ErrorsListId: z.string().nullable(),
  }),
})

async function executeAction(
  toolId: keyof typeof actionDefinitions,
  credential: OracleFusionResolvedCredential,
  params: Record<string, unknown>,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const action = actionDefinitions[toolId]
  const item = detailAddress(action.resource, params)
  const body =
    action.kind === 'negotiation'
      ? filterUndefined({
          ActionIntent: params.actionIntent,
          BuyerId: params.buyerId, // Documented as string here, not an integer JSON field.
          IgnoreWarning:
            params.ignoreWarnings === undefined ? undefined : params.ignoreWarnings ? 'Y' : 'N',
        })
      : filterUndefined({
          ...(toolId === 'oracle_fusion_procurement_submit_purchase_requisition'
            ? { requestFundsOverrideFlag: params.requestFundsOverrideFlag }
            : {}),
          ...(toolId === 'oracle_fusion_procurement_submit_draft_purchase_order'
            ? { validateBeforeSubmitFlag: params.validateBeforeSubmitFlag }
            : {}),
          ...(toolId === 'oracle_fusion_procurement_hold_purchase_order'
            ? { holdReason: params.holdReason }
            : {}),
          ...(toolId === 'oracle_fusion_procurement_remove_purchase_order_hold'
            ? { removeHoldReason: params.removeHoldReason }
            : {}),
        })
  const raw = await requestOracleFusionJson(
    credential,
    {
      method: 'POST',
      address: { ...item, relativePath: `${item.relativePath}/action/${action.action}` },
      mediaType: 'application/vnd.oracle.adf.action+json',
      body,
    },
    signal
  )
  try {
    if (action.kind === 'validation') {
      const { result } = validationActionSchema.parse(raw)
      return { success: true, output: { result, hasMessages: result.length > 0 } }
    }
    let output: Record<string, unknown>
    let businessSuccess: boolean
    if (action.kind === 'negotiation') {
      const { result } = negotiationActionSchema.parse(raw)
      businessSuccess = result.Status === 'SUCCESS'
      output = { result, businessSuccess }
    } else if (action.kind === 'withdraw') {
      const { result } = withdrawActionSchema.parse(raw)
      const statuses = result.STATUS
      businessSuccess = !!statuses?.length && statuses.every((status) => status.CODE === 'SUCCESS')
      output = { result, businessSuccess }
    } else {
      const { result } = stringActionSchema.parse(raw)
      businessSuccess = result.toUpperCase() === 'SUCCESS'
      output = { result, businessSuccess }
    }
    return {
      success: businessSuccess,
      output,
      ...(!businessSuccess
        ? { error: 'Oracle Fusion did not report a successful business action' }
        : {}),
    }
  } catch {
    throw new ProcurementResponseError('Oracle Fusion returned an invalid action result')
  }
}

export async function executeProcurementOperation(
  toolId: string,
  input: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  if (!Object.hasOwn(procurementOperations, toolId)) {
    throw new ProcurementInputError('Unsupported Oracle Fusion Procurement operation')
  }
  signal?.throwIfAborted()
  const definition: OperationDefinition =
    procurementOperations[toolId as keyof typeof procurementOperations]
  const params = parseOperationInput(definition, input)
  const credential = {
    instanceUrl: params.instanceUrl as string,
    accessToken: params.accessToken as string,
  }
  if (definition.kind === 'action') {
    return executeAction(toolId as keyof typeof actionDefinitions, credential, params, signal)
  }
  const resource = definition.resource!
  if (definition.kind === 'list') {
    return {
      success: true,
      output: await listProcurementResource(resource, credential, params, signal),
    }
  }
  if (definition.kind === 'detail') {
    const item = await getProcurementResource(resource, credential, params, signal)
    return { success: true, output: { [definition.wrapper!]: item } }
  }
  const address =
    definition.kind === 'create'
      ? collectionAddress(resource, params)
      : detailAddress(resource, params)
  const raw = await requestOracleFusionJson(
    credential,
    {
      method: definition.kind === 'create' ? 'POST' : 'PATCH',
      address,
      mediaType: 'application/vnd.oracle.adf.resourceitem+json',
      body: buildWriteBody(definition, params),
    },
    signal
  )
  const result = projectResource(resource, raw, credential, collectionAddress(resource, params))
  try {
    const resourceInfo = resourceDefinition(resource)
    const resultKey = result[resourceInfo.opaque ? 'key' : resourceInfo.idField!]
    const expectedAddress =
      definition.kind === 'update'
        ? address
        : {
            ...address,
            relativePath: `${address.relativePath}/${encodeOracleFusionPathSegment(String(resultKey))}`,
          }
    validateOracleFusionSelfLink(raw, credential.instanceUrl, expectedAddress)
    if (definition.kind === 'update' && resultKey !== params[resourceInfo.keyParam!]) {
      throw new Error('Mismatched updated resource')
    }
  } catch {
    throw new ProcurementResponseError('Oracle Fusion returned an inconsistent mutation resource')
  }
  return { success: true, output: { [definition.wrapper!]: result } }
}
