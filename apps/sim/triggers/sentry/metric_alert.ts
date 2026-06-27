import { SentryIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildMetricAlertOutputs,
  buildSentryExtraFields,
  sentrySetupInstructions,
  sentryTriggerOptions,
} from '@/triggers/sentry/utils'
import type { TriggerConfig } from '@/triggers/types'

export const sentryMetricAlertTrigger: TriggerConfig = {
  id: 'sentry_metric_alert',
  name: 'Sentry Metric Alert',
  provider: 'sentry',
  description:
    'Trigger workflow when a Sentry metric alert changes state (critical, warning, resolved)',
  version: '1.0.0',
  icon: SentryIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'sentry_metric_alert',
    triggerOptions: sentryTriggerOptions,
    setupInstructions: sentrySetupInstructions('Metric Alert'),
    extraFields: buildSentryExtraFields('sentry_metric_alert'),
  }),
  outputs: buildMetricAlertOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Sentry-Hook-Resource': 'metric_alert',
      'Sentry-Hook-Signature': 'hmac-sha256-hex',
    },
  },
}
