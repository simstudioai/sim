import { z } from 'zod'
import { type ContractJsonResponse, defineRouteContract } from '@/lib/api/contracts/types'
import { isSameOrigin } from '@/lib/core/utils/validation'

export const userProfileSchema = z.object({
  id: z.string(),
  name: z.string(),
  email: z.string(),
  image: z.string().nullable(),
  emailVerified: z.boolean().optional(),
})

export type UserProfileApiUser = z.output<typeof userProfileSchema>

export const getUserProfileContract = defineRouteContract({
  method: 'GET',
  path: '/api/users/me/profile',
  response: {
    mode: 'json',
    schema: z.object({
      user: userProfileSchema,
    }),
  },
})

export const updateUserProfileBodySchema = z
  .object({
    name: z.string().min(1, 'Name is required').optional(),
    image: z
      .string()
      .refine(
        (val) => val.startsWith('http://') || val.startsWith('https://') || val.startsWith('/api/'),
        { message: 'Invalid image URL' }
      )
      .nullable()
      .optional(),
  })
  .refine((data) => data.name !== undefined || data.image !== undefined, {
    message: 'At least one field (name or image) must be provided',
  })

export type UpdateUserProfileBody = z.input<typeof updateUserProfileBodySchema>

export const updateUserProfileContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/users/me/profile',
  body: updateUserProfileBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      user: userProfileSchema,
    }),
  },
})

export const userSettingsEmailPreferencesSchema = z.object({
  unsubscribeAll: z.boolean().optional(),
  unsubscribeMarketing: z.boolean().optional(),
  unsubscribeUpdates: z.boolean().optional(),
  unsubscribeNotifications: z.boolean().optional(),
})

export const mothershipEnvironmentSchema = z.enum(['default', 'dev', 'staging', 'prod'])
export type MothershipEnvironment = z.infer<typeof mothershipEnvironmentSchema>

/** An IANA timezone identifier (e.g. `America/New_York`), validated against the runtime's zone database. */
export const ianaTimezoneSchema = z.string().refine(
  (tz) => {
    try {
      new Intl.DateTimeFormat('en-US', { timeZone: tz })
      return true
    } catch {
      return false
    }
  },
  { message: 'Must be a valid IANA timezone (e.g. America/New_York)' }
)

export const userSettingsSchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).default('system'),
  autoConnect: z.boolean().default(true),
  telemetryEnabled: z.boolean().default(true),
  emailPreferences: userSettingsEmailPreferencesSchema.optional().default({}),
  billingUsageNotificationsEnabled: z.boolean().default(true),
  showTrainingControls: z.boolean().default(false),
  superUserModeEnabled: z.boolean().default(false),
  mothershipEnvironment: mothershipEnvironmentSchema.default('default'),
  errorNotificationsEnabled: z.boolean().default(true),
  snapToGridSize: z.number().min(0).max(50).default(0),
  showActionBar: z.boolean().default(true),
  /** IANA timezone for scheduling; `null` means the client falls back to the browser-detected zone. */
  timezone: z.string().nullable().default(null),
  lastActiveWorkspaceId: z.string().nullable().optional(),
})

export type UserSettingsApi = z.output<typeof userSettingsSchema>

export const updateUserSettingsBodySchema = z.object({
  theme: z.enum(['system', 'light', 'dark']).optional(),
  autoConnect: z.boolean().optional(),
  telemetryEnabled: z.boolean().optional(),
  emailPreferences: userSettingsEmailPreferencesSchema.optional(),
  billingUsageNotificationsEnabled: z.boolean().optional(),
  showTrainingControls: z.boolean().optional(),
  superUserModeEnabled: z.boolean().optional(),
  mothershipEnvironment: mothershipEnvironmentSchema.optional(),
  errorNotificationsEnabled: z.boolean().optional(),
  snapToGridSize: z.number().min(0).max(50).optional(),
  showActionBar: z.boolean().optional(),
  /** IANA timezone; explicit `null` resets to the browser-detected zone. */
  timezone: ianaTimezoneSchema.nullable().optional(),
  /** Mirrors `userSettingsSchema.lastActiveWorkspaceId` so explicit `null` is accepted to clear the active workspace. */
  lastActiveWorkspaceId: z.string().nullable().optional(),
})

export const getUserSettingsContract = defineRouteContract({
  method: 'GET',
  path: '/api/users/me/settings',
  response: {
    mode: 'json',
    schema: z.object({
      data: userSettingsSchema,
    }),
  },
})

