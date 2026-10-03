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

/** Oracle 26C contract: op-supplyrequests-supplyorderreferencenumber-patch.html */
const lineSchema = z
  .object({
    InterfaceBatchNumber: z.string().max(50).optional(),
    ProcessStatus: z.string().max(30).optional(),
    Quantity: z.number().finite().optional(),
    SupplyType: z.string().max(30).optional(),
    UOMCode: z.string().max(3).optional(),
    ItemId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    ItemNumber: z.string().max(300).nullable().optional(),
    SupplyOrderReferenceLineId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    SupplyOrderReferenceLineNumber: z.string().max(20).nullable().optional(),
    NeedByDate: z.string().datetime({ offset: true }).nullable().optional(),
    RequestedShipDate: z.string().datetime({ offset: true }).nullable().optional(),
    SourceOrganizationId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    SourceOrganizationCode: z.string().max(18).nullable().optional(),
    SourceSubinventoryCode: z.string().max(40).nullable().optional(),
    DestinationOrganizationId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    DestinationOrganizationCode: z.string().max(18).nullable().optional(),
    DestinationSubinventoryCode: z.string().max(40).nullable().optional(),
    DestinationTypeCode: z.string().max(30).nullable().optional(),
    SupplyOperation: z.string().max(30).nullable().optional(),
    Comments: z.string().max(240).nullable().optional(),
  })
  .strict()

const bodySchema = z
  .object({
    SupplyOrderReferenceId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    SupplyOrderReferenceNumber: z.string().max(200).pipe(oracleFusionScmOpaqueKeySchema).optional(),
    ProcessRequestFlag: z.boolean().nullable().optional(),
    AllowPartialRequestFlag: z.boolean().nullable().optional(),
    TrustedSource: oracleFusionScmIntegerInput('int32').optional(),
    TransferCostAmount: z.number().finite().nullable().optional(),
    TransferCostCurrencyCode: z.string().max(80).nullable().optional(),
    TransferCostTypeName: z.string().max(80).nullable().optional(),
    supplyRequestLines: z.array(lineSchema).min(1).max(100).optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update')

const inputSchema = oracleFusionScmMutationInputSchema(bodySchema, ['supplyRequestKey'])

/** Updates the documented supply request fields without numeric identifier rounding. */
export async function executeOracleFusionScmUpdateSupplyRequest(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  const collection = oracleFusionScmCollectionPath('supplyRequests', input)
  const resourceKey = oracleFusionScmOpaqueKeySchema.parse(input.supplyRequestKey)
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
    projectOracleFusionScmResource('supplyRequests', payload, input.instanceUrl, collection)
  )
  const expectedKey = input.body.SupplyOrderReferenceNumber ?? resourceKey
  if (item.supplyRequestKey !== expectedKey) {
    return unexpectedOracleFusionScmResponse(() => {
      throw new Error('Updated resource key does not match the request')
    })
  }
  return { success: true, output: { supplyRequest: item } }
}
