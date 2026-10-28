import { z } from 'zod'

export const githubInstallationIdSchema = z
  .string()
  .max(32)
  .regex(/^[1-9]\d*$/, 'GitHub installation ID must be a positive integer')

export const githubSearchInstallationSchema = z.object({
  installationId: githubInstallationIdSchema,
  accountId: z
    .string()
    .max(32)
    .regex(/^[1-9]\d*$/, 'GitHub account ID must be a positive integer'),
  accountLogin: z.string().min(1).max(100),
  accountType: z.enum(['User', 'Organization']),
})
