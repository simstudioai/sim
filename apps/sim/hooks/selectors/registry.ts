import { fetchJson, fetchOAuthToken } from './helpers'
import type {
  SelectorContext,
  SelectorDefinition,
  SelectorKey,
  SelectorOption,
  SelectorQueryArgs,
} from './types'

const SELECTOR_STALE = 60 * 1000

type SlackChannel = { id: string; name: string }
type FolderResponse = { id: string; name: string }
type PlannerTask = { id: string; title: string }

const ensureCredential = (context: SelectorContext, key: SelectorKey): string => {
  if (!context.credentialId) {
    throw new Error(`Missing credential for selector ${key}`)
  }
  return context.credentialId
}

const ensureDomain = (context: SelectorContext, key: SelectorKey): string => {
  if (!context.domain) {
    throw new Error(`Missing domain for selector ${key}`)
  }
  return context.domain
}

const ensureKnowledgeBase = (context: SelectorContext): string => {
  if (!context.knowledgeBaseId) {
    throw new Error('Missing knowledge base id')
  }
  return context.knowledgeBaseId
}

const registry: Record<SelectorKey, SelectorDefinition> = {
  'slack.channels': {
    key: 'slack.channels',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'slack.channels',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const body = JSON.stringify({
        credential: context.credentialId,
        workflowId: context.workflowId,
      })
      const data = await fetchJson<{ channels: SlackChannel[] }>('/api/tools/slack/channels', {
        method: 'POST',
        body,
      })
      return (data.channels || []).map((channel) => ({
        id: channel.id,
        label: `#${channel.name}`,
      }))
    },
  },
  'gmail.labels': {
    key: 'gmail.labels',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'gmail.labels',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ labels: FolderResponse[] }>('/api/tools/gmail/labels', {
        searchParams: { credentialId: context.credentialId },
      })
      return (data.labels || []).map((label) => ({
        id: label.id,
        label: label.name,
      }))
    },
  },
  'outlook.folders': {
    key: 'outlook.folders',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'outlook.folders',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ folders: FolderResponse[] }>('/api/tools/outlook/folders', {
        searchParams: { credentialId: context.credentialId },
      })
      return (data.folders || []).map((folder) => ({
        id: folder.id,
        label: folder.name,
      }))
    },
  },
  'google.calendar': {
    key: 'google.calendar',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'google.calendar',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ calendars: { id: string; summary: string }[] }>(
        '/api/tools/google_calendar/calendars',
        { searchParams: { credentialId: context.credentialId } }
      )
      return (data.calendars || []).map((calendar) => ({
        id: calendar.id,
        label: calendar.summary,
      }))
    },
  },
  'microsoft.teams': {
    key: 'microsoft.teams',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.teams',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const body = JSON.stringify({ credential: context.credentialId })
      const data = await fetchJson<{ teams: { id: string; displayName: string }[] }>(
        '/api/tools/microsoft-teams/teams',
        { method: 'POST', body }
      )
      return (data.teams || []).map((team) => ({
        id: team.id,
        label: team.displayName,
      }))
    },
  },
  'wealthbox.contacts': {
    key: 'wealthbox.contacts',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'wealthbox.contacts',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ items: { id: string; name: string }[] }>(
        '/api/tools/wealthbox/items',
        {
          searchParams: { credentialId: context.credentialId, type: 'contact' },
        }
      )
      return (data.items || []).map((item) => ({
        id: item.id,
        label: item.name,
      }))
    },
  },
  'sharepoint.sites': {
    key: 'sharepoint.sites',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'sharepoint.sites',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/sharepoint/sites',
        {
          searchParams: { credentialId: context.credentialId },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'microsoft.planner': {
    key: 'microsoft.planner',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.planner',
      context.credentialId ?? 'none',
      context.planId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId && context.planId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const data = await fetchJson<{ tasks: PlannerTask[] }>('/api/tools/microsoft_planner/tasks', {
        searchParams: {
          credentialId: context.credentialId,
          planId: context.planId,
        },
      })
      return (data.tasks || []).map((task) => ({
        id: task.id,
        label: task.title,
      }))
    },
  },
  'jira.projects': {
    key: 'jira.projects',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'jira.projects',
      context.credentialId ?? 'none',
      context.domain ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.credentialId && context.domain),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jira.projects')
      const domain = ensureDomain(context, 'jira.projects')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Jira access token')
      }
      const data = await fetchJson<{ projects: { id: string; name: string }[] }>(
        '/api/tools/jira/projects',
        {
          searchParams: {
            domain,
            accessToken,
            query: search ?? '',
          },
        }
      )
      return (data.projects || []).map((project) => ({
        id: project.id,
        label: project.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jira.projects')
      const domain = ensureDomain(context, 'jira.projects')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Jira access token')
      }
      const data = await fetchJson<{ project?: { id: string; name: string } }>(
        '/api/tools/jira/projects',
        {
          method: 'POST',
          body: JSON.stringify({
            domain,
            accessToken,
            projectId: detailId,
          }),
        }
      )
      if (!data.project) return null
      return {
        id: data.project.id,
        label: data.project.name,
      }
    },
  },
  'jira.issues': {
    key: 'jira.issues',
    staleTime: 15 * 1000,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'jira.issues',
      context.credentialId ?? 'none',
      context.domain ?? 'none',
      context.projectId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.credentialId && context.domain),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jira.issues')
      const domain = ensureDomain(context, 'jira.issues')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Jira access token')
      }
      const data = await fetchJson<{
        sections?: { issues: { id?: string; key?: string; summary?: string }[] }[]
      }>('/api/tools/jira/issues', {
        searchParams: {
          domain,
          accessToken,
          projectId: context.projectId,
          query: search ?? '',
        },
      })
      const issues =
        data.sections?.flatMap((section) =>
          (section.issues || []).map((issue) => ({
            id: issue.id || issue.key || '',
            name: issue.summary || issue.key || '',
          }))
        ) || []
      return issues
        .filter((issue) => issue.id)
        .map((issue) => ({ id: issue.id, label: issue.name || issue.id }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jira.issues')
      const domain = ensureDomain(context, 'jira.issues')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Jira access token')
      }
      const data = await fetchJson<{ issues?: { id: string; name: string }[] }>(
        '/api/tools/jira/issues',
        {
          method: 'POST',
          body: JSON.stringify({
            domain,
            accessToken,
            issueKeys: [detailId],
          }),
        }
      )
      const issue = data.issues?.[0]
      if (!issue) return null
      return { id: issue.id, label: issue.name }
    },
  },
  'linear.teams': {
    key: 'linear.teams',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'linear.teams',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'linear.teams')
      const body = JSON.stringify({ credential: credentialId, workflowId: context.workflowId })
      const data = await fetchJson<{ teams: { id: string; name: string }[] }>(
        '/api/tools/linear/teams',
        {
          method: 'POST',
          body,
        }
      )
      return (data.teams || []).map((team) => ({
        id: team.id,
        label: team.name,
      }))
    },
  },
  'linear.projects': {
    key: 'linear.projects',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'linear.projects',
      context.credentialId ?? 'none',
      context.teamId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId && context.teamId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'linear.projects')
      const body = JSON.stringify({
        credential: credentialId,
        teamId: context.teamId,
        workflowId: context.workflowId,
      })
      const data = await fetchJson<{ projects: { id: string; name: string }[] }>(
        '/api/tools/linear/projects',
        {
          method: 'POST',
          body,
        }
      )
      return (data.projects || []).map((project) => ({
        id: project.id,
        label: project.name,
      }))
    },
  },
  'confluence.pages': {
    key: 'confluence.pages',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'confluence.pages',
      context.credentialId ?? 'none',
      context.domain ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.credentialId && context.domain),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'confluence.pages')
      const domain = ensureDomain(context, 'confluence.pages')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Confluence access token')
      }
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/confluence/pages',
        {
          method: 'POST',
          body: JSON.stringify({
            domain,
            accessToken,
            title: search,
          }),
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'confluence.pages')
      const domain = ensureDomain(context, 'confluence.pages')
      const accessToken = await fetchOAuthToken(credentialId, context.workflowId)
      if (!accessToken) {
        throw new Error('Missing Confluence access token')
      }
      const data = await fetchJson<{ id: string; title: string }>('/api/tools/confluence/page', {
        method: 'POST',
        body: JSON.stringify({
          domain,
          accessToken,
          pageId: detailId,
        }),
      })
      return { id: data.id, label: data.title }
    },
  },
  'onedrive.files': {
    key: 'onedrive.files',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'onedrive.files',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'onedrive.files')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/onedrive/files',
        {
          searchParams: { credentialId },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'onedrive.folders': {
    key: 'onedrive.folders',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'onedrive.folders',
      context.credentialId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'onedrive.folders')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/onedrive/folders',
        {
          searchParams: { credentialId },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'google.drive': {
    key: 'google.drive',
    staleTime: 15 * 1000,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'google.drive',
      context.credentialId ?? 'none',
      context.mimeType ?? 'any',
      context.fileId ?? 'root',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'google.drive')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/tools/drive/files',
        {
          searchParams: {
            credentialId,
            mimeType: context.mimeType,
            parentId: context.fileId,
            query: search,
            workflowId: context.workflowId,
          },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'google.drive')
      const data = await fetchJson<{ file?: { id: string; name: string } }>(
        '/api/tools/drive/file',
        {
          searchParams: {
            credentialId,
            fileId: detailId,
            workflowId: context.workflowId,
          },
        }
      )
      const file = data.file
      if (!file) return null
      return { id: file.id, label: file.name }
    },
  },
  'microsoft.excel': {
    key: 'microsoft.excel',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.excel',
      context.credentialId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.excel')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/auth/oauth/microsoft/files',
        {
          searchParams: {
            credentialId,
            query: search,
            workflowId: context.workflowId,
          },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'microsoft.word': {
    key: 'microsoft.word',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'microsoft.word',
      context.credentialId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.credentialId),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'microsoft.word')
      const data = await fetchJson<{ files: { id: string; name: string }[] }>(
        '/api/auth/oauth/microsoft/files',
        {
          searchParams: {
            credentialId,
            query: search,
            workflowId: context.workflowId,
          },
        }
      )
      return (data.files || []).map((file) => ({
        id: file.id,
        label: file.name,
      }))
    },
  },
  'knowledge.documents': {
    key: 'knowledge.documents',
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'knowledge.documents',
      context.knowledgeBaseId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.knowledgeBaseId),
    fetchList: async ({ context, search }: SelectorQueryArgs) => {
      const knowledgeBaseId = ensureKnowledgeBase(context)
      const data = await fetchJson<{
        data?: { documents: { id: string; filename: string }[] }
      }>(`/api/knowledge/${knowledgeBaseId}/documents`, {
        searchParams: {
          limit: 200,
          search,
        },
      })
      const documents = data.data?.documents || []
      return documents.map((doc) => ({
        id: doc.id,
        label: doc.filename,
      }))
    },
    fetchById: async ({ context, detailId }: SelectorQueryArgs) => {
      if (!detailId) return null
      const knowledgeBaseId = ensureKnowledgeBase(context)
      const data = await fetchJson<{ data?: { document?: { id: string; filename: string } } }>(
        `/api/knowledge/${knowledgeBaseId}/documents/${detailId}`,
        {
          searchParams: { includeDisabled: 'true' },
        }
      )
      const doc = data.data?.document
      if (!doc) return null
      return { id: doc.id, label: doc.filename }
    },
  },
}

export function getSelectorDefinition(key: SelectorKey): SelectorDefinition {
  const definition = registry[key]
  if (!definition) {
    throw new Error(`Missing selector definition for ${key}`)
  }
  return definition
}

export function mergeOption(options: SelectorOption[], option?: SelectorOption | null) {
  if (!option) return options
  if (options.some((item) => item.id === option.id)) {
    return options
  }
  return [option, ...options]
}
