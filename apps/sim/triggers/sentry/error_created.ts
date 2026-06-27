import { SentryIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildErrorOutputs,
  buildSentryExtraFields,
  sentrySetupInstructions,
  sentryTriggerOptions,
} from '@/triggers/sentry/utils'
import type { TriggerConfig } from '@/triggers/types'

export const sentryErrorCreatedTrigger: TriggerConfig = {
  id: 'sentry_error_created',
  name: 'Sentry Error Created',
  provider: 'sentry',
  description: 'Trigger workflow when a new error event is created in Sentry',
  version: '1.0.0',
  icon: SentryIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'sentry_error_created',
    triggerOptions: sentryTriggerOptions,
    setupInstructions: sentrySetupInstructions('Error'),
    extraFields: buildSentryExtraFields('sentry_error_created'),
  }),
  outputs: buildErrorOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Sentry-Hook-Resource': 'error',
      'Sentry-Hook-Signature': 'hmac-sha256-hex',
    },
  },
}
