import { normalizeEmail } from '@sim/utils/string'
import {
  requestSlackApi,
  type SlackApiResult,
  slackObject,
  slackString,
} from '@/lib/internal/slack/client'
import { SLACK_SEARCH_SCOPES } from '@/lib/slack-search/constants'

export class SlackSearchProviderError extends Error {
  constructor() {
    super('Slack could not complete the request. Check the bot connection and permissions.')
    this.name = 'SlackSearchProviderError'
  }
}

export class SlackSearchConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SlackSearchConfigurationError'
  }
}

function requireSuccess(result: SlackApiResult) {
  if (result.status < 200 || result.status >= 300 || result.data.ok !== true) {
    throw new SlackSearchProviderError()
  }
  return result.data
}

/** Verifies a workspace-installed bot and its granted scopes, never a user token. */
export async function verifySlackSearchBot(accessToken: string, signal?: AbortSignal) {
  const result = await requestSlackApi({ accessToken, method: 'auth.test', signal })
  const auth = requireSuccess(result)
  const teamId = slackString(auth, 'team_id')
  const botUserId = slackString(auth, 'user_id')
  const botId = slackString(auth, 'bot_id')
  if (!teamId || !botUserId || !botId || auth.is_enterprise_install === true) {
    throw new SlackSearchConfigurationError(
      'Slack Search requires a bot installed in a single Slack workspace'
    )
  }
  const missing = SLACK_SEARCH_SCOPES.filter((scope) => !result.grantedScopes?.includes(scope))
  if (missing.length)
    throw new SlackSearchConfigurationError(
      `Reinstall the Slack bot with these scopes: ${missing.join(', ')}`
    )
  const bot = slackObject(
    requireSuccess(
      await requestSlackApi({
        accessToken,
        method: 'bots.info',
        httpMethod: 'GET',
        query: { bot: botId },
        signal,
      })
    ),
    'bot'
  )
  const appId = bot && slackString(bot, 'app_id')
  if (!appId || bot?.id !== botId || bot.deleted === true) throw new SlackSearchProviderError()
  return {
    appId,
    teamId,
    botUserId,
    teamName: slackString(auth, 'team') ?? teamId,
    enterpriseId: slackString(auth, 'enterprise_id') ?? null,
  }
}

/** The Slack API is the sole source of the sender's email and active human identity. */
export async function getSlackSearchSender(
  accessToken: string,
  userId: string,
  teamId: string,
  signal?: AbortSignal
) {
  const data = requireSuccess(
    await requestSlackApi({
      accessToken,
      method: 'users.info',
      httpMethod: 'GET',
      query: { user: userId },
      signal,
    })
  )
  const user = slackObject(data, 'user')
  const profile = user && slackObject(user, 'profile')
  const email = profile && slackString(profile, 'email')
  if (
    !user ||
    user.id !== userId ||
    user.team_id !== teamId ||
    user.deleted !== false ||
    user.is_bot !== false ||
    user.is_app_user === true ||
    !email?.trim()
  ) {
    return null
  }
  return { email: normalizeEmail(email) }
}
