import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import {
  ensureCredential,
  ensureDomain,
  SELECTOR_SEARCH_STALE,
  SELECTOR_STALE,
} from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const jiraSelectors = {
  'jira.projects': {
    key: 'jira.projects',
    contracts: [
      selectorContracts.jiraProjectsSelectorContract,
      selectorContracts.jiraProjectSelectorContract,
    ],
    serverResolvedContextFields: ['domain'],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'jira.projects',
      context.oauthCredential ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jira.projects')
      const domain = ensureDomain(context, 'jira.projects')
      const data = await requestJson(selectorContracts.jiraProjectsSelectorContract, {
        query: {
          credential: credentialId,
          ...(context.workflowId ? { workflowId: context.workflowId } : {}),
          domain,
          query: search,
        },
        signal,
      })
      return (data.projects || []).map((project) => ({
        id: project.id,
        label: project.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jira.projects')
      const domain = ensureDomain(context, 'jira.projects')
      const data = await requestJson(selectorContracts.jiraProjectSelectorContract, {
        body: {
          credential: credentialId,
          ...(context.workflowId ? { workflowId: context.workflowId } : {}),
          domain,
          projectId: detailId,
        },
        signal,
      })
      if (!data.project) return null
      return {
        id: data.project.id,
        label: data.project.name,
      }
    },
  },
  'jira.issues': {
    key: 'jira.issues',
    contracts: [
      selectorContracts.jiraIssuesSelectorContract,
      selectorContracts.jiraIssueSelectorContract,
    ],
    serverResolvedContextFields: ['domain'],
    staleTime: SELECTOR_SEARCH_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'jira.issues',
      context.oauthCredential ?? 'none',
      context.projectId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jira.issues')
      const domain = ensureDomain(context, 'jira.issues')
      const data = await requestJson(selectorContracts.jiraIssuesSelectorContract, {
        query: {
          credential: credentialId,
          ...(context.workflowId ? { workflowId: context.workflowId } : {}),
          domain,
          projectId: context.projectId,
          query: search,
        },
        signal,
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
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'jira.issues')
      const domain = ensureDomain(context, 'jira.issues')
      const data = await requestJson(selectorContracts.jiraIssueSelectorContract, {
        body: {
          credential: credentialId,
          ...(context.workflowId ? { workflowId: context.workflowId } : {}),
          domain,
          issueKeys: [detailId],
        },
        signal,
      })
      const issue = data.issues?.[0]
      if (!issue) return null
      return { id: issue.id, label: issue.name }
    },
  },
} satisfies Record<Extract<SelectorKey, 'jira.projects' | 'jira.issues'>, SelectorDefinition>
