import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const airtableSelectors = {
  'airtable.bases': {
    key: 'airtable.bases',
    contracts: [selectorContracts.airtableBasesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'airtable.bases',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'airtable.bases')
      const data = await requestJson(selectorContracts.airtableBasesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.bases || []).map((base) => ({
        id: base.id,
        label: base.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'airtable.bases')
      const data = await requestJson(selectorContracts.airtableBasesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          baseId: detailId,
        },
        signal,
      })
      const base = (data.bases || []).find((b) => b.id === detailId) ?? null
      if (!base) return null
      return { id: base.id, label: base.name }
    },
  },
  'airtable.tables': {
    key: 'airtable.tables',
    contracts: [selectorContracts.airtableTablesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'airtable.tables',
      context.oauthCredential ?? 'none',
      context.baseId ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.baseId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'airtable.tables')
      if (!context.baseId) {
        throw new Error('Missing base ID for airtable.tables selector')
      }
      const data = await requestJson(selectorContracts.airtableTablesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          baseId: context.baseId,
        },
        signal,
      })
      return (data.tables || []).map((table) => ({
        id: table.id,
        label: table.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'airtable.tables')
      if (!context.baseId) return null
      const data = await requestJson(selectorContracts.airtableTablesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          baseId: context.baseId,
        },
        signal,
      })
      const table = (data.tables || []).find((t) => t.id === detailId) ?? null
      if (!table) return null
      return { id: table.id, label: table.name }
    },
  },
} satisfies Record<Extract<SelectorKey, 'airtable.bases' | 'airtable.tables'>, SelectorDefinition>
