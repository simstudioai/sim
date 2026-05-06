import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { fetchOAuthToken } from '@/hooks/selectors/helpers'
import { ensureCredential, ensureDomain, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const jiraSelectors = {
  'jira.projects': {
    key: 'jira.projects',
    contracts: [
      selectorContracts.jiraProjectsSelectorContract,
      selectorContracts.jiraProjectSelectorContract,
    ],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'jira.projects',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jira.projects')
      const domain = ensureDomain(context, 'jira.projects')
      const bundle = await fetchOAuthToken(credentialId, context.workflowId)
      if (!bundle) {
        throw new Error('Missing Jira access token')
      }
      const data = await requestJson(selectorContracts.jiraProjectsSelectorContract, {
        query: {
          domain,
          accessToken: bundle.accessToken,
          cloudId: bundle.cloudId,
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
      const bundle = await fetchOAuthToken(credentialId, context.workflowId)
      if (!bundle) {
        throw new Error('Missing Jira access token')
      }
      const data = await requestJson(selectorContracts.jiraProjectSelectorContract, {
        body: {
          domain,
          accessToken: bundle.accessToken,
          cloudId: bundle.cloudId,
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
    staleTime: 15 * 1000,
    getQueryKey: ({ context, search }: SelectorQueryArgs) => [
      'selectors',
      'jira.issues',
      context.oauthCredential ?? 'none',
      context.domain ?? 'none',
      context.projectId ?? 'none',
      search ?? '',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.domain),
    fetchList: async ({ context, search, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'jira.issues')
      const domain = ensureDomain(context, 'jira.issues')
      const bundle = await fetchOAuthToken(credentialId, context.workflowId)
      if (!bundle) {
        throw new Error('Missing Jira access token')
      }
      const data = await requestJson(selectorContracts.jiraIssuesSelectorContract, {
        query: {
          domain,
          accessToken: bundle.accessToken,
          cloudId: bundle.cloudId,
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
      const bundle = await fetchOAuthToken(credentialId, context.workflowId)
      if (!bundle) {
        throw new Error('Missing Jira access token')
      }
      const data = await requestJson(selectorContracts.jiraIssueSelectorContract, {
        body: {
          domain,
          accessToken: bundle.accessToken,
          cloudId: bundle.cloudId,
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
