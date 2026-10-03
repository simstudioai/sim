import { z } from 'zod'
import {
  githubInstallationIdSchema,
  githubSearchInstallationSchema,
} from '@/lib/api/contracts/knowledge/github-installations'
import { organizationIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const gitHubSearchSetupScopeSchema = z
  .object({
    organizationId: organizationIdSchema,
    setupId: z.string().uuid('GitHub setup ID must be a UUID'),
  })
  .strict()
export type GitHubSearchSetupScope = z.input<typeof gitHubSearchSetupScopeSchema>

export const gitHubSearchSetupStatusSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('pending') }),
  z.object({
    status: z.literal('choosing'),
    installations: z.array(githubSearchInstallationSchema).min(1).max(1000),
  }),
  z.object({
    status: z.literal('completed'),
    credential: z.object({
      id: z.string().min(1).max(200),
      displayName: z.string().min(1).max(500),
    }),
  }),
  z.object({ status: z.literal('failed'), error: z.string().min(1).max(1000) }),
  z.object({ status: z.literal('expired') }),
])
export type GitHubSearchSetupStatus = z.output<typeof gitHubSearchSetupStatusSchema>

export const startGitHubSearchSetupResponseSchema = z.object({
  success: z.literal(true),
  url: z.string().url().max(8192),
})
export type StartGitHubSearchSetupResponse = z.output<typeof startGitHubSearchSetupResponseSchema>
export const startGitHubSearchSetupBodySchema = gitHubSearchSetupScopeSchema.extend({
  intent: z.literal('install').optional(),
})
export type StartGitHubSearchSetupBody = z.input<typeof startGitHubSearchSetupBodySchema>
export const startGitHubSearchSetupContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/github/setup',
  body: startGitHubSearchSetupBodySchema,
  response: { mode: 'json', schema: startGitHubSearchSetupResponseSchema },
})

export const readGitHubSearchSetupResponseSchema = z.object({
  success: z.literal(true),
  data: gitHubSearchSetupStatusSchema,
})
export type ReadGitHubSearchSetupResponse = z.output<typeof readGitHubSearchSetupResponseSchema>
export const readGitHubSearchSetupContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/github/setup',
  query: gitHubSearchSetupScopeSchema,
  response: { mode: 'json', schema: readGitHubSearchSetupResponseSchema },
})

export const cancelGitHubSearchSetupResponseSchema = z.object({ success: z.literal(true) })
export type CancelGitHubSearchSetupResponse = z.output<typeof cancelGitHubSearchSetupResponseSchema>
export const cancelGitHubSearchSetupContract = defineRouteContract({
  method: 'DELETE',
  path: '/api/knowledge/github/setup',
  body: gitHubSearchSetupScopeSchema,
  response: { mode: 'json', schema: cancelGitHubSearchSetupResponseSchema },
})

export const selectGitHubSearchSetupBodySchema = gitHubSearchSetupScopeSchema.extend({
  action: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('select'), installationId: githubInstallationIdSchema }).strict(),
    z.object({ kind: z.literal('install') }).strict(),
  ]),
})
export type SelectGitHubSearchSetupBody = z.input<typeof selectGitHubSearchSetupBodySchema>
export const selectGitHubSearchSetupContract = defineRouteContract({
  method: 'POST',
  path: '/api/knowledge/github/setup/selection',
  body: selectGitHubSearchSetupBodySchema,
  response: { mode: 'json', schema: startGitHubSearchSetupResponseSchema },
})

export const continueGitHubSearchSetupQuerySchema = gitHubSearchSetupScopeSchema.extend({
  oauth: z.string().min(1).max(100).optional(),
})
export type ContinueGitHubSearchSetupQuery = z.input<typeof continueGitHubSearchSetupQuerySchema>
export const continueGitHubSearchSetupContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/github/setup/continue',
  query: continueGitHubSearchSetupQuerySchema,
  response: { mode: 'redirect' },
})

export const completeGitHubSearchSetupQuerySchema = z.object({
  state: z.string().uuid('GitHub setup state must be a UUID'),
  installation_id: githubInstallationIdSchema.optional(),
  setup_action: z.string().min(1).max(40).optional(),
})
export type CompleteGitHubSearchSetupQuery = z.input<typeof completeGitHubSearchSetupQuerySchema>
export const completeGitHubSearchSetupContract = defineRouteContract({
  method: 'GET',
  path: '/api/knowledge/github/setup/callback',
  query: completeGitHubSearchSetupQuerySchema,
  response: { mode: 'redirect' },
})
