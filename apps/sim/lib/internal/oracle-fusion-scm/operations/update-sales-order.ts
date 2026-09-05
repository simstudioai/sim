import { z } from 'zod'
import { requestOracleFusionJson } from '@/lib/internal/oracle-fusion/client'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'
import {
  oracleFusionScmCollectionPath,
  projectOracleFusionScmResource,
  unexpectedOracleFusionScmResponse,
} from '@/lib/internal/oracle-fusion-scm/operations/read-resource'
import {
  oracleFusionScmIntegerInput,
  oracleFusionScmMutationInputSchema,
  oracleFusionScmOpaqueKeySchema,
} from '@/lib/internal/oracle-fusion-scm/schema'
import type { ToolResponse } from '@/tools/types'

/** Oracle 26C contract: op-salesordersfororderhub-orderkey-patch.html */
const bodySchema = z
  .object({
    SourceTransactionRevisionNumber: oracleFusionScmIntegerInput('int64').optional(),
    BuyingPartyId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    BuyingPartyNumber: z.string().max(255).nullable().optional(),
    BuyingPartyName: z.string().max(255).nullable().optional(),
    CustomerPONumber: z.string().max(50).nullable().optional(),
    TransactionalCurrencyCode: z.string().max(15).nullable().optional(),
    RequestedShipDate: z.string().datetime({ offset: true }).nullable().optional(),
    RequestedArrivalDate: z.string().datetime({ offset: true }).nullable().optional(),
    Comments: z.string().max(2000).nullable().optional(),
    SubmittedFlag: z.boolean().nullable().optional(),
    CanceledFlag: z.boolean().nullable().optional(),
    CancelReasonCode: z.string().max(255).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update')

const inputSchema = oracleFusionScmMutationInputSchema(bodySchema, ['salesOrderKey'])

/** Updates the documented sales order fields without numeric identifier rounding. */
export async function executeOracleFusionScmUpdateSalesOrder(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  const collection = oracleFusionScmCollectionPath('salesOrders', input)
  const resourceKey = oracleFusionScmOpaqueKeySchema.parse(input.salesOrderKey)
  const relativePath = `${collection}/${encodeOracleFusionPathSegment(resourceKey)}`
  const payload = await requestOracleFusionJson(
    input,
    {
      method: 'PATCH',
      address: { family: 'fscm', relativePath },
      mediaType: 'application/vnd.oracle.adf.resourceitem+json',
      body: input.body,
    },
    signal
  )
  const item = unexpectedOracleFusionScmResponse(() =>
    projectOracleFusionScmResource('salesOrders', payload, input.instanceUrl, collection)
  )
  if (item.salesOrderKey !== resourceKey) {
    return unexpectedOracleFusionScmResponse(() => {
      throw new Error('Updated resource key does not match the request')
    })
  }
  return { success: true, output: { salesOrder: item } }
}
