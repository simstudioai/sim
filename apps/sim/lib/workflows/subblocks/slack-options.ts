import { requestJson } from '@/lib/api/client/request'
import { slackChannelsSelectorContract } from '@/lib/api/contracts/selectors'
import { fetchPersonalEnvironment } from '@/lib/environment/api'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import { extractEnvVarName, isEnvVarReference } from '@/executor/constants'
import { environmentKeys } from '@/hooks/queries/environment'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'

interface SubBlockOption {
  label: string
  id: string
}

/**
 * Reads the sibling `botToken` sub-block and resolves `{{ENV_VAR}}`
 * references through the personal environment — the same resolution the
 * selector infrastructure performs in `useSelectorSetup` — so tokens stored
 * as env references work just like literal `xoxb-` tokens.
 */
async function resolveBotToken(blockId: string): Promise<string | null> {
  const raw = useSubBlockStore.getState().getValue(blockId, 'botToken')
  if (typeof raw !== 'string') return null

  let token = raw.trim()
  if (!token) return null

  if (isEnvVarReference(token)) {
    const envVariables = await getQueryClient().fetchQuery({
      queryKey: environmentKeys.personal(),
      queryFn: ({ signal }: { signal?: AbortSignal }) => fetchPersonalEnvironment(signal),
      staleTime: 60 * 1000,
    })
    token = envVariables[extractEnvVarName(token)]?.value?.trim() ?? ''
  }

  return token.startsWith('xoxb-') ? token : null
}

/**
 * Loads the Slack channels visible to the trigger's bot token for
 * multi-select subblocks (`fetchOptions`). The `/api/tools/slack/channels`
 * route accepts raw `xoxb-` tokens directly, so no OAuth credential is
 * required.
 *
 * Returns an empty list when no usable bot token is configured yet — the
 * dropdown stays empty until the token is set (it re-fetches via `dependsOn`).
 */
export async function fetchSlackChannelOptionsForTrigger(
  blockId: string
): Promise<SubBlockOption[]> {
  const botToken = await resolveBotToken(blockId)
  if (!botToken) return []

  const workflowId = useWorkflowRegistry.getState().activeWorkflowId

  try {
    const data = await requestJson(slackChannelsSelectorContract, {
      body: {
        credential: botToken,
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
