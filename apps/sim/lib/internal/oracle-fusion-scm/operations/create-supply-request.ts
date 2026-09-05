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

/** Oracle 26C contract: op-supplyrequests-post.html */
const lineSchema = z
  .object({
    InterfaceBatchNumber: z.string().max(50).min(1),
    ProcessStatus: z.string().max(30).min(1),
    Quantity: z.number().finite(),
    SupplyType: z.string().max(30).min(1),
    UOMCode: z.string().max(3).min(1),
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
    InterfaceBatchNumber: z.string().max(50).min(1),
    InterfaceSourceCode: z.string().max(30).nullable().optional(),
    SupplyOrderSource: z.string().max(30).min(1),
    SupplyRequestDate: z.string().min(1).datetime({ offset: true }),
    SupplyRequestStatus: z.string().max(30).min(1),
    TrustedSource: oracleFusionScmIntegerInput('int32'),
    SupplyOrderReferenceId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    SupplyOrderReferenceNumber: z.string().max(200).nullable().optional(),
    ProcessRequestFlag: z.boolean().nullable().optional(),
    AllowPartialRequestFlag: z.boolean().nullable().optional(),
    supplyRequestLines: z.array(lineSchema).min(1).max(100),
  })
  .strict()

const inputSchema = oracleFusionScmMutationInputSchema(bodySchema, [])

/** Creates the documented supply request fields without numeric identifier rounding. */
export async function executeOracleFusionScmCreateSupplyRequest(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  const collection = oracleFusionScmCollectionPath('supplyRequests', input)
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
    projectOracleFusionScmResource('supplyRequests', payload, input.instanceUrl, collection)
  )
  return { success: true, output: { supplyRequest: item } }
}
