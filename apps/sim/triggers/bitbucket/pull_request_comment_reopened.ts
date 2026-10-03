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

export const bitbucketPullRequestCommentReopenedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_comment_reopened',
  name: 'Bitbucket Pull Request Comment Reopened',
  provider: 'bitbucket',
  description: 'Trigger workflow when a resolved comment is reopened on a Bitbucket pull request',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_comment_reopened',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Comment Reopened'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_comment_reopened'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_comment_reopened'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_comment_reopened,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
