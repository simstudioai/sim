import { z } from 'zod'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

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
export type GitHubSearchInstallation = z.output<typeof githubSearchInstallationSchema>

export const listGitHubSearchInstallationsQuerySchema = z.object({
  organizationId: organizationIdSchema,
})
export type ListGitHubSearchInstallationsQuery = z.input<
  typeof listGitHubSearchInstallationsQuerySchema
>

export const listGitHubSearchInstallationsResponseSchema = z.object({
  success: z.literal(true),
  available: z.boolean(),
  installUrl: z
    .string()
    .max(2000)
    .regex(
      /^https:\/\/github\.com\/apps\/[a-z0-9-]+\/installations\/new$/,
      'GitHub installation URL must use the configured GitHub App'
    )
    .nullable(),
  needsUserConnection: z.boolean(),
  installations: z.array(githubSearchInstallationSchema).max(1000),
})
export type ListGitHubSearchInstallationsResponse = z.output<
  typeof listGitHubSearchInstallationsResponseSchema
>

export const listGitHubSearchInstallationsContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/github/installations',
  query: listGitHubSearchInstallationsQuerySchema,
  response: { mode: 'json', schema: listGitHubSearchInstallationsResponseSchema },
})

export const connectGitHubSearchInstallationBodySchema = z
  .object({
    organizationId: organizationIdSchema,
    installationId: githubInstallationIdSchema,
  })
  .strict()
export type ConnectGitHubSearchInstallationBody = z.input<
  typeof connectGitHubSearchInstallationBodySchema
>

export const connectGitHubSearchInstallationResponseSchema = z.object({
  success: z.literal(true),
  credential: z.object({
    id: z.string().min(1).max(200),
    displayName: z.string().min(1).max(500),
  }),
})
export type ConnectGitHubSearchInstallationResponse = z.output<
  typeof connectGitHubSearchInstallationResponseSchema
>

export const connectGitHubSearchInstallationContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/github/installations',
  body: connectGitHubSearchInstallationBodySchema,
  response: { mode: 'json', schema: connectGitHubSearchInstallationResponseSchema },
})
