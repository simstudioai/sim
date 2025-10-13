/**
 * Subscription Management System
 *
 * Provides a clean interface for managing external provider subscriptions/webhooks:
 * - Microsoft Teams chat subscriptions (Graph API)
 * - Telegram bot webhooks
 * - Future providers...
 *
 * Usage:
 * ```ts
 * import { getSubscriptionManager } from '@/lib/webhooks/subscriptions'
 *
 * const manager = getSubscriptionManager(webhook)
 * if (manager) {
 *   const result = await manager.create(request, webhook, workflow, requestId)
 *   if (result.success) {
 *     // subscription created
 *   }
 * }
 * ```
 */

export * from './registry'
export { TeamsChatSubscriptionManager } from './teams-chat'
export { TelegramSubscriptionManager } from './telegram'
export * from './types'
