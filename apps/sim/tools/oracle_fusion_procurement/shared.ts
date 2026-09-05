import type { OracleFusionProcurementParams } from '@/tools/oracle_fusion_procurement/types'
import type {
  InternalToolConfig,
  OAuthConfig,
  OutputProperty,
  ToolConfig,
  ToolResponse,
} from '@/tools/types'

export const ORACLE_FUSION_PROCUREMENT_OAUTH_CONFIG = {
  required: true,
  provider: 'oracle_fusion_procurement',
  credentialKind: 'service-account',
  authoritativeParams: ['instanceUrl'],
} as const satisfies OAuthConfig

export const procurementAuthParams = {
  oauthCredential: {
    type: 'string',
    required: true,
    visibility: 'user-only',
    description: 'Reusable Oracle Fusion service-account credential',
  },
  accessToken: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Authentication material injected by the executor from the selected credential',
  },
  instanceUrl: {
    type: 'string',
    required: false,
    visibility: 'hidden',
    description: 'Fusion application origin injected by the executor from the selected credential',
  },
} satisfies ToolConfig['params']

export const procurementParamFields = {
  supplierId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Numeric SupplierId, preserved as a decimal string',
  },
  supplierSiteId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Numeric SupplierSiteId belonging to the selected supplier, as a decimal string',
  },
  requisitionKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque purchase-requisition key from the key output; do not substitute RequisitionHeaderId',
  },
  draftPurchaseOrderKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque draft purchase-order key from the key output; do not substitute POHeaderId',
  },
  purchaseOrderKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque approved purchase-order key from the key output; do not substitute POHeaderId',
  },
  poHeaderId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Numeric POHeaderId from a purchase order, as a decimal string (not its opaque key)',
  },
  receiptKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque receipt key from List Purchase Order Receipts for this POHeaderId; not ReceiptId',
  },
  negotiationKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Opaque supplier-negotiation key from the key output; not AuctionHeaderId',
  },
  negotiationId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Numeric AuctionHeaderId to filter negotiation responses, as a decimal string',
  },
  responseKey: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Opaque supplier-negotiation-response key from the key output; not ResponseNumber',
  },
  assignmentId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Numeric procurement-agent AssignmentId, as a decimal string (not AgentId)',
  },
  supplierName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Supplier name (maximum 360 characters)',
  },
  supplierSiteName: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Supplier site name (maximum 240 characters)',
  },
  supplierAddressId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Existing SupplierAddressId belonging to this supplier, as a decimal string',
  },
  procurementBUId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Numeric procurement business-unit ID, as a decimal string. The picker shows purchase-order-enabled units; enter an authorized ID manually for other procurement roles',
  },
  preparerId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Numeric person ID of the requisition preparer, as a decimal string',
  },
  requisitioningBUId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Numeric requisitioning business-unit ID, as a decimal string',
  },
  buyerId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Numeric buyer person ID, as a decimal string (not the agent assignment ID)',
  },
  documentStyleId: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Numeric purchasing document StyleId, as a decimal string',
  },
  negotiationTitle: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Negotiation title (maximum 80 characters)',
  },
  actionIntent: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Explicit action intent: Validate or Publish. Validation does not publish the negotiation',
  },
  holdReason: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Reason for placing the purchase order on hold',
  },
  removeHoldReason: {
    type: 'string',
    required: true,
    visibility: 'user-or-llm',
    description: 'Reason for removing the purchase-order hold',
  },
  requestFundsOverrideFlag: {
    type: 'boolean',
    required: true,
    visibility: 'user-or-llm',
    description: 'Explicitly request a funds override when submitting the requisition',
  },
  validateBeforeSubmitFlag: {
    type: 'boolean',
    required: true,
    visibility: 'user-or-llm',
    description:
      'Validate the draft purchase order before submission; Oracle defaults to false when omitted',
  },
  ignoreWarnings: {
    type: 'boolean',
    required: true,
    visibility: 'user-or-llm',
    description: 'Explicitly ignore negotiation publishing warnings (true maps to Y, false to N)',
  },
} satisfies ToolConfig['params']

export const procurementListParams = {
  q: {
    type: 'string',
    required: false,
    description: 'Oracle q filter expression for this resource (maximum 4096 characters)',
  },
  orderBy: {
    type: 'string',
    required: false,
    description: 'Oracle comma-separated orderBy attributes with optional :asc or :desc',
  },
  limit: {
    type: 'number',
    required: false,
    default: 100,
    description: 'One page of 1-100 records; default 100',
  },
  offset: {
    type: 'number',
    required: false,
    default: 0,
    description: 'Zero-based page offset; at most 1000000',
  },
  totalResults: {
    type: 'boolean',
    required: false,
    description: 'Request the estimated total matching count; optional',
  },
} satisfies ToolConfig['params']


interface ProcurementToolDefinition {
  id: string
  name: string
  description: string
  params: ToolConfig['params']
  outputs: Record<string, OutputProperty>
}

/** Same registered internal-operation boundary as SCM; no client-reachable server imports. */
export function createProcurementTool(
  definition: ProcurementToolDefinition
): InternalToolConfig<OracleFusionProcurementParams, ToolResponse> {
  const params = { ...procurementAuthParams, ...definition.params }
  return {
    ...definition,
    version: '1.0.0',
    params,
    oauth: ORACLE_FUSION_PROCUREMENT_OAUTH_CONFIG,
    operation: {
      // Project this operation's declared inputs only. Inactive block fields and executor
      // control values must not become product inputs or mutation fields.
      input: (input) =>
        Object.fromEntries(
          Object.keys(params)
            .filter((key) => input[key] !== undefined)
            .map((key) => [key, input[key]])
        ),
    },
  }
}
