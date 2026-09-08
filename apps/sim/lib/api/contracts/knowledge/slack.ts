import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const slackSearchOrganizationQuerySchema = z.object({ organizationId: organizationIdSchema })
export const slackSearchInstallationSchema = z.object({
  id: z.string().min(1).max(200),
  credentialId: z.string().min(1).max(200),
  appId: z.string().min(1).max(200),
  teamId: z.string().min(1).max(200),
  teamName: z.string().min(1).max(200),
  enabled: z.boolean(),
  needsValidation: z.boolean(),
  lastOutcome: z.string().max(100).nullable(),
  lastEventAt: z.string().datetime().nullable(),
})
export const listSlackSearchResponseSchema = z.object({
  installations: z.array(slackSearchInstallationSchema).max(100),
  bots: z
    .array(z.object({ id: z.string().min(1).max(200), displayName: z.string().max(500) }))
    .max(100),
})
export type SlackSearchInstallationView = z.output<typeof slackSearchInstallationSchema>
export type SlackSearchList = z.output<typeof listSlackSearchResponseSchema>
export const listSlackSearchContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/slack',
  query: slackSearchOrganizationQuerySchema,
  response: { mode: 'json', schema: listSlackSearchResponseSchema },
})
export const configureSlackSearchBodySchema = z.object({
  organizationId: organizationIdSchema,
  credentialId: z.string().min(1).max(200),
  enabled: z.boolean(),
})
export type ConfigureSlackSearchBody = z.input<typeof configureSlackSearchBodySchema>
export const configureSlackSearchContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/slack',
  body: configureSlackSearchBodySchema,
  response: { mode: 'json', schema: z.object({ id: z.string().min(1).max(200) }) },
})
export const removeSlackSearchParamsSchema = z.object({
  installationId: z.string().min(1).max(200),
})
export const removeSlackSearchContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/slack/[installationId]',
  params: removeSlackSearchParamsSchema,
  query: slackSearchOrganizationQuerySchema,
  response: { mode: 'json', schema: z.object({ id: z.string().min(1).max(200) }) },
})
