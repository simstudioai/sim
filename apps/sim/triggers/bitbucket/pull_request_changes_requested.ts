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

export const bitbucketPullRequestChangesRequestedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_changes_requested',
  name: 'Bitbucket Pull Request Changes Requested',
  provider: 'bitbucket',
  description: 'Trigger workflow when changes are requested on a Bitbucket pull request',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_changes_requested',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Changes Requested'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_changes_requested'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_changes_requested'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_changes_requested,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
