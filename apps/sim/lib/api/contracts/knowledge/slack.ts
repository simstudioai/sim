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
  appKind: z.enum(['custom', 'shared']),
  enabled: z.boolean(),
  needsValidation: z.boolean(),
  lastOutcome: z.string().max(100).nullable(),
  lastEventAt: z.string().datetime().nullable(),
})
export const listSlackSearchResponseSchema = z.object({
  sharedAppAvailable: z.boolean(),
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

export const prepareSlackSearchBodySchema = z.object({
  organizationId: organizationIdSchema,
  name: z.string().trim().min(1).max(35),
  description: z.string().trim().min(1).max(140),
})
export type PrepareSlackSearchBody = z.input<typeof prepareSlackSearchBodySchema>
export const prepareSlackSearchContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/slack/setup',
  body: prepareSlackSearchBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      sharedAppId: z.string().min(1).max(200).nullable(),
      manifest: z.string().max(20_000),
      existingApp: z
        .object({ appId: z.string().min(1).max(200), teamId: z.string().min(1).max(200) })
        .nullable(),
      createAppUrl: z.string().url().max(30_000),
    }),
  },
})

export const startSlackSearchOAuthBodySchema = prepareSlackSearchBodySchema.extend({
  mode: z.enum(['custom', 'shared']).default('custom'),
  installationId: z.string().min(1).max(200).optional(),
  clientId: z.string().trim().min(1).max(200).optional(),
  clientSecret: z.string().trim().min(1).max(500).optional(),
  signingSecret: z.string().trim().min(1).max(500).optional(),
})
export type StartSlackSearchOAuthBody = z.input<typeof startSlackSearchOAuthBodySchema>
export const startSlackSearchOAuthContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/slack/oauth',
  body: startSlackSearchOAuthBodySchema,
  response: { mode: 'json', schema: z.object({ authorizationUrl: z.string().url().max(4000) }) },
})

export const slackSearchOAuthCallbackQuerySchema = z.object({
  state: z.string().min(1).max(200),
  code: z.string().min(1).max(2000).optional(),
  error: z.string().min(1).max(200).optional(),
})
export type SlackSearchOAuthCallbackQuery = z.input<typeof slackSearchOAuthCallbackQuerySchema>
export const slackSearchOAuthCallbackContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/slack/oauth/callback',
  query: slackSearchOAuthCallbackQuerySchema,
  response: { mode: 'redirect' },
})

export const slackSearchOnboardingInputSchema = z.object({ token: z.string().uuid() })
export type SlackSearchOnboardingInput = z.input<typeof slackSearchOnboardingInputSchema>
export const slackSearchOnboardingViewSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('wrong_account') }),
  z.object({ status: z.literal('verify_email') }),
  z.object({ status: z.literal('membership_required') }),
  z.object({ status: z.literal('identity_conflict') }),
  z.object({
    status: z.enum(['needs_sources', 'ready', 'retried']),
    organizationId: organizationIdSchema,
    isAdmin: z.boolean(),
    question: z.string().min(1).max(2000),
    slackUrl: z.string().url().max(3000),
  }),
])
export type SlackSearchOnboardingView = z.output<typeof slackSearchOnboardingViewSchema>
export const getSlackSearchOnboardingContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/slack/onboarding',
  query: slackSearchOnboardingInputSchema,
  response: { mode: 'json', schema: slackSearchOnboardingViewSchema },
})
export const retrySlackSearchOnboardingContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/slack/onboarding/retry',
  body: slackSearchOnboardingInputSchema,
  response: { mode: 'json', schema: z.object({ slackUrl: z.string().url().max(3000) }) },
})
