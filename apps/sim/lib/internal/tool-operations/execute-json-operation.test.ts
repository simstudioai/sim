import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { OutboundRoutingError } from '@/lib/core/network/routing'
import { executeInternalJsonToolOperation } from '@/lib/internal/tool-operations/execute-json-operation'

const contract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/example',
  body: z.object({ value: z.number() }),
  response: { mode: 'json', schema: z.object({ ok: z.boolean() }) },
})

describe('executeInternalJsonToolOperation', () => {
  it("answers an unavailable egress route as Sim's outage, not a failed operation", async () => {
    const response = await executeInternalJsonToolOperation(
      contract,
      { value: 1 },
      async () => {
        throw new OutboundRoutingError('GATEWAY_UNAVAILABLE')
      },
      'Example operation failed'
    )

    expect(response.status).toBe(503)
    await expect(response.json()).resolves.toEqual({
      error: "The organization's egress route is unavailable",
    })
  })
})
