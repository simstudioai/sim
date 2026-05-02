import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const notionSelectors = {
  'notion.databases': {
    key: 'notion.databases',
    contracts: [selectorContracts.notionDatabasesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'notion.databases',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'notion.databases')
      const data = await requestJson(selectorContracts.notionDatabasesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.databases || []).map((db) => ({
        id: db.id,
        label: db.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'notion.databases')
      const data = await requestJson(selectorContracts.notionDatabasesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const db = (data.databases || []).find((d) => d.id === detailId) ?? null
      if (!db) return null
      return { id: db.id, label: db.name }
    },
  },
  'notion.pages': {
    key: 'notion.pages',
    contracts: [selectorContracts.notionPagesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'notion.pages',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'notion.pages')
      const data = await requestJson(selectorContracts.notionPagesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.pages || []).map((page) => ({
        id: page.id,
        label: page.name,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'notion.pages')
      const data = await requestJson(selectorContracts.notionPagesSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const page = (data.pages || []).find((p) => p.id === detailId) ?? null
      if (!page) return null
      return { id: page.id, label: page.name }
    },
  },
} satisfies Record<Extract<SelectorKey, 'notion.databases' | 'notion.pages'>, SelectorDefinition>