export const updateUserSettingsContract = defineRouteContract({
  method: 'PATCH',
  path: '/api/users/me/settings',
  body: updateUserSettingsBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const forgetPasswordBodySchema = z.object({
  email: z.string({ error: 'Email is required' }).email('Please provide a valid email address'),
  redirectTo: z
    .string()
    .optional()
    .or(z.literal(''))
    .transform((val) => (val === '' || val === undefined ? undefined : val))
    .refine(
      (val) => val === undefined || (z.string().url().safeParse(val).success && isSameOrigin(val)),
      {
        message: 'Redirect URL must be a valid same-origin URL',
      }
    ),
})

export type ForgetPasswordBody = z.input<typeof forgetPasswordBodySchema>

export const forgetPasswordContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/forget-password',
  body: forgetPasswordBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const resetPasswordBodySchema = z.object({
  token: z.string({ error: 'Token is required' }).min(1, 'Token is required'),
  newPassword: z
    .string({ error: 'Password is required' })
    .min(8, 'Password must be at least 8 characters long')
    .max(100, 'Password must not exceed 100 characters')
    .regex(/[A-Z]/, 'Password must contain at least one uppercase letter')
    .regex(/[a-z]/, 'Password must contain at least one lowercase letter')
    .regex(/[0-9]/, 'Password must contain at least one number')
    .regex(/[^A-Za-z0-9]/, 'Password must contain at least one special character'),
})

export type ResetPasswordBody = z.input<typeof resetPasswordBodySchema>

export const resetPasswordContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/reset-password',
  body: resetPasswordBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
    }),
  },
})

export const unsubscribeBodySchema = z.object({
  email: z.string().email('Invalid email address'),
  token: z.string().min(1, 'Token is required'),
  type: z.enum(['all', 'marketing', 'updates', 'notifications']).optional().default('all'),
})

export const unsubscribeQuerySchema = z.object({
  email: z.string().min(1),
  token: z.string().min(1),
})

const unsubscribePreferencesSchema = z
  .object({
    unsubscribeAll: z.boolean().optional(),
    unsubscribeMarketing: z.boolean().optional(),
    unsubscribeUpdates: z.boolean().optional(),
    unsubscribeNotifications: z.boolean().optional(),
  })
  .passthrough()

export const unsubscribeGetResponseSchema = z.object({
  success: z.literal(true),
  email: z.string(),
  token: z.string(),
  emailType: z.string(),
  isTransactional: z.boolean(),
  currentPreferences: unsubscribePreferencesSchema,
})

export const unsubscribeActionResponseSchema = z.object({
  success: z.literal(true),
  message: z.string(),
  email: z.string(),
  type: z.enum(['all', 'marketing', 'updates', 'notifications']),
  emailType: z.string(),
})

export const unsubscribeGetContract = defineRouteContract({
  method: 'GET',
  path: '/api/users/me/settings/unsubscribe',
  query: unsubscribeQuerySchema,
  response: {
    mode: 'json',
    schema: unsubscribeGetResponseSchema,
  },
})

export const unsubscribeFormContract = defineRouteContract({
  method: 'POST',
  path: '/api/users/me/settings/unsubscribe',
  query: unsubscribeQuerySchema,
  response: {
    mode: 'json',
    schema: unsubscribeActionResponseSchema,
  },
})

export const unsubscribePostContract = defineRouteContract({
  method: 'POST',
  path: '/api/users/me/settings/unsubscribe',
  body: unsubscribeBodySchema,
  response: {
    mode: 'json',
    schema: unsubscribeActionResponseSchema,
  },
})

export type UnsubscribeData = ContractJsonResponse<typeof unsubscribeGetContract>
export type UnsubscribeActionResponse = ContractJsonResponse<typeof unsubscribePostContract>
export type UnsubscribeBody = z.input<typeof unsubscribeBodySchema>
export type UnsubscribeType = NonNullable<UnsubscribeBody['type']>

export const usageLogSourceSchema = z.enum([
  'workflow',
  'wand',
  'copilot',
  'workspace-chat',
  'mcp_copilot',
  'mothership_block',
  'knowledge-base',
  'voice-input',
  'enrichment',
])

export const usageLogPeriodSchema = z.enum(['1d', '7d', '30d', 'all', 'custom'])

