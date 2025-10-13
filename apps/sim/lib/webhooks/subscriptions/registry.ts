import { TeamsChatSubscriptionManager } from './teams-chat'
import { TelegramSubscriptionManager } from './telegram'
import type { SubscriptionManager, WebhookData } from './types'

/**
 * Central registry of all subscription managers
 *
 * New providers can be added here by:
 * 1. Creating a class that implements SubscriptionManager
 * 2. Registering an instance in this array
 */
const managers: SubscriptionManager[] = [
  new TeamsChatSubscriptionManager(),
  new TelegramSubscriptionManager(),
]

/**
 * Find the appropriate subscription manager for a webhook
 *
 * @param webhook - The webhook to find a manager for
 * @returns The manager that can handle this webhook, or null
 */
export function getSubscriptionManager(webhook: WebhookData): SubscriptionManager | null {
  return managers.find((m) => m.canHandle(webhook)) || null
}

/**
 * Get all registered subscription managers
 * Useful for background jobs that need to check all providers
 */
export function getAllSubscriptionManagers(): SubscriptionManager[] {
  return managers
}

/**
 * Get a subscription manager by ID
 */
export function getSubscriptionManagerById(id: string): SubscriptionManager | null {
  return managers.find((m) => m.id === id) || null
}
