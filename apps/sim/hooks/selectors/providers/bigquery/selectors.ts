import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const bigquerySelectors = {
  'bigquery.datasets': {
    key: 'bigquery.datasets',
    contracts: [selectorContracts.bigQueryDatasetsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'bigquery.datasets',
      context.oauthCredential ?? 'none',
      context.projectId ?? 'none',
      context.impersonateUserEmail ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential && context.projectId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'bigquery.datasets')
      if (!context.projectId) throw new Error('Missing project ID for bigquery.datasets selector')
      const data = await requestJson(selectorContracts.bigQueryDatasetsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          projectId: context.projectId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      return (data.datasets || []).map((ds) => ({
        id: ds.datasetReference.datasetId,
        label: ds.friendlyName || ds.datasetReference.datasetId,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId || !context.projectId) return null
      const credentialId = ensureCredential(context, 'bigquery.datasets')
      const data = await requestJson(selectorContracts.bigQueryDatasetsSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          projectId: context.projectId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      const ds =
        (data.datasets || []).find((d) => d.datasetReference.datasetId === detailId) ?? null
      if (!ds) return null
      return {
        id: ds.datasetReference.datasetId,
        label: ds.friendlyName || ds.datasetReference.datasetId,
      }
    },
  },
  'bigquery.tables': {
    key: 'bigquery.tables',
    contracts: [selectorContracts.bigQueryTablesSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'bigquery.tables',
      context.oauthCredential ?? 'none',
      context.projectId ?? 'none',
      context.datasetId ?? 'none',
      context.impersonateUserEmail ?? 'none',
    ],
    enabled: ({ context }) =>
      Boolean(context.oauthCredential && context.projectId && context.datasetId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'bigquery.tables')
      if (!context.projectId) throw new Error('Missing project ID for bigquery.tables selector')
      if (!context.datasetId) throw new Error('Missing dataset ID for bigquery.tables selector')
      const data = await requestJson(selectorContracts.bigQueryTablesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          projectId: context.projectId,
          datasetId: context.datasetId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      return (data.tables || []).map((t) => ({
        id: t.tableReference.tableId,
        label: t.friendlyName || t.tableReference.tableId,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId || !context.projectId || !context.datasetId) return null
      const credentialId = ensureCredential(context, 'bigquery.tables')
      const data = await requestJson(selectorContracts.bigQueryTablesSelectorContract, {
        body: {
          credential: credentialId,
          workflowId: context.workflowId,
          projectId: context.projectId,
          datasetId: context.datasetId,
          impersonateEmail: context.impersonateUserEmail,
        },
        signal,
      })
      const t = (data.tables || []).find((tbl) => tbl.tableReference.tableId === detailId) ?? null
      if (!t) return null
      return { id: t.tableReference.tableId, label: t.friendlyName || t.tableReference.tableId }
    },
  },
} satisfies Record<
  Extract<SelectorKey, 'bigquery.datasets' | 'bigquery.tables'>,
  SelectorDefinition
>
