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

export const bitbucketPullRequestCommentCreatedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_comment_created',
  name: 'Bitbucket Pull Request Comment Created',
  provider: 'bitbucket',
  description: 'Trigger workflow when a comment is created on a Bitbucket pull request',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_comment_created',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Comment Created'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_comment_created'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_comment_created'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_comment_created,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