/**
 * `Date`-constructor-parseable string — the {@link Calendar} range picker
 * emits local `YYYY-MM-DDTHH:mm`, not strict ISO 8601, so this validates
 * parseability rather than a specific wire format.
 */
const parseableDateSchema = z
  .string()
  .min(1)
  .refine((value) => !Number.isNaN(Date.parse(value)), { error: 'Invalid date' })

/** Shared by the paginated list query and the export query — filters only, no pagination. */
const usageLogsFilterSchema = z.object({
  source: usageLogSourceSchema.optional(),
  workspaceId: z.string().optional(),
  period: usageLogPeriodSchema.optional().default('30d'),
  /** Required when `period` is `'custom'`. */
  startDate: parseableDateSchema.optional(),
  /** Defaults to now when omitted for `'custom'`. */
  endDate: parseableDateSchema.optional(),
})

/** Both the list and export query schemas require startDate whenever period is 'custom'. */
function requireStartDateForCustomPeriod<
  Schema extends z.ZodType<{ period?: string; startDate?: string }>,
>(schema: Schema) {
  return schema.refine((query) => query.period !== 'custom' || query.startDate !== undefined, {
    error: 'startDate is required when period is "custom"',
    path: ['startDate'],
  })
}

export const usageLogsQuerySchema = requireStartDateForCustomPeriod(
  usageLogsFilterSchema.extend({
    limit: z.coerce.number().min(1).max(100).optional().default(50),
    cursor: z.string().optional(),
  })
)

/** Same filters as the list query, without pagination — the export route returns every match. */
export const exportUsageLogsQuerySchema = requireStartDateForCustomPeriod(usageLogsFilterSchema)

export const usageLogEntrySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  source: usageLogSourceSchema,
  /** Specific workflow name, populated only when `source` is `'workflow'`. */
  workflowName: z.string().nullable(),
  /**
   * Credit-denominated cost of this event (Sim's usage unit; 1,000 credits =
   * $5), apportioned across the page so row credits always sum exactly to
   * the page's rounded total — this can legitimately be 0 for a row with a
   * real but sub-credit `dollarCost` once a sibling row absorbs the shared
   * rounding remainder.
   */
  creditCost: z.number(),
  /** Raw dollar cost, so a 0 `creditCost` can be distinguished from a genuinely free event. */
  dollarCost: z.number(),
})

export const usageLogsApiResponseSchema = z.object({
  success: z.boolean(),
  logs: z.array(usageLogEntrySchema),
  summary: z.object({
    totalCredits: z.number(),
    bySourceCredits: z.record(z.string(), z.number()),
  }),
  pagination: z.object({
    nextCursor: z.string().optional(),
    hasMore: z.boolean(),
  }),
})

export const getUsageLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/users/me/usage-logs',
  query: usageLogsQuerySchema,
  response: {
    mode: 'json',
    schema: usageLogsApiResponseSchema,
  },
})

/**
 * CSV download of every usage log matching the filter (no pagination). `mode:
 * 'text'` because a CSV response has no JSON schema to validate; the client
 * triggers this as a plain browser download (an anchor navigation), never
 * through `requestJson`, so there's no response shape for a consumer to type.
 */
export const exportUsageLogsContract = defineRouteContract({
  method: 'GET',
  path: '/api/users/me/usage-logs/export',
  query: exportUsageLogsQuerySchema,
  response: {
    mode: 'text',
  },
})

export type UsageLogSource = z.output<typeof usageLogSourceSchema>
export type UsageLogPeriod = z.output<typeof usageLogPeriodSchema>
export type UsageLogEntry = z.output<typeof usageLogEntrySchema>
export type UsageLogsApiResponse = z.output<typeof usageLogsApiResponseSchema>
export type ExportUsageLogsQuery = z.output<typeof exportUsageLogsQuerySchema>

export const subscriptionTransferParamsSchema = z.object({
  id: z.string({ error: 'Subscription ID is required' }).min(1, 'Subscription ID is required'),
})

export const subscriptionTransferBodySchema = z.object({
  organizationId: z
    .string({ error: 'organizationId is required' })
    .min(1, 'organizationId is required'),
})

export const subscriptionTransferContract = defineRouteContract({
  method: 'POST',
  path: '/api/users/me/subscription/[id]/transfer',
  params: subscriptionTransferParamsSchema,
  body: subscriptionTransferBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      success: z.literal(true),
      message: z.string(),
    }),
  },
})
