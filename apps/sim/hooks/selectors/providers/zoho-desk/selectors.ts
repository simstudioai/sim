import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const zohoDeskSelectors = {
  'zoho_desk.organizations': {
    key: 'zoho_desk.organizations',
    contracts: [selectorContracts.zohoDeskOrganizationsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'zoho_desk.organizations',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'zoho_desk.organizations')
      const data = await requestJson(selectorContracts.zohoDeskOrganizationsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.organizations || []).map((organization) => ({
        id: organization.id,
        label: organization.name,
      }))
    },
  },
  'zoho_desk.departments': {
    key: 'zoho_desk.departments',
    contracts: [selectorContracts.zohoDeskDepartmentsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'zoho_desk.departments',
      context.oauthCredential ?? 'none',
      context.orgId ?? 'none',
    ],
    // Every Desk call but `/organizations` is scoped by the `orgId` header, so
    // the organization must be chosen before departments can be listed.
    enabled: ({ context }) => Boolean(context.oauthCredential && context.orgId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'zoho_desk.departments')
      if (!context.orgId) {
        throw new Error('Missing organization ID for zoho_desk.departments selector')
      }
      const data = await requestJson(selectorContracts.zohoDeskDepartmentsSelectorContract, {
        body: {
          credential: credentialId,
          orgId: context.orgId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.departments || []).map((department) => ({
        id: department.id,
        label: department.name,
      }))
    },
  },
  'zoho_desk.agents': {
    key: 'zoho_desk.agents',
    contracts: [selectorContracts.zohoDeskAgentsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'zoho_desk.agents',
      context.oauthCredential ?? 'none',
      context.orgId ?? 'none',
    ],
    // Same `orgId` header scoping as departments: the organization must be
    // chosen before agents can be listed.
    enabled: ({ context }) => Boolean(context.oauthCredential && context.orgId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'zoho_desk.agents')
      if (!context.orgId) {
        throw new Error('Missing organization ID for zoho_desk.agents selector')
      }
      const data = await requestJson(selectorContracts.zohoDeskAgentsSelectorContract, {
        body: {
          credential: credentialId,
          orgId: context.orgId,
          workflowId: context.workflowId,
        },
        signal,
      })
      return (data.agents || []).map((agent) => ({
        id: agent.id,
        label: agent.name,
      }))
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'zoho_desk.organizations' | 'zoho_desk.departments' | 'zoho_desk.agents'>,
  SelectorDefinition
>
