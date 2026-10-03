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

export const bitbucketPullRequestCommentResolvedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_comment_resolved',
  name: 'Bitbucket Pull Request Comment Resolved',
  provider: 'bitbucket',
  description: 'Trigger workflow when a comment is resolved on a Bitbucket pull request',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_comment_resolved',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Comment Resolved'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_comment_resolved'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_comment_resolved'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_comment_resolved,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
