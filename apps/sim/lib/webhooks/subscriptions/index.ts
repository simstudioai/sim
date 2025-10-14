/**
 * Subscription Management System
 *
 * Provides a clean interface for managing external provider subscriptions/webhooks:
 * - Microsoft Teams chat subscriptions (Graph API)
 * - Telegram bot webhooks
 * - Future providers...
 */

export * from './registry'
export { TeamsChatSubscriptionManager } from './teams-chat'
export { TelegramSubscriptionManager } from './telegram'
export * from './types'
