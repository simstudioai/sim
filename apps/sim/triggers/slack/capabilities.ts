/**
 * Slack app capabilities that can be toggled on in the manifest generator.
 *
 * @remarks
 * Each capability maps to a set of bot OAuth scopes and bot events that must
 * be declared in the Slack app manifest for the capability to work. The `id`
 * is also used as the sub-block storage key (shape: `trigger_*` / `action_*`)
 * so the same object serves as both a checkbox-list option and a manifest
 * builder entry. See https://api.slack.com/reference/manifests.
 */

export type SlackCapabilityGroup = 'trigger' | 'action'

export interface SlackCapability {
  id: string
  label: string
  description: string
  defaultChecked: boolean
  group: SlackCapabilityGroup
  scopes: readonly string[]
  events: readonly string[]
}

export const SLACK_CAPABILITIES: readonly SlackCapability[] = [
  {
    id: 'trigger_mention',
    label: '@mention',
    description: 'Trigger the workflow when someone @-mentions your bot.',
    defaultChecked: true,
    group: 'trigger',
    scopes: ['app_mentions:read'],
    events: ['app_mention'],
  },
  {
    id: 'trigger_dm',
    label: 'Direct message',
    description: 'Trigger the workflow when a user sends your bot a 1:1 direct message.',
    defaultChecked: true,
    group: 'trigger',
    scopes: ['im:history', 'im:read'],
    events: ['message.im'],
  },
  {
    id: 'trigger_group_dm',
    label: 'Group direct message',
    description: 'Trigger on messages in multi-person DMs your bot is part of.',
    defaultChecked: true,
    group: 'trigger',
    scopes: ['mpim:history', 'mpim:read'],
    events: ['message.mpim'],
  },
  {
    id: 'trigger_public_channel',
    label: 'Public channel message',
    description: 'Trigger on messages in public channels your bot has been invited to.',
    defaultChecked: true,
    group: 'trigger',
    scopes: ['channels:history', 'channels:read'],
    events: ['message.channels'],
  },
  {
    id: 'trigger_private_channel',
    label: 'Private channel message',
    description: 'Trigger on messages in private channels your bot has been invited to.',
    defaultChecked: true,
    group: 'trigger',
    scopes: ['groups:history', 'groups:read'],
    events: ['message.groups'],
  },
  {
    id: 'trigger_reaction',
    label: 'Reaction',
    description:
      'Trigger when an emoji reaction is added or removed anywhere the bot can see — public, private, or DM. Slack does not allow restricting the reactions scope by channel type.',
    defaultChecked: true,
    group: 'trigger',
    scopes: ['reactions:read'],
    events: ['reaction_added', 'reaction_removed'],
  },
  {
    id: 'action_send',
    label: 'Send messages',
    description: 'Let the bot post messages into channels it is a member of.',
    defaultChecked: true,
    group: 'action',
    scopes: ['chat:write'],
    events: [],
  },
  {
    id: 'action_add_reaction',
    label: 'Add reactions',
    description: 'Let the bot add emoji reactions to messages.',
    defaultChecked: true,
    group: 'action',
    scopes: ['reactions:write'],
    events: [],
  },
  {
    id: 'action_read_files',
    label: 'Read file attachments',
    description: 'Let the bot download file attachments on incoming messages.',
    defaultChecked: true,
    group: 'action',
    scopes: ['files:read'],
    events: [],
  },
  {
    id: 'action_read_users',
    label: 'Look up users',
    description: 'Resolve user IDs to names, profiles, and email addresses.',
    defaultChecked: true,
    group: 'action',
    scopes: ['users:read', 'users:read.email'],
    events: [],
  },
] as const

const WEBHOOK_URL_PLACEHOLDER = '<deploy workflow to generate webhook URL>'

export interface BuildManifestOptions {
  appName: string
  webhookUrl: string | null
}

/**
 * Builds a Slack app manifest object from a set of enabled capability ids.
 *
 * @remarks
 * - Deduplicates scopes and events across overlapping capabilities.
 * - Omits `settings.event_subscriptions` entirely when no events are selected —
 *   Slack's manifest validator rejects an empty `bot_events` array.
 * - When `webhookUrl` is null, embeds a human-readable placeholder so the
 *   shape is visible before the workflow is deployed.
 */
export function buildSlackManifest(
  enabled: ReadonlySet<string>,
  { appName, webhookUrl }: BuildManifestOptions
): Record<string, unknown> {
  const active = SLACK_CAPABILITIES.filter((c) => enabled.has(c.id))
  const scopes = [...new Set(active.flatMap((c) => c.scopes))].sort()
  const events = [...new Set(active.flatMap((c) => c.events))].sort()
  const displayName = appName.trim() || 'Sim Workflow Bot'

  const manifest: Record<string, unknown> = {
    display_information: { name: displayName },
    features: {
      bot_user: { display_name: displayName, always_online: true },
    },
    oauth_config: {
      scopes: { bot: scopes },
    },
    settings: {
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  }

  if (events.length > 0) {
    const settings = manifest.settings as Record<string, unknown>
    settings.event_subscriptions = {
      request_url: webhookUrl ?? WEBHOOK_URL_PLACEHOLDER,
      bot_events: events,
    }
  }

  return manifest
}
