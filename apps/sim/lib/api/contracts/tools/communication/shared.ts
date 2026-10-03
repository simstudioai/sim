import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const communicationToolResponseSchema = z.unknown()
export const slackBlocksSchema = z.array(z.record(z.string(), z.unknown()))

export const defineCommunicationToolContract = <TBody extends z.ZodType>(
  path: string,
  body: TBody
) =>
  defineRouteContract({
    method: 'POST',
    path,
    body,
    response: {
      mode: 'json',
      schema: communicationToolResponseSchema,
    },
  })
