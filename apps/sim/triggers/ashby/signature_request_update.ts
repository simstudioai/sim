import { AshbyIcon } from '@/components/icons'
import { buildAshbySubBlocks, buildSignatureRequestUpdateOutputs } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'
export const ashbySignatureRequestUpdateTrigger: TriggerConfig = {
  id: 'ashby_signature_request_update',
  name: 'Ashby Signature Request Updated',
  provider: 'ashby',
  description: 'Trigger workflow when an e-signature request changes state',
  version: '1.0.0',
  icon: AshbyIcon,
  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_signature_request_update',
    eventType: 'Signature Request Updated',
  }),
  outputs: buildSignatureRequestUpdateOutputs(),
  webhook: { method: 'POST', headers: { 'Content-Type': 'application/json' } },
}
