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

export const bitbucketRepositoryForkedTrigger: TriggerConfig = {
  id: 'bitbucket_repository_forked',
  name: 'Bitbucket Repository Forked',
  provider: 'bitbucket',
  description: 'Trigger workflow when a Bitbucket repository is forked',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_repository_forked',
    triggerOptions: [...bitbucketTriggerOptions],
    setupInstructions: bitbucketSetupInstructions('Repository Forked'),
    extraFields: buildBitbucketExtraFields('bitbucket_repository_forked'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_repository_forked'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_repository_forked,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
