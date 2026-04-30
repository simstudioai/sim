import { requestJson } from '@/lib/api/client/request'
import * as selectorContracts from '@/lib/api/contracts/selectors'
import { ensureCredential, SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const zoomSelectors = {
  'zoom.meetings': {
    key: 'zoom.meetings',
    contracts: [selectorContracts.zoomMeetingsSelectorContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'zoom.meetings',
      context.oauthCredential ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.oauthCredential),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      const credentialId = ensureCredential(context, 'zoom.meetings')
      const data = await requestJson(selectorContracts.zoomMeetingsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      return (data.meetings || []).map((m) => ({
        id: m.id,
        label: m.name || `Meeting ${m.id}`,
      }))
    },
    fetchById: async ({ context, detailId, signal }: SelectorQueryArgs) => {
      if (!detailId) return null
      const credentialId = ensureCredential(context, 'zoom.meetings')
      const data = await requestJson(selectorContracts.zoomMeetingsSelectorContract, {
        body: { credential: credentialId, workflowId: context.workflowId },
        signal,
      })
      const meeting = (data.meetings || []).find((m) => m.id === detailId) ?? null
      if (!meeting) return null
      return { id: meeting.id, label: meeting.name || `Meeting ${meeting.id}` }
    },
  },
} satisfies Record<Extract<SelectorKey, 'zoom.meetings'>, SelectorDefinition>
