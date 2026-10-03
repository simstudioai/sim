import { z } from 'zod'
import { jobIdParamsSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

const NO_EMAIL_HEADER_CONTROL_CHARS_REGEX = /^[^\r\n\u0000-\u001F\u007F]+$/

export const helpFormBodySchema = z.object({
  subject: z
    .string()
    .trim()
    .min(1, 'Subject is required')
    .regex(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX, 'Invalid characters'),
  message: z.string().min(1, 'Message is required'),
  type: z.enum(['bug', 'feedback', 'feature_request', 'other']),
})
export type HelpFormBody = z.input<typeof helpFormBodySchema>

export const integrationRequestBodySchema = z.object({
  integrationName: z
    .string()
    .trim()
    .min(1, 'Integration name is required')
    .max(200)
    .regex(NO_EMAIL_HEADER_CONTROL_CHARS_REGEX, 'Invalid characters'),
  email: z.string().email('A valid email is required'),
  useCase: z.string().max(2000).optional(),
})
export type IntegrationRequestBody = z.input<typeof integrationRequestBodySchema>

export const integrationRequestResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
})

export const integrationRequestContract = defineRouteContract({
  method: 'POST',
  path: '/api/help/integration-request',
  body: integrationRequestBodySchema,
  response: {
    mode: 'json',
    schema: integrationRequestResponseSchema,
  },
})

export const getAllowedProvidersContract = defineRouteContract({
  method: 'GET',
  path: '/api/settings/allowed-providers',
  response: {
    mode: 'json',
    schema: z.object({
      blacklistedProviders: z.array(z.string()),
    }),
  },
})

export const integrationAvailabilitySchema = z.object({
  type: z.string().min(1),
  state: z.enum(['ready', 'limited', 'unavailable', 'misconfigured']),
  oauthAvailable: z.boolean(),
})

export type IntegrationAvailabilityResponse = z.output<typeof integrationAvailabilitySchema>

export const oauthServiceAvailabilitySchema = z.object({
  providerId: z.string().min(1).max(200),
  available: z.boolean(),
})

export type OAuthServiceAvailabilityResponse = z.output<typeof oauthServiceAvailabilitySchema>

export const getAllowedIntegrationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/settings/allowed-integrations',
  response: {
    mode: 'json',
    schema: z.object({
      // `null` means "no env-derived allowlist" (unrestricted); a non-null
      // array narrows the visible integrations.
      allowedIntegrations: z.array(z.string()).nullable(),
      integrationAvailability: z.array(integrationAvailabilitySchema),
      oauthServiceAvailability: z.array(oauthServiceAvailabilitySchema).max(1000),
    }),
  },
})

export type GetAllowedIntegrationsResponse = z.output<
  typeof getAllowedIntegrationsContract.response.schema
>

export const getVoiceSettingsContract = defineRouteContract({
  method: 'GET',
  path: '/api/settings/voice',
  response: {
    mode: 'json',
    schema: z.object({
      sttAvailable: z.boolean(),
    }),
  },
})

export const getStarsContract = defineRouteContract({
  method: 'GET',
  path: '/api/stars',
  response: {
    mode: 'json',
    schema: z.object({
      stars: z.string(),
    }),
  },
})

const jobStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled'])

const jobStatusResponseSchema = z
  .object({
    success: z.literal(true),
    taskId: z.string(),
    status: jobStatusSchema,
    metadata: z.record(z.string(), z.unknown()).nullable().optional(),
    output: z.unknown().optional(),
    error: z.string().optional(),
  })
  .passthrough()

export const getJobStatusContract = defineRouteContract({
  method: 'GET',
  path: '/api/jobs/[jobId]',
  params: jobIdParamsSchema,
  response: {
    mode: 'json',
    schema: jobStatusResponseSchema,
  },
})
