import { SlackIcon } from '@/components/icons'
import { getProviderIdFromServiceId, getScopesForService } from '@/lib/oauth/utils'
import { getQueryClient } from '@/app/_shell/providers/get-query-client'
import {
  fetchOAuthCredentials,
  OAUTH_CREDENTIAL_LIST_STALE_TIME,
  oauthCredentialKeys,
} from '@/hooks/queries/oauth/oauth-credentials'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import {
  SLACK_ALL_EVENT_OPTIONS,
  SLACK_SIM_EVENT_OPTIONS,
  SLACK_SOURCE_OPTIONS,
  SLACK_THREAD_OPTIONS,
  SLACK_TRIGGER_OUTPUTS,
  slackEventsSupportingFilter,
} from '@/triggers/slack/shared'
import type { TriggerConfig } from '@/triggers/types'

const SLACK_PROVIDER_ID = getProviderIdFromServiceId('slack')

/**
 * Event options for the picker, narrowed to what the selected credential can
 * actually receive: a native Sim-app OAuth account is limited to the events the
 * shared app subscribes to, while a reusable custom bot generates its own
 * manifest and can use any event. Resolved from the credential list the picker
 * already warmed, so this reads the cache without a refetch in the common case.
 */
async function fetchSlackEventOptions(blockId: string) {
  const credentialId = useSubBlockStore.getState().getValue(blockId, 'customBotCredential')
  if (typeof credentialId !== 'string' || !credentialId) return [...SLACK_ALL_EVENT_OPTIONS]

  const registry = useWorkflowRegistry.getState()
  const workspaceId = registry.hydration.workspaceId ?? undefined
  const workflowId = registry.activeWorkflowId ?? undefined

  const credentials = await getQueryClient().fetchQuery({
    queryKey: oauthCredentialKeys.list(SLACK_PROVIDER_ID, workspaceId, workflowId),
    queryFn: ({ signal }) =>
      fetchOAuthCredentials({ providerId: SLACK_PROVIDER_ID, workspaceId, workflowId }, signal),
    staleTime: OAUTH_CREDENTIAL_LIST_STALE_TIME,
  })

  const selected = credentials.find((cred) => cred.id === credentialId)
  return selected && selected.type !== 'service_account'
    ? [...SLACK_SIM_EVENT_OPTIONS]
    : [...SLACK_ALL_EVENT_OPTIONS]
}

// Filter sub-block gating is derived from the catalog's `filters` field so the
// UI conditions and the ingest route share one source of truth.
const SOURCE_FILTER_EVENTS = slackEventsSupportingFilter('source')
const CHANNEL_FILTER_EVENTS = slackEventsSupportingFilter('channels')
const THREAD_FILTER_EVENTS = slackEventsSupportingFilter('threads')
const EMOJI_FILTER_EVENTS = slackEventsSupportingFilter('emoji')
const NAME_FILTER_EVENTS = slackEventsSupportingFilter('name')
const INTERACTION_FILTER_EVENTS = slackEventsSupportingFilter('interaction')
// Bot/own toggles gate UI visibility only (the route applies them unconditionally),
// so they are not catalog `filters`.
const BOT_FILTER_EVENTS = ['message', 'app_mention']
const OWN_MESSAGE_EVENTS = ['message', 'app_mention', 'reaction_added', 'reaction_removed']

/**
 * Unified Slack trigger. A single credential picker lists both the native Sim
 * Slack app (an OAuth-connected account) and reusable custom bots; the deploy
 * path resolves the credential's kind server-side to pick the backend:
 * - Custom bot: events route by that credential (`webhook.routingKey =
 *   credentialId`) to one shared ingest URL verified with the bot's own signing
 *   secret, so many triggers on the same bot share a single Request URL.
 * - Native Sim app: events route by Slack `team_id` on the official shared app
 *   (derived at deploy time via `auth.test`, no path or app setup).
 *
 * The trigger is only reachable through the preview-gated `slack_v2` block, so
 * the native Sim-app mode inherits that gate — no separate env flag.
 */
