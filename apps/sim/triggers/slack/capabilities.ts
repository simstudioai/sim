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
  /**
   * Marks the AI Assistant capability. When enabled the manifest additionally
   * declares the app as an Agents & AI app (`features.assistant_view`) and
   * enables the App Home messages tab — required for assistant threads, the
   * "thinking" status (`assistant.threads.setStatus`), and DM-style chat to work.
   */
  assistant?: boolean
  /**
   * Marks the interactivity capability. When enabled the manifest declares
   * `settings.interactivity` (pointing at the same ingest URL) — required for
   * Slack to deliver `block_actions` (button/select clicks) and `view_submission`
   * (modal submits) so triggers can fire on them. Not a scope or a bot_event.
   */
  interactivity?: boolean
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
    id: 'trigger_file_shared',
    label: 'File shared',
    description: 'Trigger when a file is shared in a channel your bot can see.',
    defaultChecked: false,
    group: 'trigger',
    scopes: ['files:read'],
    events: ['file_shared'],
  },
  {
    id: 'trigger_member_channel',
    label: 'Member joined / left channel',
    description: 'Trigger when a member joins or leaves a channel your bot is in.',
    defaultChecked: false,
    group: 'trigger',
    scopes: ['channels:read', 'groups:read'],
    events: ['member_joined_channel', 'member_left_channel'],
  },
  {
    id: 'trigger_channel_lifecycle',
    label: 'Channel created / archived / renamed',
    description: 'Trigger when a channel is created, archived, or renamed.',
    defaultChecked: false,
    group: 'trigger',
    scopes: ['channels:read', 'groups:read'],
    events: ['channel_created', 'channel_archive', 'channel_rename'],
  },
  {
    id: 'trigger_pin',
    label: 'Pin added / removed',
    description: 'Trigger when a message is pinned or unpinned in a channel.',
    defaultChecked: false,
    group: 'trigger',
    scopes: ['pins:read'],
    events: ['pin_added', 'pin_removed'],
  },
  {
    id: 'trigger_team_join',
    label: 'Member joined workspace',
    description: 'Trigger when a new member joins the workspace.',
    defaultChecked: false,
    group: 'trigger',
    scopes: ['users:read'],
    events: ['team_join'],
  },
  {
    id: 'trigger_app_home',
    label: 'App home opened',
    description: "Trigger when a user opens your app's Home tab.",
    defaultChecked: false,
    group: 'trigger',
    scopes: [],
    events: ['app_home_opened'],
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
    scopes: ['channels:history', 'groups:history', 'im:history'],
    events: [],
  },
  {
    id: 'action_assistant',
    label: 'AI assistant',
    description:
      'Register the bot as an AI assistant: users open an assistant thread, the bot shows a "thinking" status, and can set the thread title and suggested prompts (assistant.threads.*).',
    defaultChecked: true,
    group: 'action',
    scopes: ['assistant:write', 'im:history'],
    events: ['assistant_thread_started', 'assistant_thread_context_changed', 'message.im'],
    assistant: true,
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
  {
    id: 'action_interactivity',
    label: 'Buttons & modals',
    description:
      'Let workflows trigger on interactions — button/select clicks and modal submits. Enables the app’s Interactivity Request URL.',
    defaultChecked: true,
    group: 'action',
    scopes: [],
    events: [],
    interactivity: true,
  },
] as const

const WEBHOOK_URL_PLACEHOLDER = '<deploy workflow to generate webhook URL>'

export interface BuildManifestOptions {
  appName: string
  webhookUrl: string | null
  /** Shown on the bot's Slack profile and as the assistant description. */
  description?: string
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
  { appName, webhookUrl, description }: BuildManifestOptions
): Record<string, unknown> {
  const active = SLACK_CAPABILITIES.filter((c) => enabled.has(c.id))
  const scopes = [...new Set(active.flatMap((c) => c.scopes))].sort()
  const events = [...new Set(active.flatMap((c) => c.events))].sort()
  const displayName = appName.trim() || 'Sim Workflow Bot'
  const trimmedDescription = description?.trim() || ''
  const isAssistant = active.some((c) => c.assistant)
  const isInteractive = active.some((c) => c.interactivity)

  const features: Record<string, unknown> = {
    bot_user: { display_name: displayName, always_online: true },
  }
  if (isAssistant) {
    // Declares the app as an Agents & AI app; without this Slack won't surface
    // the assistant thread UI or fire assistant_thread_* events. The messages
    // tab must be enabled so users can chat the assistant.
    features.assistant_view = {
      assistant_description:
        trimmedDescription || `${displayName} — an AI assistant powered by Sim.`,
    }
    features.app_home = {
      home_tab_enabled: false,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    }
  }

  const manifest: Record<string, unknown> = {
    display_information: trimmedDescription
      ? { name: displayName, description: trimmedDescription }
      : { name: displayName },
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

  if (events.length > 0) {
    const settings = manifest.settings as Record<string, unknown>
    settings.event_subscriptions = {
      request_url: webhookUrl ?? WEBHOOK_URL_PLACEHOLDER,
      bot_events: events,
    }
  }

  // Interactivity is independent of event subscriptions — a bot can have
  // buttons/modals with no bot_events. Points at the same ingest URL.
  if (isInteractive) {
    const settings = manifest.settings as Record<string, unknown>
    settings.interactivity = {
      is_enabled: true,
      request_url: webhookUrl ?? WEBHOOK_URL_PLACEHOLDER,
    }
  }

  return manifest
}
