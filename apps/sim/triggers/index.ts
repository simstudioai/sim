// Import trigger definitions

import { airtableWebhookTrigger } from './airtable'
import { genericWebhookTrigger } from './generic'
import { githubWebhookTrigger } from './github'
import { gmailPollingTrigger } from './gmail'
import { googleFormsWebhookTrigger } from './googleforms/webhook'
import {
  microsoftTeamsChatSubscriptionTrigger,
  microsoftTeamsWebhookTrigger,
} from './microsoftteams'
import { outlookPollingTrigger } from './outlook'
import { slackWebhookTrigger } from './slack'
import { stripeWebhookTrigger } from './stripe/webhook'
import { telegramWebhookTrigger } from './telegram'
import type { TriggerConfig, TriggerRegistry } from './types'
import {
  webflowCollectionItemChangedTrigger,
  webflowCollectionItemCreatedTrigger,
  webflowCollectionItemDeletedTrigger,
  webflowFormSubmissionTrigger,
} from './webflow'
import { whatsappWebhookTrigger } from './whatsapp'

// Central registry of all available triggers
export const TRIGGER_REGISTRY: TriggerRegistry = {
  slack_webhook: slackWebhookTrigger,
  airtable_webhook: airtableWebhookTrigger,
  generic_webhook: genericWebhookTrigger,
  github_webhook: githubWebhookTrigger,
  gmail_poller: gmailPollingTrigger,
  microsoftteams_webhook: microsoftTeamsWebhookTrigger,
  microsoftteams_chat_subscription: microsoftTeamsChatSubscriptionTrigger,
  outlook_poller: outlookPollingTrigger,
  stripe_webhook: stripeWebhookTrigger,
  telegram_webhook: telegramWebhookTrigger,
  whatsapp_webhook: whatsappWebhookTrigger,
  google_forms_webhook: googleFormsWebhookTrigger,
  webflow_collection_item_created: webflowCollectionItemCreatedTrigger,
  webflow_collection_item_changed: webflowCollectionItemChangedTrigger,
  webflow_collection_item_deleted: webflowCollectionItemDeletedTrigger,
  webflow_form_submission: webflowFormSubmissionTrigger,
}

// Utility functions for working with triggers
export function getTrigger(triggerId: string): TriggerConfig | undefined {
  return TRIGGER_REGISTRY[triggerId]
}

export function getTriggersByProvider(provider: string): TriggerConfig[] {
  return Object.values(TRIGGER_REGISTRY).filter((trigger) => trigger.provider === provider)
}

export function getAllTriggers(): TriggerConfig[] {
  return Object.values(TRIGGER_REGISTRY)
}

export function getTriggerIds(): string[] {
  return Object.keys(TRIGGER_REGISTRY)
}

export function isTriggerValid(triggerId: string): boolean {
  return triggerId in TRIGGER_REGISTRY
}

// Export types for use elsewhere
export type { TriggerConfig, TriggerRegistry } from './types'
