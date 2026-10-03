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

export const bitbucketPushTrigger: TriggerConfig = {
  id: 'bitbucket_push',
  name: 'Bitbucket Push',
  provider: 'bitbucket',
  description: 'Trigger workflow when commits are pushed to a Bitbucket repository',
  version: '1.0.0',
  icon: BitbucketIcon,
  subBlocks: buildTriggerSubBlocks({
    triggerId: 'bitbucket_push',
    triggerOptions: [...bitbucketTriggerOptions],
    includeDropdown: true,
    setupInstructions: bitbucketSetupInstructions('Push'),
    extraFields: buildBitbucketExtraFields('bitbucket_push'),
  }),
  outputs: buildBitbucketOutputs('bitbucket_push'),
  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Event-Key': BITBUCKET_TRIGGER_EVENT_MAP.bitbucket_push,
      'X-Hub-Signature': 'sha256=...',
    },
  },
}
