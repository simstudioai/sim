import { db, webhook, workflowDeploymentVersion } from '@sim/db'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { generateShortId } from '@sim/utils/id'
import { and, eq, isNull, ne } from 'drizzle-orm'
import { NextResponse } from 'next/server'
import { getEffectiveDecryptedEnv } from '@/lib/environment/utils'
import { resolveBackgroundWebhookEnv } from '@/lib/webhooks/env-resolver'
import { getNotificationUrl, getProviderConfig } from '@/lib/webhooks/provider-subscription-utils'
import type {
  AuthContext,
  DeleteSubscriptionContext,
  FormatInputContext,
  FormatInputResult,
  SubscriptionContext,
  SubscriptionResult,
  WebhookProviderHandler,
} from '@/lib/webhooks/providers/types'
import { verifyTokenAuth } from '@/lib/webhooks/providers/utils'
import { createEnvVarPattern, resolveEnvVarReferences } from '@/executor/utils/reference-validation'

const logger = createLogger('WebhookProvider:Telegram')

const TELEGRAM_SECRET_TOKEN_HEADER = 'x-telegram-bot-api-secret-token'
const TELEGRAM_SECRET_TOKEN_LENGTH = 64
/** Telegram's `setWebhook` `secret_token` charset and length bounds. */
const TELEGRAM_SECRET_TOKEN_PATTERN = /^[A-Za-z0-9_-]{1,256}$/

function readSecretToken(providerConfig: Record<string, unknown>): string | null {
  const secretToken = providerConfig.secretToken
  return typeof secretToken === 'string' && TELEGRAM_SECRET_TOKEN_PATTERN.test(secretToken)
    ? secretToken
    : null
}

