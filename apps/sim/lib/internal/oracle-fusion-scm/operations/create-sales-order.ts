import { z } from 'zod'
import { requestOracleFusionJson } from '@/lib/internal/oracle-fusion/client'
import {
  oracleFusionScmCollectionPath,
  projectOracleFusionScmResource,
  unexpectedOracleFusionScmResponse,
} from '@/lib/internal/oracle-fusion-scm/operations/read-resource'
import {
  oracleFusionScmIntegerInput,
  oracleFusionScmMutationInputSchema,
} from '@/lib/internal/oracle-fusion-scm/schema'
import type { ToolResponse } from '@/tools/types'

/** Oracle 26C contract: op-salesordersfororderhub-post.html */
const lineSchema = z
  .object({
    OrderedQuantity: z.number().finite(),
    OrderedUOMCode: z.string().max(3).min(1),
    ProductId: oracleFusionScmIntegerInput('int64'),
    ProductNumber: z.string().max(255).nullable().optional(),
    SourceScheduleNumber: z.string().max(50).min(1),
    SourceTransactionLineId: z.string().max(50).min(1),
    SourceTransactionLineNumber: z.string().max(100).min(1),
    SourceTransactionScheduleId: z.string().max(50).min(1),
    RequestedShipDate: z.string().datetime({ offset: true }).nullable().optional(),
    RequestedArrivalDate: z.string().datetime({ offset: true }).nullable().optional(),
    RequestedFulfillmentOrganizationId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    RequestedFulfillmentOrganizationCode: z.string().max(255).nullable().optional(),
    UnitListPrice: z.number().finite().nullable().optional(),
    UnitSellingPrice: z.number().finite().nullable().optional(),
    Comments: z.string().max(2000).nullable().optional(),
  })
  .strict()

const bodySchema = z
  .object({
    BusinessUnitId: oracleFusionScmIntegerInput('int64'),
    SourceTransactionId: z.string().max(50).min(1),
    SourceTransactionNumber: z.string().max(50).min(1),
    SourceTransactionRevisionNumber: oracleFusionScmIntegerInput('int64'),
    SourceTransactionSystem: z.string().max(50).min(1),
    BuyingPartyId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    BuyingPartyNumber: z.string().max(255).nullable().optional(),
    BuyingPartyName: z.string().max(255).nullable().optional(),
    CustomerPONumber: z.string().max(50).nullable().optional(),
    TransactionalCurrencyCode: z.string().max(15).nullable().optional(),
    TransactionOn: z.string().datetime({ offset: true }).optional(),
    RequestedShipDate: z.string().datetime({ offset: true }).nullable().optional(),
    RequestedArrivalDate: z.string().datetime({ offset: true }).nullable().optional(),
    Comments: z.string().max(2000).nullable().optional(),
    SubmittedFlag: z.boolean().nullable().optional(),
    lines: z.array(lineSchema).min(1).max(100),
  })
  .strict()

const inputSchema = oracleFusionScmMutationInputSchema(bodySchema, [])

/** Creates the documented sales order fields without numeric identifier rounding. */
export async function executeOracleFusionScmCreateSalesOrder(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  const collection = oracleFusionScmCollectionPath('salesOrders', input)
  const relativePath = collection
  const payload = await requestOracleFusionJson(
    input,
    {
      method: 'POST',
      address: { family: 'fscm', relativePath },
      mediaType: 'application/vnd.oracle.adf.resourceitem+json',
      body: input.body,
    },
    signal
  )
  const item = unexpectedOracleFusionScmResponse(() =>
    projectOracleFusionScmResource('salesOrders', payload, input.instanceUrl, collection)
  )
  return { success: true, output: { salesOrder: item } }
}
