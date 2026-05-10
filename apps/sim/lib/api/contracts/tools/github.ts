import { z } from 'zod'
import type {
  ContractBody,
  ContractBodyInput,
  ContractJsonResponse,
} from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const githubUserSummarySchema = z.object({
  name: z.string(),
  login: z.string(),
  avatar_url: z.string(),
  html_url: z.string(),
})

const githubCommitFileSchema = z.object({
  filename: z.string(),
  additions: z.number(),
  deletions: z.number(),
  changes: z.number(),
  status: z.string(),
  raw_url: z.string().nullable().optional(),
  blob_url: z.string().nullable().optional(),
  patch: z.string().optional(),
  content: z.string().optional(),
})

export const githubLatestCommitResponseSchema = z.object({
  success: z.literal(true),
  output: z.object({
    content: z.string(),
    metadata: z.object({
      sha: z.string(),
      html_url: z.string(),
      commit_message: z.string(),
      author: githubUserSummarySchema,
      committer: githubUserSummarySchema,
      stats: z
        .object({
          additions: z.number(),
          deletions: z.number(),
          total: z.number(),
        })
        .optional(),
      files: z.array(githubCommitFileSchema).optional(),
    }),
  }),
})

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
  response: { mode: 'json', schema: githubLatestCommitResponseSchema },
})

export type GithubLatestCommitBody = ContractBody<typeof githubLatestCommitContract>
export type GithubLatestCommitBodyInput = ContractBodyInput<typeof githubLatestCommitContract>
export type GithubLatestCommitResponse = ContractJsonResponse<typeof githubLatestCommitContract>
