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

export const bitbucketPullRequestCommentUpdatedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_comment_updated',
  name: 'Bitbucket Pull Request Comment Updated',
  provider: 'bitbucket',
  description: 'Trigger workflow when a comment is updated on a Bitbucket pull request',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_comment_updated',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Comment Updated'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_comment_updated'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_comment_updated'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_comment_updated,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
