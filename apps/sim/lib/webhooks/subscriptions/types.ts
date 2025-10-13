import type { NextRequest } from 'next/server'

/**
 * Result of a subscription operation
 */
export interface SubscriptionOperationResult {
  success: boolean
  externalId?: string
  expiresAt?: Date
  error?: string
  metadata?: Record<string, unknown>
}

/**
 * Webhook data shape for subscription operations
 */
export interface WebhookData {
  id: string
  path: string
  workflowId: string
  provider: string | null
  providerConfig: Record<string, unknown>
}

/**
 * Workflow data shape for subscription operations
 */
export interface WorkflowData {
  id: string
  userId: string
  workspaceId: string | null
}

/**
 * Core interface for managing provider-specific subscriptions/webhooks
 *
 * Implementations handle the full lifecycle of external provider resources:
 * - Creation when a webhook is first saved
 * - Renewal/refresh before expiration
 * - Deletion when a webhook is removed
 *
 * This separates provider-specific logic from the webhook API routes and
 * background jobs, making it easy to add new providers.
 */
export interface SubscriptionManager {
  /**
   * Unique identifier for this manager (e.g., 'microsoftteams_chat', 'telegram')
   */
  readonly id: string

  /**
   * Check if this manager can handle the given webhook
   */
  canHandle(webhook: WebhookData): boolean

  /**
   * Create a new subscription/webhook with the provider
   * Called when a webhook is first created or updated
   *
   * @param request - The incoming HTTP request (for URL origin, etc.)
   * @param webhook - The webhook record
   * @param workflow - The workflow owning this webhook
   * @param requestId - Request ID for logging
   * @returns Result with externalId and expiresAt if successful
   */
  create(
    request: NextRequest,
    webhook: WebhookData,
    workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult>

  /**
   * Renew/refresh an existing subscription before it expires
   * Called by background jobs
   *
   * @param webhook - The webhook record with providerConfig
   * @param workflow - The workflow owning this webhook
   * @param requestId - Request ID for logging
   * @returns Result with new expiresAt if successful
   */
  renew(
    webhook: WebhookData,
    workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult>

  /**
   * Delete/revoke a subscription with the provider
   * Called when a webhook is deleted
   *
   * @param webhook - The webhook record
   * @param workflow - The workflow owning this webhook
   * @param requestId - Request ID for logging
   * @returns Result indicating success or failure
   */
  delete(
    webhook: WebhookData,
    workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult>

  /**
   * Check if this subscription needs renewal
   * Used by background jobs to find expiring subscriptions
   *
   * @param webhook - The webhook record
   * @param thresholdMs - How many milliseconds in advance to renew (default: 48h)
   * @returns true if renewal is needed
   */
  needsRenewal(webhook: WebhookData, thresholdMs?: number): boolean
}

/**
 * Base class with common utilities for subscription managers
 */
export abstract class BaseSubscriptionManager implements SubscriptionManager {
  abstract readonly id: string

  abstract canHandle(webhook: WebhookData): boolean

  abstract create(
    request: NextRequest,
    webhook: WebhookData,
    workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult>

  abstract renew(
    webhook: WebhookData,
    workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult>

  abstract delete(
    webhook: WebhookData,
    workflow: WorkflowData,
    requestId: string
  ): Promise<SubscriptionOperationResult>

  /**
   * Default implementation checks providerConfig.subscriptionExpiration
   */
  needsRenewal(webhook: WebhookData, thresholdMs = 48 * 60 * 60 * 1000): boolean {
    const config = webhook.providerConfig as Record<string, unknown>
    const expirationStr = config.subscriptionExpiration as string | undefined

    if (!expirationStr) return false

    try {
      const expiresAt = new Date(expirationStr)
      const threshold = new Date(Date.now() + thresholdMs)
      return expiresAt <= threshold
    } catch {
      return false
    }
  }

  /**
   * Helper to persist updated providerConfig fields back to the database
   */
  protected async persistConfig(
    webhookId: string,
    updates: Record<string, unknown>
  ): Promise<void> {
    const { db } = await import('@sim/db')
    const { webhook } = await import('@sim/db/schema')
    const { eq } = await import('drizzle-orm')

    // Fetch current config to merge
    const rows = await db.select().from(webhook).where(eq(webhook.id, webhookId)).limit(1)
    if (rows.length === 0) return

    const currentConfig = (rows[0].providerConfig as Record<string, unknown>) || {}
    const updatedConfig = { ...currentConfig, ...updates }

    await db
      .update(webhook)
      .set({ providerConfig: updatedConfig, updatedAt: new Date() })
      .where(eq(webhook.id, webhookId))
  }
}
