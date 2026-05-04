import { z } from 'zod'
import { workspaceCredentialSchema } from '@/lib/api/contracts/credentials'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const createAtlassianServiceAccountBodySchema = z.object({
  workspaceId: z.string().uuid('Workspace ID must be a valid UUID'),
  apiToken: z.string().trim().min(1, 'API token is required'),
  domain: z
    .string()
    .trim()
    .min(1, 'Atlassian site domain is required (e.g., your-team.atlassian.net)'),
  displayName: z.string().trim().min(1).max(255).optional(),
  description: z.string().trim().max(500).optional(),
})

export type CreateAtlassianServiceAccountBody = z.input<
  typeof createAtlassianServiceAccountBodySchema
>

export const createAtlassianServiceAccountContract = defineRouteContract({
  method: 'POST',
  path: '/api/auth/atlassian-service-account',
  body: createAtlassianServiceAccountBodySchema,
  response: {
    mode: 'json',
    schema: z.object({
      credential: workspaceCredentialSchema,
    }),
  },
})