export const telegramHandler: WebhookProviderHandler = {
  /** Telegram resends a non-2xx update until it is acknowledged or 24 hours pass. */
  acknowledgeAdmissionRejections: true,

  /**
   * Telegram echoes the `secret_token` registered via `setWebhook` in the
   * `X-Telegram-Bot-Api-Secret-Token` header. Webhooks registered before Sim
   * sent a secret have none stored and stay accepted until their next deploy
   * registers one; once a secret is stored, a delivery without it is rejected.
   */
  verifyAuth({ request, requestId, providerConfig }: AuthContext): NextResponse | null {
    const secretToken = readSecretToken(providerConfig)
    if (!secretToken) return null

    if (!verifyTokenAuth(request, secretToken, TELEGRAM_SECRET_TOKEN_HEADER)) {
      logger.warn(`[${requestId}] Rejected Telegram webhook request with invalid secret token`)
      return new NextResponse('Unauthorized', { status: 401 })
    }

    return null
  },

  extractIdempotencyId(body: unknown): string | null {
    const obj = body as Record<string, unknown>
    const updateId = obj.update_id
    if (typeof updateId === 'number') {
      return `telegram:${updateId}`
    }
    return null
  },

  async formatInput({ body }: FormatInputContext): Promise<FormatInputResult> {
    const b = body as Record<string, unknown>
    const rawMessage = (b?.message ||
      b?.edited_message ||
      b?.channel_post ||
      b?.edited_channel_post) as Record<string, unknown> | undefined

    const updateType = b.message
      ? 'message'
      : b.edited_message
        ? 'edited_message'
        : b.channel_post
          ? 'channel_post'
          : b.edited_channel_post
            ? 'edited_channel_post'
            : 'unknown'

    if (rawMessage) {
      const messageType = rawMessage.photo
        ? 'photo'
        : rawMessage.document
          ? 'document'
          : rawMessage.audio
            ? 'audio'
            : rawMessage.video
              ? 'video'
              : rawMessage.voice
                ? 'voice'
                : rawMessage.sticker
                  ? 'sticker'
                  : rawMessage.location
                    ? 'location'
                    : rawMessage.contact
                      ? 'contact'
                      : rawMessage.poll
                        ? 'poll'
                        : 'text'

      const from = rawMessage.from as Record<string, unknown> | undefined
      return {
        input: {
          message: {
            id: rawMessage.message_id,
            text: rawMessage.text,
            date: rawMessage.date,
            messageType,
            raw: rawMessage,
          },
          sender: from
            ? {
                id: from.id,
                username: from.username,
                firstName: from.first_name,
                lastName: from.last_name,
                languageCode: from.language_code,
                isBot: from.is_bot,
              }
            : null,
          updateId: b.update_id,
          updateType,
        },
      }
    }

    logger.warn('Unknown Telegram update type', {
      updateId: b.update_id,
      bodyKeys: Object.keys(b || {}),
    })

    return {
      input: {
        updateId: b.update_id,
        updateType,
      },
    }
  },

  async createSubscription(ctx: SubscriptionContext): Promise<SubscriptionResult | undefined> {
    const config = getProviderConfig(ctx.webhook)
    const botToken = config.botToken as string | undefined

    if (!botToken) {
      logger.warn(`[${ctx.requestId}] Missing botToken for Telegram webhook ${ctx.webhook.id}`)
      throw new Error(
        'Bot token is required to create a Telegram webhook. Please provide a valid Telegram bot token.'
      )
    }

    const notificationUrl = getNotificationUrl(ctx.webhook)
    const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`
    const secretToken = await resolveSubscriptionSecretToken(ctx, config, botToken)

    try {
      const telegramResponse = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TelegramBot/1.0',
        },
        body: JSON.stringify({ url: notificationUrl, secret_token: secretToken }),
      })

      const responseBody = await telegramResponse.json()
      if (!telegramResponse.ok || !responseBody.ok) {
        const errorMessage =
          responseBody.description ||
          `Failed to create Telegram webhook. Status: ${telegramResponse.status}`
        logger.error(`[${ctx.requestId}] ${errorMessage}`, { response: responseBody })

        let userFriendlyMessage = 'Failed to create Telegram webhook'
        if (telegramResponse.status === 401) {
          userFriendlyMessage =
            'Invalid bot token. Please verify that the bot token is correct and try again.'
        } else if (responseBody.description) {
          userFriendlyMessage = `Telegram error: ${responseBody.description}`
        }

        throw new Error(userFriendlyMessage)
      }

      logger.info(
        `[${ctx.requestId}] Successfully created Telegram webhook for webhook ${ctx.webhook.id}`
      )
      return { providerConfigUpdates: { secretToken } }
    } catch (error: unknown) {
      if (
        error instanceof Error &&
        (error.message.includes('Bot token') || error.message.includes('Telegram error'))
      ) {
        throw error
      }

      logger.error(
        `[${ctx.requestId}] Error creating Telegram webhook for webhook ${ctx.webhook.id}`,
        error
      )
      throw new Error(
        getErrorMessage(error, 'Failed to create Telegram webhook. Please try again.')
      )
    }
  },

  async deleteSubscription(ctx: DeleteSubscriptionContext): Promise<void> {
    try {
      const config = getProviderConfig(ctx.webhook)
      const botToken = config.botToken as string | undefined

      if (!botToken) {
        logger.warn(
          `[${ctx.requestId}] Missing botToken for Telegram webhook deletion ${ctx.webhook.id}`
        )
        if (ctx.strict) throw new Error('Missing Telegram botToken for webhook deletion')
        return
      }

      const activeConfigs = await findActiveTelegramConfigsForBot(
        ctx.webhook.id,
        ctx.workflow,
        botToken,
        () => backgroundEnvFor(ctx.workflow)
      )
      if (activeConfigs.length > 0) {
        logger.info(
          `[${ctx.requestId}] Skipping Telegram webhook deletion because an active deployment uses the same bot token`,
          { webhookId: ctx.webhook.id }
        )
        return
      }

      const telegramApiUrl = `https://api.telegram.org/bot${botToken}/deleteWebhook`
      const telegramResponse = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })

      const responseBody = await telegramResponse.json()
      if (!telegramResponse.ok || !responseBody.ok) {
        const errorMessage =
          responseBody.description ||
          `Failed to delete Telegram webhook. Status: ${telegramResponse.status}`
        logger.error(`[${ctx.requestId}] ${errorMessage}`, { response: responseBody })
        if (ctx.strict) throw new Error(errorMessage)
      } else {
        logger.info(
          `[${ctx.requestId}] Successfully deleted Telegram webhook for webhook ${ctx.webhook.id}`
        )
      }
    } catch (error) {
      logger.error(
        `[${ctx.requestId}] Error deleting Telegram webhook for webhook ${ctx.webhook.id}`,
        error
      )
      if (ctx.strict) throw error
    }
  },
}

