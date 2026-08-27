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

export const bitbucketPullRequestApprovedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_approved',
  name: 'Bitbucket Pull Request Approved',
  provider: 'bitbucket',
  description: 'Trigger workflow when a Bitbucket pull request is approved',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_approved',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Approved'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_approved'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_approved'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_approved,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
