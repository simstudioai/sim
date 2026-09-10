import { executeCopilotOrganizationKnowledgeUseCase } from '@/lib/copilot/application/execute-knowledge-use-case'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { requestSlackApi } from '@/lib/internal/slack/client'
import { resolvePersonalSearchConnection } from '@/lib/knowledge/application/personal-search-integrations'
import {
  type SearchConnectionTarget,
  searchConnectionPath,
} from '@/lib/knowledge/search/connection-target'

interface SlackSearchConnectionsInput {
  targets: SearchConnectionTarget[]
  token: string
  organizationId: string
  userId: string
  chatId: string
  turnId: string
  channel: string
  slackUserId: string
  signal: AbortSignal
  beforeDelivery: () => Promise<void>
}

/** Validates each requested personal target before sending server-authored, ephemeral buttons. */
export async function deliverSlackSearchConnections(input: SlackSearchConnectionsInput) {
  if (!input.channel.startsWith('D')) throw new Error('Personal connections require a Slack DM')
  const elements: Record<string, unknown>[] = []
  for (const [index, target] of input.targets.entries()) {
    await input.beforeDelivery()
    const selected = await executeCopilotOrganizationKnowledgeUseCase(
      {
        userId: input.userId,
        organizationId: input.organizationId,
        chatId: input.chatId,
        toolCallId: `${input.turnId}:connection:${index}`,
        copilotToolExecution: true,
        requestMode: 'assistant',
      },
      resolvePersonalSearchConnection,
      { organizationId: input.organizationId, target }
    )
    elements.push({
      type: 'button',
      action_id: `search_connect_${index}`,
      text: {
        type: 'plain_text',
        text: `${target.credentialId ? 'Reconnect' : 'Connect'} ${selected.name}`,
      },
      url: new URL(searchConnectionPath(input.organizationId, selected.target), getBaseUrl()).href,
    })
  }
  await input.beforeDelivery()
  input.signal.throwIfAborted()
  const blocks: Record<string, unknown>[] = [
    {
      type: 'section',
      text: {
        type: 'plain_text',
        text: 'Connect your accounts in Sim, then reply in this thread to continue.',
      },
    },
  ]
  for (let offset = 0; offset < elements.length; offset += 5)
    blocks.push({ type: 'actions', elements: elements.slice(offset, offset + 5) })
  const response = await requestSlackApi({
    accessToken: input.token,
    method: 'chat.postEphemeral',
    signal: input.signal,
    body: {
      channel: input.channel,
      user: input.slackUserId,
      text: 'Connect your sources in Sim',
      blocks,
    },
  })
  if (response.status !== 200 || response.data.ok !== true)
    throw new Error('Could not deliver Search connection buttons')
}
