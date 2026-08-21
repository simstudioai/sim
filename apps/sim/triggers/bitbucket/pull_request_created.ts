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

export const bitbucketPullRequestCreatedTrigger: TriggerConfig = {
  id: 'bitbucket_pull_request_created',
  name: 'Bitbucket Pull Request Created',
  provider: 'bitbucket',
  description: 'Trigger workflow when a Bitbucket pull request is created',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_pull_request_created',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Pull Request Created'),
    extraFields: buildBitbucketExtraFields('bitbucket_pull_request_created'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_pull_request_created'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_pull_request_created,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
