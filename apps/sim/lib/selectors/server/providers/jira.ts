import { z } from 'zod'
import { getScopesForService } from '@/lib/oauth/utils'
import { MAX_SELECTOR_OPTIONS } from '@/lib/selectors/limits'
import type { ServerSelectorKey } from '@/lib/selectors/manifest'
import {
  SelectorContextUnavailableError,
  SelectorOptionsUnavailableError,
} from '@/lib/selectors/server/errors'
import { resolveSelectorAtlassianCloudId } from '@/lib/selectors/server/providers/atlassian'
import { resolveSelectorCredentialBundle } from '@/lib/selectors/server/providers/credential-bundle'
import { fetchProviderJson } from '@/lib/selectors/server/providers/provider-http'
import {
  detailSelectorResult,
  type ExecuteServerSelectorArgs,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

type JiraSelectorKey = Extract<ServerSelectorKey, 'jira.projects' | 'jira.issues'>

const JIRA_SCOPES = getScopesForService('jira')
const JIRA_PROJECTS_PAGE_SIZE = 50
const JIRA_ISSUES_LIMIT = 25

const jiraProjectSchema = z.object({
  id: z.string().min(1).max(100),
  name: z.string().min(1).max(1_000),
})

const jiraProjectPageSchema = z.object({
  values: z.array(jiraProjectSchema).max(JIRA_PROJECTS_PAGE_SIZE).optional(),
  isLast: z.boolean().optional(),
  maxResults: z.number().int().positive().max(JIRA_PROJECTS_PAGE_SIZE).optional(),
})

const jiraIssueSchema = z.object({
  key: z.string().min(1).max(100),
  fields: z
    .object({
      summary: z.string().max(10_000).nullable().optional(),
    })
    .optional(),
})

const jiraIssuePageSchema = z.object({
  issues: z.array(jiraIssueSchema).max(100).optional(),
})

function requirePathId(value: string | undefined): string {
  const trimmed = value?.trim() ?? ''
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(trimmed)) {
    throw new SelectorContextUnavailableError()
  }
  return trimmed
}

function requireIssueKey(value: string): string {
  const trimmed = value.trim()
  if (!/^[A-Za-z][A-Za-z0-9_]*-\d+$/.test(trimmed)) {
    throw new SelectorContextUnavailableError()
  }
  return trimmed
}

function escapeJql(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
}

async function resolveJiraAuth(args: ExecuteServerSelectorArgs) {
  const bundle = await resolveSelectorCredentialBundle({
    credential: args.credential,
    scopes: JIRA_SCOPES,
    protectedValues: args.protectedValues,
    recordCredentialUse: args.recordCredentialUse,
    providerId: 'jira',
  })
  const cloudId = await resolveSelectorAtlassianCloudId({
    accessToken: bundle.accessToken,
    domain: args.context.domain,
    providedCloudId: bundle.cloudId,
    providedDomain: bundle.domain,
    product: 'Jira',
    signal: args.signal,
  })
  return { accessToken: bundle.accessToken, cloudId }
}

