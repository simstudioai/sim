import { SentryIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIssueAlertOutputs,
  buildSentryExtraFields,
  sentrySetupInstructions,
  sentryTriggerOptions,
} from '@/triggers/sentry/utils'
import type { TriggerConfig } from '@/triggers/types'

export const sentryIssueAlertTrigger: TriggerConfig = {
  id: 'sentry_issue_alert',
  name: 'Sentry Issue Alert',
  provider: 'sentry',
  description: 'Trigger workflow when a Sentry issue alert rule fires',
  version: '1.0.0',
  icon: SentryIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'sentry_issue_alert',
    triggerOptions: sentryTriggerOptions,
    setupInstructions: sentrySetupInstructions('Issue Alert'),
    extraFields: buildSentryExtraFields('sentry_issue_alert'),
  }),
  outputs: buildIssueAlertOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Sentry-Hook-Resource': 'event_alert',
      'Sentry-Hook-Signature': 'hmac-sha256-hex',
    },
  },
}
