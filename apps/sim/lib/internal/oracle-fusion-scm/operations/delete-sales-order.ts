import { z } from 'zod'
import { requestOracleFusionEmpty } from '@/lib/internal/oracle-fusion/client'
import { encodeOracleFusionPathSegment } from '@/lib/internal/oracle-fusion/protocol'
import {
  oracleFusionScmAuthShape,
  oracleFusionScmOpaqueKeySchema,
} from '@/lib/internal/oracle-fusion-scm/schema'
import type { ToolResponse } from '@/tools/types'

const inputSchema = z
  .object({
    ...oracleFusionScmAuthShape,
    salesOrderKey: oracleFusionScmOpaqueKeySchema,
  })
  .strict()

/** Deletes a deletable sales order; Oracle enforces the order's lifecycle and permissions. */
export async function executeOracleFusionScmDeleteSalesOrder(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  await requestOracleFusionEmpty(
    input,
    {
      method: 'DELETE',
      address: {
        family: 'fscm',
        relativePath: `salesOrdersForOrderHub/${encodeOracleFusionPathSegment(input.salesOrderKey)}`,
      },
    },
    signal
  )
  return { success: true, output: { deleted: true, salesOrderKey: input.salesOrderKey } }
}
