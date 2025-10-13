import type { NextRequest } from 'next/server'
import { env } from '@/lib/env'
import { createLogger } from '@/lib/logs/console/logger'
import {
  BaseSubscriptionManager,
  type SubscriptionOperationResult,
  type WebhookData,
  type WorkflowData,
} from './types'

const logger = createLogger('TelegramSubscriptionManager')

/**
 * Manages Telegram bot webhooks
 *
 * Telegram uses a single webhook per bot (not per chat/workflow).
 * We register our callback URL with the Telegram Bot API.
 */
export class TelegramSubscriptionManager extends BaseSubscriptionManager {
  readonly id = 'telegram'

  canHandle(webhook: WebhookData): boolean {
    return webhook.provider === 'telegram'
  }

  async create(
    request: NextRequest,
    webhook: WebhookData,
    _workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult> {
    try {
      const config = webhook.providerConfig as Record<string, unknown>
      const botToken = config.botToken as string | undefined

      if (!botToken) {
        logger.warn(`[${requestId}] Missing botToken for Telegram webhook ${webhook.id}`)
        return { success: false, error: 'Missing botToken' }
      }

      if (!env.NEXT_PUBLIC_APP_URL) {
        logger.error(
          `[${requestId}] NEXT_PUBLIC_APP_URL not configured, cannot register Telegram webhook`
        )
        return { success: false, error: 'NEXT_PUBLIC_APP_URL not configured' }
      }

      const notificationUrl = `${env.NEXT_PUBLIC_APP_URL}/api/webhooks/trigger/${webhook.path}`

      const telegramApiUrl = `https://api.telegram.org/bot${botToken}/setWebhook`
      const telegramResponse = await fetch(telegramApiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'TelegramBot/1.0',
        },
        body: JSON.stringify({ url: notificationUrl }),
      })

      const responseBody = await telegramResponse.json()
      if (!telegramResponse.ok || !responseBody.ok) {
        const errorMessage =
          responseBody.description ||
          `Failed to create Telegram webhook. Status: ${telegramResponse.status}`
        logger.error(`[${requestId}] ${errorMessage}`, { response: responseBody })
        return { success: false, error: errorMessage }
      }

      logger.info(`[${requestId}] Successfully created Telegram webhook for webhook ${webhook.id}`)

      // Optionally fetch webhook info for verification
      try {
        const webhookInfoUrl = `https://api.telegram.org/bot${botToken}/getWebhookInfo`
        const infoResponse = await fetch(webhookInfoUrl, {
          headers: { 'User-Agent': 'TelegramBot/1.0' },
        })
        if (infoResponse.ok) {
          const infoBody = await infoResponse.json()
          logger.info(`[${requestId}] Telegram webhook info:`, {
            url: infoBody.result?.url,
            has_custom_certificate: infoBody.result?.has_custom_certificate,
            pending_update_count: infoBody.result?.pending_update_count,
          })
        }
      } catch (err) {
        logger.debug(`[${requestId}] Could not fetch Telegram webhook info`)
      }

      return { success: true }
    } catch (error: unknown) {
      logger.error(
        `[${requestId}] Error creating Telegram webhook for webhook ${webhook.id}`,
        error
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  async renew(
    _webhook: WebhookData,
    _workflow: WorkflowData,
    _requestId: string
  ): Promise<SubscriptionOperationResult> {
    // Telegram webhooks don't expire; no renewal needed
    return { success: true }
  }

  needsRenewal(_webhook: WebhookData, _thresholdMs?: number): boolean {
    // Telegram webhooks don't expire
    return false
  }

  async delete(
    webhook: WebhookData,
    _workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult> {
    try {
      const config = webhook.providerConfig as Record<string, unknown>
      const botToken = config.botToken as string | undefined

      if (!botToken) {
        logger.warn(`[${requestId}] Missing botToken for Telegram webhook deletion ${webhook.id}`)
        return { success: false, error: 'Missing botToken' }
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
        logger.error(`[${requestId}] ${errorMessage}`, { response: responseBody })
        return { success: false, error: errorMessage }
      }

      logger.info(`[${requestId}] Successfully deleted Telegram webhook for webhook ${webhook.id}`)
      return { success: true }
    } catch (error: unknown) {
      logger.error(
        `[${requestId}] Error deleting Telegram webhook for webhook ${webhook.id}`,
        error
      )
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
}
