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

export const bitbucketPullRequestCommentDeletedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_comment_deleted',
  name: 'Bitbucket Pull Request Comment Deleted',
  provider: 'bitbucket',
  description: 'Trigger workflow when a comment is deleted from a Bitbucket pull request',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_comment_deleted',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Comment Deleted'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_comment_deleted'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_comment_deleted'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_comment_deleted,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
