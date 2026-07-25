import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const linkPreviewQuerySchema = z.object({
  url: z
    .string()
    .trim()
    .min(1, 'url is required')
    .max(2048, 'url must be 2048 characters or less')
    .url('url must be a valid URL'),
})

export const linkPreviewResponseSchema = z.object({
  preview: z
    .object({
      title: z.string().nullable(),
      description: z.string().nullable(),
      siteName: z.string().nullable(),
    })
    .nullable(),
})

export type LinkPreviewQuery = z.input<typeof linkPreviewQuerySchema>
export type LinkPreviewResponse = z.output<typeof linkPreviewResponseSchema>
export type LinkPreview = LinkPreviewResponse['preview']

export const getLinkPreviewContract = defineRouteContract({
  method: 'GET',
  path: '/api/link-preview',
  query: linkPreviewQuerySchema,
  response: { mode: 'json', schema: linkPreviewResponseSchema },
})
