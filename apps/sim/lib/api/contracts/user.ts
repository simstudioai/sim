import { z } from 'zod'
import { defineRouteContract } from '@/lib/api/contracts/types'
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

export const usageLogsQuerySchema = z.object({
  source: z.enum(['workflow', 'wand', 'copilot']).optional(),
  workspaceId: z.string().optional(),
  period: z.enum(['1d', '7d', '30d', 'all']).optional().default('30d'),
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  cursor: z.string().optional(),
})

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