/**
 * Telegram holds one webhook (and one secret) per bot, and `setWebhook` repoints
 * it immediately, while the processor verifies against the row of the active
 * deployment until cutover. Reusing the active row's secret keeps deliveries
 * verifiable during cutover and after a failed candidate deploy that already
 * repointed the bot.
 */
async function resolveSubscriptionSecretToken(
  ctx: SubscriptionContext,
  config: Record<string, unknown>,
  botToken: string
): Promise<string> {
  const ownSecret = readSecretToken(config)
  if (ownSecret) return ownSecret

  const workspaceId = workspaceIdOf(ctx.workflow)
  const activeConfigs = await findActiveTelegramConfigsForBot(
    ctx.webhook.id,
    ctx.workflow,
    botToken,
    () => getEffectiveDecryptedEnv(ctx.userId, workspaceId)
  )
  for (const activeConfig of activeConfigs) {
    const activeSecret = readSecretToken(activeConfig)
    if (activeSecret) return activeSecret
  }

  return generateShortId(TELEGRAM_SECRET_TOKEN_LENGTH)
}

function workspaceIdOf(workflowRecord: Record<string, unknown>): string | undefined {
  return typeof workflowRecord.workspaceId === 'string' ? workflowRecord.workspaceId : undefined
}

/** The env cleanup resolves a stored config with (`cleanupExternalWebhook`). */
async function backgroundEnvFor(workflowRecord: Record<string, unknown>) {
  const ownerUserId = workflowRecord.userId
  return typeof ownerUserId === 'string'
    ? resolveBackgroundWebhookEnv(ownerUserId, workspaceIdOf(workflowRecord))
    : {}
}

/**
 * Provider configs of other active-deployment Telegram webhooks in the workflow
 * using `botToken`. Rows store the bot token as authored, often a `{{VAR}}`
 * reference, while the caller holds it resolved, so each stored token is
 * resolved with `loadEnv` — the same env the caller resolved its own token with —
 * before comparing.
 */
async function findActiveTelegramConfigsForBot(
  webhookId: unknown,
  workflowRecord: Record<string, unknown>,
  botToken: string,
  loadEnv: () => Promise<Record<string, string>>
): Promise<Record<string, unknown>[]> {
  const workflowId = workflowRecord.id
  if (typeof workflowId !== 'string' || typeof webhookId !== 'string') return []

  const activeWebhooks = await db
    .select({ id: webhook.id, providerConfig: webhook.providerConfig })
    .from(webhook)
    .innerJoin(
      workflowDeploymentVersion,
      eq(webhook.deploymentVersionId, workflowDeploymentVersion.id)
    )
    .where(
      and(
        eq(webhook.workflowId, workflowId),
        ne(webhook.id, webhookId),
        eq(webhook.provider, 'telegram'),
        eq(workflowDeploymentVersion.workflowId, workflowId),
        eq(workflowDeploymentVersion.isActive, true),
        isNull(webhook.archivedAt)
      )
    )

  const activeConfigs = activeWebhooks.map((activeWebhook) =>
    getProviderConfig({ providerConfig: activeWebhook.providerConfig })
  )
  const referencesEnv = activeConfigs.some((config) =>
    createEnvVarPattern().test(String(config.botToken ?? ''))
  )
  const envVars = referencesEnv ? await loadEnv() : {}
  return activeConfigs.filter(
    (config) => resolveEnvVarReferences(config.botToken, envVars) === botToken
  )
}