function jiraHeaders(accessToken: string) {
  return { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
}

async function listProjects(args: ExecuteServerSelectorArgs) {
  const auth = await resolveJiraAuth(args)
  const cursor = args.request.kind === 'list' ? args.request.cursor : undefined
  if (cursor && !/^\d{1,10}$/.test(cursor)) {
    throw new SelectorContextUnavailableError()
  }
  const startAt = cursor ? Number(cursor) : 0
  if (!Number.isSafeInteger(startAt) || startAt < 0 || startAt > MAX_SELECTOR_OPTIONS) {
    throw new SelectorContextUnavailableError()
  }

  const url = new URL(`https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/project/search`)
  if (args.request.kind === 'list' && args.request.search) {
    url.searchParams.set('query', args.request.search)
  }
  url.searchParams.set('orderBy', 'name')
  url.searchParams.set('expand', 'description,lead,url,projectKeys')
  url.searchParams.set('startAt', String(startAt))
  url.searchParams.set('maxResults', String(JIRA_PROJECTS_PAGE_SIZE))

  const body = await fetchProviderJson<unknown>(url, {
    headers: jiraHeaders(auth.accessToken),
    redirect: 'error',
    signal: args.signal,
  })
  const parsed = jiraProjectPageSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  const values = parsed.data.values ?? []
  const pageSize = parsed.data.maxResults ?? JIRA_PROJECTS_PAGE_SIZE
  const nextStartAt = startAt + values.length
  if (parsed.data.isLast === false && values.length === 0) {
    throw new SelectorOptionsUnavailableError()
  }
  const hasMore =
    parsed.data.isLast === false || (parsed.data.isLast === undefined && values.length >= pageSize)

  return {
    items: values.map((project) => ({ id: project.id, label: project.name })),
    nextCursor: hasMore ? String(nextStartAt) : undefined,
  }
}

async function getProject(args: ExecuteServerSelectorArgs, projectId: string) {
  const auth = await resolveJiraAuth(args)
  const body = await fetchProviderJson<unknown>(
    `https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/project/${encodeURIComponent(projectId)}`,
    {
      headers: jiraHeaders(auth.accessToken),
      redirect: 'error',
      signal: args.signal,
    }
  )
  const parsed = jiraProjectSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return { id: parsed.data.id, label: parsed.data.name }
}

async function fetchIssues(
  args: ExecuteServerSelectorArgs,
  issueKey?: string
): Promise<Array<{ id: string; label: string }>> {
  const auth = await resolveJiraAuth(args)
  const jqlParts: string[] = []

  if (issueKey) {
    jqlParts.push(`issueKey = "${escapeJql(issueKey)}"`)
  } else {
    const projectId = args.context.projectId
    const search = args.request.kind === 'list' ? args.request.search : undefined
    if (!projectId && !search) return []
    if (projectId) jqlParts.push(`project = "${escapeJql(requirePathId(projectId))}"`)
    if (search) {
      const escaped = escapeJql(search)
      jqlParts.push(`(key ~ "${escaped}" OR summary ~ "${escaped}")`)
    }
  }

  const url = new URL(`https://api.atlassian.com/ex/jira/${auth.cloudId}/rest/api/3/search/jql`)
  url.searchParams.set(
    'jql',
    issueKey ? jqlParts.join(' AND ') : `${jqlParts.join(' AND ')} ORDER BY updated DESC`
  )
  url.searchParams.set('fields', 'summary,key,updated')
  url.searchParams.set('maxResults', String(issueKey ? 1 : JIRA_ISSUES_LIMIT))

  const body = await fetchProviderJson<unknown>(url, {
    headers: jiraHeaders(auth.accessToken),
    redirect: 'error',
    signal: args.signal,
  })
  const parsed = jiraIssuePageSchema.safeParse(body)
  if (!parsed.success) throw new SelectorOptionsUnavailableError()
  return (parsed.data.issues ?? []).map((issue) => ({
    id: issue.key,
    label: issue.fields?.summary || issue.key,
  }))
}

async function executeProjects(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    return detailSelectorResult(await getProject(args, requirePathId(args.request.id)))
  }
  const result = await listProjects(args)
  return listSelectorResult(result.items, result.nextCursor)
}

async function executeIssues(args: ExecuteServerSelectorArgs) {
  if (args.request.kind === 'detail') {
    const issues = await fetchIssues(args, requireIssueKey(args.request.id))
    const issue = issues[0]
    return detailSelectorResult(issue ? { ...issue, id: args.request.id } : null)
  }
  return listSelectorResult(await fetchIssues(args))
}

const credential = { kind: 'stored', field: 'oauthCredential', serviceIds: ['jira'] } as const

export const jiraSelectorAttachments = {
  'jira.projects': {
    credential,
    destination: 'fixed',
    auditCredentialUse: true,
    execute: executeProjects,
  },
  'jira.issues': {
    credential,
    destination: 'fixed',
    auditCredentialUse: true,
    execute: executeIssues,
  },
} satisfies ServerSelectorAttachmentMap<JiraSelectorKey>
