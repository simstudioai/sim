import { airtableWebhookTrigger } from '@/triggers/airtable'
import { genericWebhookTrigger } from '@/triggers/generic'
import { githubWebhookTrigger } from '@/triggers/github'
import { gmailPollingTrigger } from '@/triggers/gmail'
import { googleFormsWebhookTrigger } from '@/triggers/googleforms'
import {
  microsoftTeamsChatSubscriptionTrigger,
  microsoftTeamsWebhookTrigger,
} from '@/triggers/microsoftteams'
import { outlookPollingTrigger } from '@/triggers/outlook'
import { slackWebhookTrigger } from '@/triggers/slack'
import { stripeWebhookTrigger } from '@/triggers/stripe'
import { telegramWebhookTrigger } from '@/triggers/telegram'
import type { TriggerRegistry } from '@/triggers/types'
import {
  webflowCollectionItemChangedTrigger,
  webflowCollectionItemCreatedTrigger,
  webflowCollectionItemDeletedTrigger,
  webflowFormSubmissionTrigger,
} from '@/triggers/webflow'
import { whatsappWebhookTrigger } from '@/triggers/whatsapp'
import { twilioVoiceWebhookTrigger } from '@/triggers/twilio_voice/webhook'

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
  twilio_voice_webhook: twilioVoiceWebhookTrigger,
  webflow_collection_item_created: webflowCollectionItemCreatedTrigger,
  webflow_collection_item_changed: webflowCollectionItemChangedTrigger,
  webflow_collection_item_deleted: webflowCollectionItemDeletedTrigger,
  webflow_form_submission: webflowFormSubmissionTrigger,
}
