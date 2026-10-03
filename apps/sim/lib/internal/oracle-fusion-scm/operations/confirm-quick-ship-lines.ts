import { z } from 'zod'
import { requestOracleFusionJson } from '@/lib/internal/oracle-fusion/client'
import { unexpectedOracleFusionScmResponse } from '@/lib/internal/oracle-fusion-scm/operations/read-resource'
import { oracleFusionScmMutationInputSchema } from '@/lib/internal/oracle-fusion-scm/schema'
import type { ToolResponse } from '@/tools/types'

const inputSchema = oracleFusionScmMutationInputSchema(
  z
    .object({
      details: z
        .array(
          z
            .object({
              ShipmentLine: z.string().min(1).max(128),
            })
            .strict()
        )
        .min(1)
        .max(100),
    })
    .strict()
)

/** Oracle documents a dynamic result map, not a fixed status/message envelope. */
const responseSchema = z.object({
  result: z.record(z.string(), z.array(z.record(z.string(), z.string()))),
})

/** Confirms only quick-ship eligible lines in a quick-ship enabled organization. */
export async function executeOracleFusionScmConfirmQuickShipLines(
  rawInput: unknown,
  signal?: AbortSignal
): Promise<ToolResponse> {
  const input = inputSchema.parse(rawInput)
  const payload = await requestOracleFusionJson(
    input,
    {
      method: 'POST',
      address: { family: 'fscm', relativePath: 'shipmentLineChangeRequests/action/confirm' },
      mediaType: 'application/vnd.oracle.adf.action+json',
      body: input.body,
    },
    signal
  )
  const output = unexpectedOracleFusionScmResponse(() => responseSchema.parse(payload))
  return { success: true, output }
}
