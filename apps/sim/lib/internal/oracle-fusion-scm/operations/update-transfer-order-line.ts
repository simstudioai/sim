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

/** Oracle 26C contract: op-transferorders-headerid-child-transferorderlines-transferorderlinesuniqid-patch.html */
const bodySchema = z
  .object({
    Action: z.string().nullable().optional(),
    RequestedQuantity: z.number().finite().optional(),
    SecondaryRequestedQuantity: z.number().finite().nullable().optional(),
    NeedByDate: z.string().datetime({ offset: true }).optional(),
    ScheduledShipDate: z.string().datetime({ offset: true }).nullable().optional(),
    Comments: z.string().max(240).nullable().optional(),
    SourceOrganizationId: oracleFusionScmIntegerInput('int64').optional(),
    SourceOrganizationCode: z.string().max(18).nullable().optional(),
    SourceSubinventoryCode: z.string().max(10).nullable().optional(),
    DestinationSubinventoryCode: z.string().max(10).nullable().optional(),
    SourceLocatorId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    DestinationLocatorId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    NoteToReceiver: z.string().max(1000).nullable().optional(),
    NoteToSupplier: z.string().max(1000).nullable().optional(),
    ShipmentPriority: z.string().max(255).nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update')

const inputSchema = oracleFusionScmMutationInputSchema(bodySchema, [
  'transferOrderKey',
  'transferOrderLineKey',
])

/** Updates the documented transfer order line fields without numeric identifier rounding. */
export async function executeOracleFusionScmUpdateTransferOrderLine(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  const collection = oracleFusionScmCollectionPath('transferOrderLines', input)
  const resourceKey = oracleFusionScmOpaqueKeySchema.parse(input.transferOrderLineKey)
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
    projectOracleFusionScmResource('transferOrderLines', payload, input.instanceUrl, collection)
  )
  if (item.transferOrderLineKey !== resourceKey) {
    return unexpectedOracleFusionScmResponse(() => {
      throw new Error('Updated resource key does not match the request')
    })
  }
  return { success: true, output: { transferOrderLine: item } }
}
