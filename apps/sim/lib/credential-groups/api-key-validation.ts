import { z } from 'zod'
import {
  CREDENTIAL_GROUP_API_KEY_MAX_LENGTH,
  CREDENTIAL_GROUP_API_KEY_MIN_LENGTH,
  CREDENTIAL_GROUP_API_KEY_OPTION_LIMIT,
} from '@/lib/credential-groups/api-key-constants'

export const credentialGroupApiKeyNameSchema = z
  .string()
  .trim()
  .min(1, 'API key name is required')
  .max(100, 'API key name must be at most 100 characters')

export const credentialGroupApiKeyOptionInputSchema = z
  .object({
    id: z.string().uuid('API key option ID is invalid').optional(),
    name: credentialGroupApiKeyNameSchema,
    description: z
      .string()
      .trim()
      .max(1000, 'Description must be at most 1000 characters')
      .nullable(),
  })
  .strict()

export const credentialGroupApiKeyOptionsInputSchema = z
  .array(credentialGroupApiKeyOptionInputSchema)
  .max(CREDENTIAL_GROUP_API_KEY_OPTION_LIMIT)
  .superRefine((options, context) => {
    const names = new Set<string>()
    const ids = new Set<string>()
    for (const [index, option] of options.entries()) {
      const name = option.name.toLowerCase()
      if (names.has(name))
        context.addIssue({
          code: 'custom',
          path: [index, 'name'],
          message: 'API key names must be unique within the group',
        })
      if (option.id && ids.has(option.id))
        context.addIssue({
          code: 'custom',
          path: [index, 'id'],
          message: 'API key option IDs must be unique',
        })
      names.add(name)
      if (option.id) ids.add(option.id)
    }
  })

export const credentialGroupApiKeyValueSchema = z
  .string()
  .min(CREDENTIAL_GROUP_API_KEY_MIN_LENGTH, 'API key must contain at least 8 characters')
  .max(CREDENTIAL_GROUP_API_KEY_MAX_LENGTH, 'API key must contain at most 4096 characters')
  .refine((value) => value.trim() === value, 'API key must not contain surrounding whitespace')
