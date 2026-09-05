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

/** Oracle 26C contract: op-maintenanceworkorders-workorderid-patch.html */
const bodySchema = z
  .object({
    PlannedStartQuantity: z.number().finite().optional(),
    UOMCode: z.string().max(3).optional(),
    WorkOrderDescription: z.string().max(240).nullable().optional(),
    WorkOrderStatusCode: z.string().max(255).nullable().optional(),
    WorkOrderSubTypeCode: z.string().max(30).nullable().optional(),
    WorkOrderPriority: z.number().finite().nullable().optional(),
    PlannedStartDate: z.string().datetime({ offset: true }).nullable().optional(),
    PlannedCompletionDate: z.string().datetime({ offset: true }).nullable().optional(),
    WorkDefinitionId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    AssetId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    AssetNumber: z.string().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update')

const inputSchema = oracleFusionScmMutationInputSchema(bodySchema, ['maintenanceWorkOrderKey'])

/** Updates the documented maintenance work order fields without numeric identifier rounding. */
export async function executeOracleFusionScmUpdateMaintenanceWorkOrder(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  const collection = oracleFusionScmCollectionPath('maintenanceWorkOrders', input)
  const resourceKey = oracleFusionScmOpaqueKeySchema.parse(input.maintenanceWorkOrderKey)
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
    projectOracleFusionScmResource('maintenanceWorkOrders', payload, input.instanceUrl, collection)
  )
  if (item.maintenanceWorkOrderKey !== resourceKey) {
    return unexpectedOracleFusionScmResponse(() => {
      throw new Error('Updated resource key does not match the request')
    })
  }
  return { success: true, output: { maintenanceWorkOrder: item } }
}
