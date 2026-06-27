import { SentryIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIssueOutputs,
  buildSentryExtraFields,
  sentrySetupInstructions,
  sentryTriggerOptions,
} from '@/triggers/sentry/utils'
import type { TriggerConfig } from '@/triggers/types'

export const sentryIssueCreatedTrigger: TriggerConfig = {
  id: 'sentry_issue_created',
  name: 'Sentry Issue Created',
  provider: 'sentry',
  description: 'Trigger workflow when a new issue is created in Sentry',
  version: '1.0.0',
  icon: SentryIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'sentry_issue_created',
    triggerOptions: sentryTriggerOptions,
    includeDropdown: true,
    setupInstructions: sentrySetupInstructions('Issue'),
    extraFields: buildSentryExtraFields('sentry_issue_created'),
  }),
  outputs: buildIssueOutputs(),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Sentry-Hook-Resource': 'issue',
      'Sentry-Hook-Signature': 'hmac-sha256-hex',
    },
  },
}
