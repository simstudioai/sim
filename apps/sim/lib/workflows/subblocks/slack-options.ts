import { requestJson } from '@/lib/api/client/request'
import { slackChannelsSelectorContract } from '@/lib/api/contracts/selectors'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface SubBlockOption {
  label: string
  id: string
}

/**
 * Loads the Slack channels visible to the trigger's bot token for
 * multi-select subblocks (`fetchOptions`). Reads the sibling `botToken`
 * sub-block value; the `/api/tools/slack/channels` route accepts raw
 * `xoxb-` tokens directly, so no OAuth credential is required.
 *
 * Returns an empty list when no bot token is configured yet — the dropdown
 * stays empty until the token is pasted (it re-fetches via `dependsOn`).
 */
export async function fetchSlackChannelOptionsForTrigger(
  blockId: string
): Promise<SubBlockOption[]> {
  const botToken = useSubBlockStore.getState().getValue(blockId, 'botToken')
  if (typeof botToken !== 'string' || !botToken.trim().startsWith('xoxb-')) {
    return []
  }

  const workflowId = useWorkflowRegistry.getState().activeWorkflowId

  try {
    const data = await requestJson(slackChannelsSelectorContract, {
      body: {
        credential: botToken.trim(),
        workflowId: workflowId ?? undefined,
      },
    })
    return (data.channels || []).map((channel) => ({
      id: channel.id,
      label: `#${channel.name}`,
    }))
  } catch {
    return []
  }
}

/** Resolves a stored channel ID to its `#name` label for dropdown hydration. */
export async function fetchSlackChannelOptionByIdForTrigger(
  blockId: string,
  optionId: string
): Promise<SubBlockOption | null> {
  const options = await fetchSlackChannelOptionsForTrigger(blockId)
  return options.find((o) => o.id === optionId) ?? null
}
