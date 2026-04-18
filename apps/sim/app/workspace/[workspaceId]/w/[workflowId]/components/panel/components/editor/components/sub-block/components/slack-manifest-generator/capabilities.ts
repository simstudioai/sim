/**
 * Slack app capabilities that can be toggled on in the manifest generator.
 *
 * @remarks
 * Each capability maps to a set of bot OAuth scopes and bot events that must
 * be declared in the Slack app manifest for the capability to work.
 * See https://api.slack.com/reference/manifests for the manifest schema.
 */

export type SlackCapabilityGroup = 'trigger' | 'action'

export interface SlackCapability {
  id: string
  label: string
  description: string
  group: SlackCapabilityGroup
  scopes: readonly string[]
  events: readonly string[]
  defaultEnabled: boolean
}

export const SLACK_CAPABILITIES: readonly SlackCapability[] = [
  {
    id: 'mention',
    label: '@mention',
    description: 'Trigger the workflow when someone @-mentions your bot.',
    group: 'trigger',
    scopes: ['app_mentions:read'],
    events: ['app_mention'],
    defaultEnabled: true,
  },
  {
    id: 'dm',
    label: 'Direct message',
    description: 'Trigger the workflow when a user sends your bot a 1:1 direct message.',
    group: 'trigger',
    scopes: ['im:history', 'im:read'],
    events: ['message.im'],
    defaultEnabled: true,
  },
  {
    id: 'group_dm',
    label: 'Group direct message',
    description: 'Trigger on messages in multi-person DMs your bot is part of.',
    group: 'trigger',
    scopes: ['mpim:history', 'mpim:read'],
    events: ['message.mpim'],
    defaultEnabled: true,
  },
  {
    id: 'public_channel',
    label: 'Public channel message',
    description: 'Trigger on messages in public channels your bot has been invited to.',
    group: 'trigger',
    scopes: ['channels:history', 'channels:read'],
    events: ['message.channels'],
    defaultEnabled: true,
  },
  {
    id: 'private_channel',
    label: 'Private channel message',
    description: 'Trigger on messages in private channels your bot has been invited to.',
    group: 'trigger',
    scopes: ['groups:history', 'groups:read'],
    events: ['message.groups'],
    defaultEnabled: true,
  },
  {
    id: 'public_channel_reaction',
    label: 'Public channel reaction',
    description: 'Trigger when emoji reactions are added or removed in public channels.',
    group: 'trigger',
    scopes: ['reactions:read'],
    events: ['reaction_added', 'reaction_removed'],
    defaultEnabled: true,
  },
  {
    id: 'any_reaction',
    label: 'Reaction (any channel)',
    description: 'Trigger on any emoji reaction your bot can see — public or private.',
    group: 'trigger',
    scopes: ['reactions:read'],
    events: ['reaction_added', 'reaction_removed'],
    defaultEnabled: true,
  },
  {
    id: 'send',
    label: 'Send messages',
    description: 'Let the bot post messages into channels it is a member of.',
    group: 'action',
    scopes: ['chat:write'],
    events: [],
    defaultEnabled: true,
  },
  {
    id: 'add_reaction',
    label: 'Add reactions',
    description: 'Let the bot add emoji reactions to messages.',
    group: 'action',
    scopes: ['reactions:write'],
    events: [],
    defaultEnabled: true,
  },
  {
    id: 'read_files',
    label: 'Read file attachments',
    description: 'Let the bot download file attachments on incoming messages.',
    group: 'action',
    scopes: ['files:read'],
    events: [],
    defaultEnabled: true,
  },
  {
    id: 'read_users',
    label: 'Look up users',
    description: 'Resolve user IDs to names, profiles, and email addresses.',
    group: 'action',
    scopes: ['users:read', 'users:read.email'],
    events: [],
    defaultEnabled: true,
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
