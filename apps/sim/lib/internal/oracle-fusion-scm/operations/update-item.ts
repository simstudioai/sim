import { z } from 'zod'
import { requestOracleFusionJson } from '@/lib/internal/oracle-fusion/client'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'
import {
  oracleFusionScmCollectionPath,
  projectOracleFusionScmResource,
  unexpectedOracleFusionScmResponse,
} from '@/lib/internal/oracle-fusion-scm/operations/read-resource'
import {
  oracleFusionScmMutationInputSchema,
  oracleFusionScmOpaqueKeySchema,
} from '@/lib/internal/oracle-fusion-scm/schema'
import type { ToolResponse } from '@/tools/types'

/** Oracle 26C contract: op-itemsv2-itemsv2uniqid-patch.html */
const bodySchema = z
  .object({
    ItemDescription: z.string().max(240).nullable().optional(),
    LongDescription: z.string().max(4000).nullable().optional(),
    ItemStatusValue: z.string().nullable().optional(),
    LifecyclePhaseValue: z.string().nullable().optional(),
    PrimaryUOMValue: z.string().nullable().optional(),
    SecondaryUOMValue: z.string().nullable().optional(),
    InventoryItemFlag: z.boolean().nullable().optional(),
    StockEnabledFlag: z.boolean().nullable().optional(),
    ShippableFlag: z.boolean().nullable().optional(),
    BuildInWIPFlag: z.boolean().nullable().optional(),
    LotControlValue: z.string().nullable().optional(),
    SerialGenerationValue: z.string().nullable().optional(),
  })
  .strict()
  .refine((body) => Object.keys(body).length > 0, 'Provide at least one field to update')

const inputSchema = oracleFusionScmMutationInputSchema(bodySchema, ['itemKey'])

/** Updates the documented item fields without numeric identifier rounding. */
export async function executeOracleFusionScmUpdateItem(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  const collection = oracleFusionScmCollectionPath('items', input)
  const resourceKey = oracleFusionScmOpaqueKeySchema.parse(input.itemKey)
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
    projectOracleFusionScmResource('items', payload, input.instanceUrl, collection)
  )
  if (item.itemKey !== resourceKey) {
    return unexpectedOracleFusionScmResponse(() => {
      throw new Error('Updated resource key does not match the request')
    })
  }
  return { success: true, output: { item } }
}
