import { z } from 'zod'
import { idNameSchema, optionalString } from '@/lib/api/contracts/selectors/shared'
import type { ContractBody, ContractJsonResponse, ContractQuery } from '@/lib/api/contracts/types'
import { defineRouteContract } from '@/lib/api/contracts/types'

const jiraIssueSectionSchema = z
  .object({
    issues: z.array(
      z
        .object({
          id: z.string().optional(),
          key: z.string().optional(),
          summary: z.string().optional(),
        })
        .passthrough()
    ),
  })
  .passthrough()

export const jiraProjectsQuerySchema = z.object({
  domain: z.string().trim().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  query: optionalString,
})

export const jiraProjectBodySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  projectId: z.string().min(1, 'Project ID is required'),
})

/**
 * GET `/api/tools/jira/issues` query.
 */
export const jiraIssuesQuerySchema = z.object({
  domain: z.string().trim().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  projectId: optionalString,
  manualProjectId: optionalString,
  query: optionalString,
  all: z
    .preprocess(
      (value) => (typeof value === 'string' ? value.toLowerCase() === 'true' : value),
      z.boolean()
    )
    .default(false),
  limit: z
    .preprocess((value) => {
      const parsed = typeof value === 'string' ? Number.parseInt(value, 10) : value
      return typeof parsed === 'number' && Number.isFinite(parsed) && parsed > 0 ? parsed : 0
    }, z.number())
    .default(0),
})

export const jiraIssuesBodySchema = z.object({
  domain: z.string().min(1, 'Domain is required'),
  accessToken: z.string().min(1, 'Access token is required'),
  cloudId: optionalString,
  issueKeys: z.array(z.string().min(1)).default([]),
})

export const jiraProjectsSelectorContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/jira/projects',
  query: jiraProjectsQuerySchema,
  response: {
    mode: 'json',
    schema: z
      .object({ projects: z.array(idNameSchema), cloudId: z.string().optional() })
      .passthrough(),
  },
})

export const jiraProjectSelectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/jira/projects',
  body: jiraProjectBodySchema,
  response: {
    mode: 'json',
    schema: z
      .object({ project: idNameSchema.optional(), cloudId: z.string().optional() })
      .passthrough(),
  },
})

export const jiraIssuesSelectorContract = defineRouteContract({
  method: 'GET',
  path: '/api/tools/jira/issues',
  query: jiraIssuesQuerySchema,
  response: {
    mode: 'json',
    schema: z
      .object({
        sections: z.array(jiraIssueSectionSchema).optional(),
        cloudId: z.string().optional(),
      })
      .passthrough(),
  },
})

export const jiraIssueSelectorContract = defineRouteContract({
  method: 'POST',
  path: '/api/tools/jira/issues',
  body: jiraIssuesBodySchema,
  response: {
    mode: 'json',
    schema: z
      .object({ issues: z.array(idNameSchema).optional(), cloudId: z.string().optional() })
      .passthrough(),
  },
})

export type JiraProjectsQuery = ContractQuery<typeof jiraProjectsSelectorContract>
export type JiraProjectBody = ContractBody<typeof jiraProjectSelectorContract>
export type JiraIssuesQuery = ContractQuery<typeof jiraIssuesSelectorContract>
export type JiraIssuesBody = ContractBody<typeof jiraIssueSelectorContract>
export type JiraProjectsSelectorResponse = ContractJsonResponse<typeof jiraProjectsSelectorContract>
export type JiraProjectSelectorResponse = ContractJsonResponse<typeof jiraProjectSelectorContract>
export type JiraIssuesSelectorResponse = ContractJsonResponse<typeof jiraIssuesSelectorContract>
export type JiraIssueSelectorResponse = ContractJsonResponse<typeof jiraIssueSelectorContract>
