import { z } from 'zod'

export const MAX_ORGANIZATION_SECRETS = 200
export const MAX_SECRET_VALUE_BYTES = 64 * 1024
export const MAX_SECRET_ENVIRONMENT_BYTES = 256 * 1024
export const MAX_SECRET_CIPHERTEXT_BYTES = 1024 * 1024
export const MAX_MOUNTED_SECRET_NAMES = 100

export const secretSourceModeSchema = z.enum(['organization', 'member'])
export type SecretSourceMode = z.infer<typeof secretSourceModeSchema>

export const organizationSecretNameSchema = z
  .string()
  .min(1, 'Secret name cannot be empty')
  .max(1024)
  .regex(
    /^[A-Za-z_][A-Za-z0-9_]*$/,
    'Use letters, numbers, and underscores; start with a letter or underscore'
  )

export const secretVariablesSchema = z
  .record(organizationSecretNameSchema, z.string().max(MAX_SECRET_VALUE_BYTES))
  .superRefine((variables, context) => {
    if (Object.keys(variables).length > MAX_ORGANIZATION_SECRETS) {
      context.addIssue({
        code: 'custom',
        message: `Use at most ${MAX_ORGANIZATION_SECRETS} secrets`,
      })
    }
    const encoder = new TextEncoder()
    let bytes = 0
    for (const [name, value] of Object.entries(variables)) {
      const valueBytes = encoder.encode(value).byteLength
      bytes += valueBytes
      if (valueBytes > MAX_SECRET_VALUE_BYTES) {
        context.addIssue({ code: 'custom', path: [name], message: 'Secret value exceeds 64 KB' })
      }
    }
    if (bytes > MAX_SECRET_ENVIRONMENT_BYTES) {
      context.addIssue({ code: 'custom', message: 'Secrets exceed the 256 KB total limit' })
    }
  })

export const secretChangesSchema = z
  .object({
    upsert: secretVariablesSchema,
    remove: z.array(organizationSecretNameSchema).max(MAX_ORGANIZATION_SECRETS),
  })
  .strict()
export type SecretChanges = z.infer<typeof secretChangesSchema>

export const mountedSecretNamesSchema = z
  .array(organizationSecretNameSchema)
  .max(MAX_MOUNTED_SECRET_NAMES)
