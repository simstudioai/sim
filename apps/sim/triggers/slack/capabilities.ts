import {
  resolveSlackManagedUserScopes,
  SLACK_MANAGED_USER_CONFIGURATION_CALLBACK_PATH,
  SLACK_MANAGED_USER_ENROLLMENT_CALLBACK_PATH,
  SLACK_MANAGED_USER_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'

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

export const SLACK_MANAGED_USER_AUTHORIZATION_CAPABILITY = {
  id: 'managed_user_authorization',
  label: 'Managed user authorization',
  description: 'Let people authorize this Slack app for use in Credential Groups.',
  defaultChecked: true,
} as const

export function getSlackManagedUserAuthorizationManifestConfig(
  baseUrl: string,
  requiredScopes: readonly string[] = SLACK_MANAGED_USER_SCOPES
) {
  return {
    redirectUrls: [
      `${baseUrl}${SLACK_MANAGED_USER_CONFIGURATION_CALLBACK_PATH}`,
      `${baseUrl}${SLACK_MANAGED_USER_ENROLLMENT_CALLBACK_PATH}`,
    ],
    userScopes: resolveSlackManagedUserScopes(requiredScopes),
  }
}

const WEBHOOK_URL_PLACEHOLDER = '<deploy workflow to generate webhook URL>'

export const SLACK_AGENT_SCOPES = [
  'assistant:write',
  'chat:write',
  'chat:write.customize',
  'im:history',
  'im:write',
] as const

export const SLACK_AGENT_EVENTS = [
  'agent_session_stopped',
  'agent_session_title_changed',
  'app_context_changed',
  'app_home_opened',
  'assistant_thread_context_changed',
  'assistant_thread_started',
  'message.im',
] as const

export interface SlackSlashCommand {
  command: string
  description: string
  usageHint?: string
}

export interface BuildManifestOptions {
  appName: string
  webhookUrl: string | null
  /** Shown on the bot's Slack profile and as the agent description. */
  description?: string
  slashCommands?: readonly SlackSlashCommand[]
  managedUserAuthorization?: {
    redirectUrls: readonly string[]
    userScopes: readonly string[]
  }
}

function normalizeSlashCommands(
  commands: readonly SlackSlashCommand[],
  webhookUrl: string
): Array<{
  command: string
  description: string
  should_escape: true
  url: string
  usage_hint?: string
}> {
  if (commands.length > 50) {
    throw new Error('Slack apps support at most 50 slash commands')
  }

  const seen = new Set<string>()
  return commands.map((entry, index) => {
    const command = entry.command.trim()
    const description = entry.description.trim()
    const usageHint = entry.usageHint?.trim() || ''

    if (!command || !description) {
      throw new Error(`Slack slash command ${index + 1} requires a command and description`)
    }
    if (!command.startsWith('/') || command.length === 1 || /\s/.test(command)) {
      throw new Error(`Slack slash command ${index + 1} must be one word beginning with /`)
    }
    if (command.length > 32) {
      throw new Error(`Slack slash command ${index + 1} must be 32 characters or fewer`)
    }
    if (description.length > 2000) {
      throw new Error(
        `Slack slash command ${index + 1} description must be 2000 characters or fewer`
      )
    }
    if (usageHint.length > 1000) {
      throw new Error(
        `Slack slash command ${index + 1} usage hint must be 1000 characters or fewer`
      )
    }
    if (seen.has(command)) {
      throw new Error(`Slack slash command ${command} is configured more than once`)
    }
    seen.add(command)

    return {
      command,
      description,
      should_escape: true,
      url: webhookUrl,
      ...(usageHint ? { usage_hint: usageHint } : {}),
    }
  })
}

/**
 * Builds a Slack app manifest object from a set of enabled capability ids.
 *
 * @remarks
 * - Deduplicates scopes and events across overlapping capabilities.
 * - Every custom bot is an Agent View app with Agent Sessions, streaming, and
 *   direct-message support. Optional capabilities only add to that baseline.
 * - When `webhookUrl` is null, embeds a human-readable placeholder so the
 *   shape is visible before the workflow is deployed.
 */
export function buildSlackManifest(
  enabled: ReadonlySet<string>,
  {
    appName,
    webhookUrl,
    description,
    slashCommands = [],
    managedUserAuthorization,
  }: BuildManifestOptions
): Record<string, unknown> {
  const active = SLACK_CAPABILITIES.filter((c) => enabled.has(c.id))
  const requestUrl = webhookUrl ?? WEBHOOK_URL_PLACEHOLDER
  const normalizedSlashCommands = normalizeSlashCommands(slashCommands, requestUrl)
  const scopes = [
    ...new Set([
      ...SLACK_AGENT_SCOPES,
      ...active.flatMap((c) => c.scopes),
      ...(normalizedSlashCommands.length > 0 ? ['commands'] : []),
      ...(managedUserAuthorization ? ['users:read'] : []),
    ]),
  ].sort()
  const events = [...new Set([...SLACK_AGENT_EVENTS, ...active.flatMap((c) => c.events)])].sort()
  const displayName = appName.trim() || 'Sim Workflow Bot'
  const trimmedDescription = description?.trim() || ''
  const isInteractive = active.some((c) => c.interactivity)
  const agentDescription = trimmedDescription || `${displayName} — an AI agent powered by Sim.`

  if (agentDescription.length > 300) {
    throw new Error('Slack agent description must be 300 characters or fewer')
  }

  const features: Record<string, unknown> = {
    bot_user: { display_name: displayName, always_online: true },
    agent_view: {
      agent_description: agentDescription,
    },
    ...(normalizedSlashCommands.length > 0 ? { slash_commands: normalizedSlashCommands } : {}),
    app_home: {
      home_tab_enabled: false,
      messages_tab_enabled: true,
      messages_tab_read_only_enabled: false,
    },
  }

  const oauthConfig: Record<string, unknown> = { scopes: { bot: scopes } }
  if (managedUserAuthorization) {
    const redirectUrls = [
      ...new Set(managedUserAuthorization.redirectUrls.map((url) => url.trim()).filter(Boolean)),
    ]
    const userScopes = [
      ...new Set(managedUserAuthorization.userScopes.map((scope) => scope.trim()).filter(Boolean)),
    ].sort()
    if (redirectUrls.length === 0 || userScopes.length === 0) {
      throw new Error('Managed Slack users require redirect URLs and user scopes')
    }
    oauthConfig.redirect_urls = redirectUrls
    oauthConfig.scopes = { bot: scopes, user: userScopes }
  }

  const manifest: Record<string, unknown> = {
    display_information: trimmedDescription
      ? { name: displayName, description: trimmedDescription }
      : { name: displayName },
    features,
    oauth_config: oauthConfig,
    settings: {
      org_deploy_enabled: false,
      socket_mode_enabled: false,
      token_rotation_enabled: false,
    },
  }

  const settings = manifest.settings as Record<string, unknown>
  settings.event_subscriptions = {
    request_url: requestUrl,
    bot_events: events,
  }

  // Interactivity is independent of event subscriptions — a bot can have
  // buttons/modals with no bot_events. Points at the same ingest URL.
  if (isInteractive) {
    settings.interactivity = {
      is_enabled: true,
      request_url: requestUrl,
    }
  }

  return manifest
}