export const slackOAuthTrigger: TriggerConfig = {
  id: 'slack_oauth',
  name: 'Slack',
  provider: 'slack_app',
  description: 'Trigger from Slack events (mentions, messages, reactions)',
  version: '1.0.0',
  icon: SlackIcon,

  subBlocks: [
    {
      id: 'eventType',
      title: 'Event',
      type: 'dropdown',
      options: [...SLACK_ALL_EVENT_OPTIONS],
      placeholder: 'Select an event',
      description:
        'The single Slack event this trigger fires on. Add another trigger block for another event.',
      required: true,
      mode: 'trigger',
      dependsOn: ['customBotCredential'],
      fetchOptions: fetchSlackEventOptions,
    },
    {
      id: 'customBotCredential',
      title: 'Slack Account',
      type: 'oauth-input',
      canonicalParamId: 'botCredential',
      serviceId: 'slack',
      credentialKind: 'any',
      credentialLabels: {
        oauthGroup: 'Sim app',
        oauthConnect: 'Connect the Sim app',
        serviceAccountGroup: 'Custom bots',
        serviceAccountConnect: 'Set up a custom bot',
      },
      requiredScopes: getScopesForService('slack'),
      placeholder: 'Select Slack account or bot',
      description:
        'Connect the native Sim Slack app, or choose a custom Slack bot you set up once and reuse across triggers and actions.',
      required: true,
      mode: 'trigger',
    },
    {
      id: 'manualBotCredential',
      title: 'Bot Credential ID',
      type: 'short-input',
      canonicalParamId: 'botCredential',
      placeholder: 'Enter bot credential ID',
      description: 'Set the custom bot credential ID directly.',
      required: true,
      mode: 'trigger-advanced',
    },
    {
      id: 'source',
      title: 'Source',
      type: 'dropdown',
      multiSelect: true,
      options: [...SLACK_SOURCE_OPTIONS],
      placeholder: 'Any source',
      description:
        'Restrict to direct messages, public channels, or private channels. Leave empty to match any.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: SOURCE_FILTER_EVENTS },
    },
    {
      id: 'channelFilter',
      title: 'Channels',
      type: 'channel-selector',
      canonicalParamId: 'channelFilter',
      multiSelect: true,
      serviceId: 'slack',
      selectorKey: 'slack.channels',
      placeholder: 'Any channel the bot is in',
      description:
        'Restrict to specific channels. Leave empty to trigger on any channel the bot has been added to.',
      dependsOn: ['customBotCredential'],
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: CHANNEL_FILTER_EVENTS },
    },
    {
      id: 'manualChannelFilter',
      title: 'Channel IDs',
      type: 'short-input',
      canonicalParamId: 'channelFilter',
      placeholder: 'C0123456789, C0987654321',
      description: 'Comma-separated channel IDs to restrict to. Set IDs directly here.',
      required: false,
      mode: 'trigger-advanced',
      condition: { field: 'eventType', value: CHANNEL_FILTER_EVENTS },
    },
    {
      id: 'threads',
      title: 'Threads',
      type: 'dropdown',
      options: [...SLACK_THREAD_OPTIONS],
      value: () => 'include',
      description:
        'Include thread replies, exclude them (top-level only), or fire only on thread replies.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: THREAD_FILTER_EVENTS },
    },
    {
      id: 'emoji',
      title: 'Emoji',
      type: 'short-input',
      placeholder: 'thumbsup, white_check_mark',
      description: 'Comma-separated emoji names to restrict to. Leave empty to match any emoji.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: EMOJI_FILTER_EVENTS },
    },
    {
      id: 'nameContains',
      title: 'Name contains',
      type: 'short-input',
      placeholder: 'incident-',
      description: 'Only fire when the created channel name contains this text.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: NAME_FILTER_EVENTS },
    },
    {
      id: 'interactionFilter',
      title: 'Action / Callback ID',
      type: 'short-input',
      placeholder: 'approve_btn, deny_btn',
      description:
        'Comma-separated action_ids (buttons/selects) or callback_ids (modals) to restrict to. Leave empty to fire on any interaction.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: INTERACTION_FILTER_EVENTS },
    },
    {
      id: 'filterBotMessages',
      title: 'Ignore bot messages',
      type: 'switch',
      defaultValue: true,
      description: "Ignore messages sent by other bots. This app's own output is always ignored.",
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: BOT_FILTER_EVENTS },
    },
    {
      id: 'includeOwnMessages',
      title: 'Include own bot messages',
      type: 'switch',
      defaultValue: false,
      description:
        "Also fire on this app's own messages and reactions. Can cause loops — use with care.",
      required: false,
      mode: 'trigger-advanced',
      condition: { field: 'eventType', value: OWN_MESSAGE_EVENTS },
    },
    {
      id: 'includeFiles',
      title: 'Include file attachments',
      type: 'switch',
      defaultValue: false,
      description: 'Download and include file attachments from messages. Requires files:read.',
      required: false,
      mode: 'trigger',
      condition: { field: 'eventType', value: 'message' },
    },
  ],

  outputs: SLACK_TRIGGER_OUTPUTS,

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
