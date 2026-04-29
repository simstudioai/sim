import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'

const ALLOWED_TELEMETRY_CATEGORIES = [
  'page_view',
  'feature_usage',
  'performance',
  'error',
  'workflow',
  'consent',
  'batch',
] as const

export const telemetryCategorySchema = z.enum([...ALLOWED_TELEMETRY_CATEGORIES] as [
  string,
  ...string[],
])
export type TelemetryCategory = z.output<typeof telemetryCategorySchema>

const SENSITIVE_PATTERNS = [/password/, /token/, /secret/, /key/, /auth/, /credential/, /private/]

export const telemetryEventSchema = z
  .object({
    category: telemetryCategorySchema,
    action: z.string().min(1),
  })
  .passthrough()
  .refine(
    (data) => {
      const jsonStr = JSON.stringify(data).toLowerCase()
      return !SENSITIVE_PATTERNS.some((pattern) => pattern.test(jsonStr))
    },
    { message: 'Telemetry data contains sensitive information' }
  )
export type TelemetryEvent = z.output<typeof telemetryEventSchema>

export const telemetryContract = defineRouteContract({
  method: 'POST',
  path: '/api/telemetry',
  body: telemetryEventSchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      forwarded: z.boolean(),
    }),
  },
})
