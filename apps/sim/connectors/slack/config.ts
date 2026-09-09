import {
  SLACK_CHANNEL_READ_SCOPES,
  SLACK_DM_READ_SCOPES,
} from '@/lib/credential-groups/slack-managed-user-scopes'

export function readSlackConversationSetting(value: unknown, defaultValue: boolean): boolean {
  if (value === undefined || value === null || value === '') return defaultValue
  if (value === true || value === 'true') return true
  if (value === false || value === 'false') return false
  throw new Error('Slack conversation settings must be Include or Exclude')
}

export function slackConversationTypes(config: Record<string, unknown>): string {
  const types = [
    ...(readSlackConversationSetting(config.includeChannels, true)
      ? ['public_channel', 'private_channel']
      : []),
    ...(readSlackConversationSetting(config.includeDirectMessages, false) ? ['im', 'mpim'] : []),
  ]
  if (!types.length) throw new Error('Select at least one Slack conversation type to index')
  return types.join(',')
}

export function slackIndexingScopes(config: Record<string, unknown>): string[] {
  slackConversationTypes(config)
  return [
    'users:read',
    ...(readSlackConversationSetting(config.includeChannels, true)
      ? SLACK_CHANNEL_READ_SCOPES
      : []),
    ...(readSlackConversationSetting(config.includeDirectMessages, false)
      ? SLACK_DM_READ_SCOPES
      : []),
  ]
}
