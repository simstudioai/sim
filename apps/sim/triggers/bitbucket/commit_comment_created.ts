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

export const bitbucketCommitCommentCreatedTrigger: TriggerConfig = {
  id: 'bitbucket_commit_comment_created',
  name: 'Bitbucket Commit Comment Created',
  provider: 'bitbucket',
  description: 'Trigger workflow when a comment is created on a Bitbucket commit',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_commit_comment_created',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Commit Comment Created'),
    extraFields: buildBitbucketExtraFields('bitbucket_commit_comment_created'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_commit_comment_created'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_commit_comment_created,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
