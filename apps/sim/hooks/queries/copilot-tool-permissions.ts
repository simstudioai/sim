import { useMutation, useQueryClient } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import { copilotToolPermissionContract } from '@/lib/api/contracts/copilot'
import { generalSettingsKeys } from '@/hooks/queries/current-user-data'

type ToolDecision = 'allow' | 'allow_chat' | 'always_allow' | 'skip'

/** Answers gated tool calls. "For every chat" is a saved preference, so settings read fresh after. */
export function useDecideToolPermissions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ ids, decision }: { ids: readonly string[]; decision: ToolDecision }) =>
      requestJson(copilotToolPermissionContract, {
        body: { decisions: ids.map((toolCallId) => ({ toolCallId, decision })) },
      }),
    onSuccess: (_result, { decision }) => {
      if (decision === 'always_allow') {
        void queryClient.invalidateQueries({ queryKey: generalSettingsKeys.settings() })
      }
    },
  })
}
