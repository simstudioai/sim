import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const githubToolResponseSchema = z.object({}).passthrough()

export const githubLatestCommitBodySchema = z.object({
  owner: z.string().min(1, 'Owner is required'),
  repo: z.string().min(1, 'Repo is required'),
  branch: z.string().optional().nullable(),
  apiKey: z.string().min(1, 'API key is required'),
})

export const githubLatestCommitContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/github/latest-commit',
  body: githubLatestCommitBodySchema,
  response: { mode: 'json', schema: githubToolResponseSchema },
})

export type GithubLatestCommitBody = ContractBody<typeof githubLatestCommitContract>
export type GithubLatestCommitBodyInput = ContractBodyInput<typeof githubLatestCommitContract>
export type GithubLatestCommitResponse = ContractJsonResponse<typeof githubLatestCommitContract>
