import { SentryIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  buildIssueOutputs,
  buildSentryExtraFields,
  sentrySetupInstructions,
  sentryTriggerOptions,
} from '@/triggers/sentry/utils'
import type { TriggerConfig } from '@/triggers/types'

export const sentryIssueResolvedTrigger: TriggerConfig = {
  id: 'sentry_issue_resolved',
  name: 'Sentry Issue Resolved',
  provider: 'sentry',
  description: 'Trigger workflow when an issue is resolved in Sentry',
  version: '1.0.0',
  icon: SentryIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'sentry_issue_resolved',
    triggerOptions: sentryTriggerOptions,
    setupInstructions: sentrySetupInstructions('Issue'),
    extraFields: buildSentryExtraFields('sentry_issue_resolved'),
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
