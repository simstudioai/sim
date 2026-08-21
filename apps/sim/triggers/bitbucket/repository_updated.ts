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

export const bitbucketRepositoryUpdatedTrigger: TriggerConfig = {
  id: 'bitbucket_repository_updated',
  name: 'Bitbucket Repository Updated',
  provider: 'bitbucket',
  description: 'Trigger workflow when a Bitbucket repository is updated',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_repository_updated',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Repository Updated'),
    extraFields: buildBitbucketExtraFields('bitbucket_repository_updated'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_repository_updated'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_repository_updated,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
