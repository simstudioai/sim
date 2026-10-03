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

/** Oracle 26C contract: op-workorders-post.html */
const bodySchema = z
  .object({
    InventoryItemId: oracleFusionScmIntegerInput('int64'),
    PlannedStartQuantity: z.number().finite(),
    WorkOrderType: z.string().max(30).min(1),
    OrganizationId: oracleFusionScmIntegerInput('int64').optional(),
    OrganizationCode: z.string().max(18).nullable().optional(),
    WorkOrderNumber: z.string().max(120).nullable().optional(),
    WorkOrderDescription: z.string().max(240).nullable().optional(),
    WorkOrderStatusCode: z.string().max(255).nullable().optional(),
    WorkOrderSubType: z.string().max(30).nullable().optional(),
    WorkOrderPriority: z.number().finite().nullable().optional(),
    PlannedStartDate: z.string().datetime({ offset: true }).nullable().optional(),
    PlannedCompletionDate: z.string().datetime({ offset: true }).nullable().optional(),
    WorkDefinitionId: oracleFusionScmIntegerInput('int64').nullable().optional(),
    WorkDefinitionCode: z.string().max(255).nullable().optional(),
    SupplyType: z.string().max(30).nullable().optional(),
  })
  .strict()

const inputSchema = oracleFusionScmMutationInputSchema(bodySchema, [])

/** Creates the documented manufacturing work order fields without numeric identifier rounding. */
export async function executeOracleFusionScmCreateManufacturingWorkOrder(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  const collection = oracleFusionScmCollectionPath('manufacturingWorkOrders', input)
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
    projectOracleFusionScmResource(
      'manufacturingWorkOrders',
      payload,
      input.instanceUrl,
      collection
    )
  )
  return { success: true, output: { manufacturingWorkOrder: item } }
}
