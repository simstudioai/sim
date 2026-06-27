import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
import { FileInputSchema } from '@/lib/uploads/utils/file-schemas'

/**
 * Internal contracts for the UptimeRobot public-status-page (PSP) create/update
 * routes. Those endpoints accept `multipart/form-data` (for optional logo/icon
 * image uploads), so the tools post a JSON envelope to these internal routes,
 * which download the referenced files from storage and forward a multipart
 * request to UptimeRobot.
 */

const pspSchema = z.object({
  id: z.number(),
  friendlyName: z.string(),
  customDomain: z.string().nullable(),
  isPasswordSet: z.boolean().nullable(),
  monitorIds: z.array(z.number()),
  tagIds: z.array(z.number()),
  monitorsCount: z.number().nullable(),
  status: z.string().nullable(),
  urlKey: z.string().nullable(),
  homepageLink: z.string().nullable(),
  gaCode: z.string().nullable(),
  icon: z.string().nullable(),
  logo: z.string().nullable(),
  noIndex: z.boolean().nullable(),
  hideUrlLinks: z.boolean().nullable(),
  subscription: z.boolean().nullable(),
})

const pspRouteResponseSchema = z.object({
  success: z.boolean(),
  output: z.object({ psp: pspSchema }).optional(),
  error: z.string().optional(),
})

const pspSharedFields = {
  apiKey: z.string().min(1, 'API key is required'),
  monitorIds: z
    .string()
    .optional()
    .nullable()
    .describe('Comma-separated monitor IDs to display on the page'),
  status: z.enum(['ENABLED', 'PAUSED']).optional().nullable(),
  password: z.string().max(255).optional().nullable(),
  customDomain: z.string().max(255).optional().nullable(),
  hideUrlLinks: z.boolean().optional().nullable(),
  noIndex: z.boolean().optional().nullable(),
  logo: FileInputSchema.optional().nullable(),
  icon: FileInputSchema.optional().nullable(),
}

export const uptimeRobotCreatePspBodySchema = z.object({
  ...pspSharedFields,
  friendlyName: z.string().min(1, 'friendlyName is required').max(255),
})

export type UptimeRobotCreatePspBody = z.input<typeof uptimeRobotCreatePspBodySchema>

export const uptimeRobotCreatePspContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/uptimerobot/create-psp',
  body: uptimeRobotCreatePspBodySchema,
  response: { mode: 'json', schema: pspRouteResponseSchema },
})

export const uptimeRobotUpdatePspBodySchema = z.object({
  ...pspSharedFields,
  pspId: z.number().int().min(1, 'pspId is required'),
  friendlyName: z.string().max(255).optional().nullable(),
})

export type UptimeRobotUpdatePspBody = z.input<typeof uptimeRobotUpdatePspBodySchema>

export const uptimeRobotUpdatePspContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/uptimerobot/update-psp',
  body: uptimeRobotUpdatePspBodySchema,
  response: { mode: 'json', schema: pspRouteResponseSchema },
})
