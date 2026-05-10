import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const communicationToolResponseSchema = z.unknown()
export const slackBlocksSchema = z.array(z.record(z.string(), z.unknown()))
export const discordIdSchema = z.union([z.string(), z.number()])

export const discordRequiredIdSchema = (message: string) =>
  z.preprocess(
    (value) => (value === null || value === undefined ? '' : value),
    discordIdSchema.refine((value) => value !== '', { message })
  )

export const discordBotTokenSelectorSchema = z.preprocess(
  (value) => (value === null || value === undefined ? '' : value),
  z.string().min(1, 'Bot token is required')
)

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
