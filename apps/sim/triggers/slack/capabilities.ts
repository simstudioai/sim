/**
 * Slack app capabilities that can be toggled on in the manifest generator.
 *
 * @remarks
 * Each capability maps to a set of bot OAuth scopes and bot events that must
 * be declared in the Slack app manifest for the capability to work. The `id`
 * is also used as the sub-block storage key (shape: `trigger_*` / `action_*`)
 * so the same object serves as both a checkbox-list option and a manifest
 * builder entry. See https://api.slack.com/reference/manifests.
 *
 * For the v2 trigger (`slack_webhook_v2`) the trigger capabilities are also
 * the runtime event filter: events whose capability is unchecked are dropped
 * before the workflow is invoked (see `triggers/slack/utils.ts`).
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
    id: 'trigger_slash_command',
    label: 'Slash command',
    description:
      'Trigger when a user runs one of your slash commands (e.g. /mybot). Define the commands below — they are added to the app manifest automatically.',
    defaultChecked: false,
    group: 'trigger',
    scopes: ['commands'],
    events: [],
  },
  {
    id: 'trigger_interactivity',
    label: 'Buttons & menus',
    description:
      'Trigger when a user clicks a button or picks from a select menu on a message your bot posted (block_actions payloads).',
    defaultChecked: false,
    group: 'trigger',
    scopes: [],
    events: [],
  },
  {
    id: 'trigger_shortcut',
    label: 'Message shortcut',
    description:
      'Trigger from the message context menu (message shortcuts). Define the shortcut below — it is added to the app manifest automatically.',
    defaultChecked: false,
    group: 'trigger',
    scopes: ['commands'],
    events: [],
  },
  {
    id: 'trigger_assistant',
    label: 'AI assistant threads',
    description:
      "Turn the app into a Slack AI assistant: adds the assistant split-view, enables the bot's Messages tab, and triggers when a user opens an assistant thread or changes its context.",
    defaultChecked: false,
    group: 'trigger',
    scopes: ['assistant:write'],
    events: ['assistant_thread_started', 'assistant_thread_context_changed'],
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
    id: 'action_read_history',
    label: 'Read message history',
    description:
      'Let the bot page through channel, thread, and DM history (conversations.history / conversations.replies).',
    defaultChecked: true,
    group: 'action',
    scopes: ['channels:history', 'groups:history', 'im:history', 'mpim:history'],
    events: [],
  },
  {
    id: 'action_assistant',
    label: 'Manage assistant threads',
    description:
      "Let the bot set the status indicator (the 'is thinking…' shimmer), title, and suggested prompts on AI app threads.",
    defaultChecked: true,
    group: 'action',
    scopes: ['assistant:write'],
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

export const SLACK_TRIGGER_CAPABILITY_IDS = SLACK_CAPABILITIES.filter(
  (c) => c.group === 'trigger'
).map((c) => c.id)

/** Capabilities that route payloads through the interactivity request URL. */
const INTERACTIVITY_CAPABILITY_IDS = ['trigger_interactivity', 'trigger_shortcut'] as const

const WEBHOOK_URL_PLACEHOLDER = '<deploy workflow to generate webhook URL>'

export interface SlackSlashCommandConfig {
  command: string
  description: string
}

export interface SlackShortcutConfig {
  name: string
  description: string
  callbackId: string
}

/**
 * Derives a Slack-safe callback_id from a shortcut name
 * (e.g. "Ask The Elder about this" → "ask_the_elder_about_this").
 * Deterministic so workflows can route on it.
 */
export function shortcutCallbackId(name: string): string {
  return (
    name
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '')
      .slice(0, 255) || 'shortcut'
  )
}

/** Normalizes a user-entered slash command to `/name` form. */
export function normalizeSlashCommand(command: string): string {
  const trimmed = command.trim().toLowerCase()
  if (!trimmed) return ''
  const body = trimmed.replace(/^\/+/, '').replace(/\s+.*$/, '')
  return body ? `/${body}` : ''
}

export interface BuildManifestOptions {
  appName: string
  webhookUrl: string | null
  slashCommands?: readonly SlackSlashCommandConfig[]
  shortcuts?: readonly SlackShortcutConfig[]
}

/**
 * Builds a Slack app manifest object from a set of enabled capability ids.
 *
 * @remarks
 * - Deduplicates scopes and events across overlapping capabilities.
 * - Omits `settings.event_subscriptions` entirely when no events are selected —
 *   Slack's manifest validator rejects an empty `bot_events` array.
 * - Enables the App Home messages tab when DMs or assistant threads are on;
 *   without it a wizard-generated bot cannot be messaged at all.
 * - Emits `settings.interactivity` for button/menu and shortcut payloads, and
 *   `features.slash_commands` / `features.shortcuts` from the provided configs.
 * - When `webhookUrl` is null, embeds a human-readable placeholder so the
 *   shape is visible before the workflow is deployed.
 */
export function buildSlackManifest(
  enabled: ReadonlySet<string>,
  { appName, webhookUrl, slashCommands = [], shortcuts = [] }: BuildManifestOptions
): Record<string, unknown> {
  const active = SLACK_CAPABILITIES.filter((c) => enabled.has(c.id))
  const scopes = [...new Set(active.flatMap((c) => c.scopes))].sort()
  const events = [...new Set(active.flatMap((c) => c.events))].sort()
  const displayName = appName.trim() || 'Sim Workflow Bot'
  const requestUrl = webhookUrl ?? WEBHOOK_URL_PLACEHOLDER

  const assistantEnabled = enabled.has('trigger_assistant')
  const dmEnabled = enabled.has('trigger_dm') || enabled.has('trigger_group_dm')

  const validSlashCommands = enabled.has('trigger_slash_command')
    ? slashCommands
        .map((c) => ({ ...c, command: normalizeSlashCommand(c.command) }))
        .filter((c) => c.command)
    : []
  const validShortcuts = enabled.has('trigger_shortcut')
    ? shortcuts.filter((s) => s.name.trim())
    : []

  const features: Record<string, unknown> = {
    bot_user: { display_name: displayName, always_online: true },
  }

  if (dmEnabled || assistantEnabled) {
    features.app_home = {
      home_tab_enabled: false,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    }
  }

  if (assistantEnabled) {
    features.assistant_view = {
      assistant_description: `Ask ${displayName} anything`,
    }
  }

  if (validShortcuts.length > 0) {
    features.shortcuts = validShortcuts.map((s) => ({
      name: s.name.trim(),
      type: 'message',
      callback_id: s.callbackId || shortcutCallbackId(s.name),
      description: s.description.trim() || s.name.trim(),
    }))
  }

  if (validSlashCommands.length > 0) {
    features.slash_commands = validSlashCommands.map((c) => ({
      command: c.command,
      url: requestUrl,
      description: c.description.trim() || c.command,
      should_escape: false,
    }))
  }

  const manifest: Record<string, unknown> = {
    display_information: { name: displayName },
    features,
    oauth_config: {
      scopes: { bot: scopes },
    },
    settings: {
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  }

  const settings = manifest.settings as Record<string, unknown>

  if (events.length > 0) {
    settings.event_subscriptions = {
      request_url: requestUrl,
      bot_events: events,
    }
  }

  const needsInteractivity =
    INTERACTIVITY_CAPABILITY_IDS.some((id) => enabled.has(id)) || assistantEnabled
  if (needsInteractivity) {
    settings.interactivity = {
      is_enabled: true,
      request_url: requestUrl,
    }
  }

  return manifest
}
