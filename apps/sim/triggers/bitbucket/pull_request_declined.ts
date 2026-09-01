import { BitbucketIcon } from '@/components/icons'
import { buildTriggerSubBlocks } from '@/triggers'
import {
  BITBUCKET_TRIGGER_EVENT_MAP,
  bitbucketSetupInstructions,
  bitbucketTriggerOptions,
  buildBitbucketExtraFields,
  buildBitbucketOutputs,
} from '@/triggers/bitbucket/utils'
import type { TriggerConfig } from '@/triggers/types'

export const bitbucketPullRequestDeclinedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_declined',
  name: 'Bitbucket Pull Request Declined',
  provider: 'bitbucket',
  description: 'Trigger workflow when a Bitbucket pull request is declined',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_declined',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Declined'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_declined'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_declined'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_declined,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
