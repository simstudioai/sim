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

export const bitbucketPullRequestChangesRequestRemovedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_changes_request_removed',
  name: 'Bitbucket Pull Request Changes Request Removed',
  provider: 'bitbucket',
  description: 'Trigger workflow when a changes request is removed from a Bitbucket pull request',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_changes_request_removed',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Changes Request Removed'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_changes_request_removed'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_changes_request_removed'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_changes_request_removed,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
