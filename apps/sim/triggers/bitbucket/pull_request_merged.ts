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

export const bitbucketPullRequestMergedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_merged',
  name: 'Bitbucket Pull Request Merged',
  provider: 'bitbucket',
  description: 'Trigger workflow when a Bitbucket pull request is merged',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_merged',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Merged'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_merged'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_merged'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_merged,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
