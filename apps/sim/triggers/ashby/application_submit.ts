import { AshbyIcon } from '@/components/icons'
import { buildApplicationSubmitOutputs, buildAshbySubBlocks } from '@/triggers/ashby/utils'
import type { TriggerConfig } from '@/triggers/types'

/**
 * Ashby Application Submitted Trigger
 *
 * This is the PRIMARY trigger - it includes the dropdown for selecting trigger type.
 * Fires when a candidate submits an application or is manually added.
 */
export const ashbyApplicationSubmitTrigger: TriggerConfig = {
  id: 'ashby_application_submit',
  name: 'Ashby Application Submitted',
  provider: 'ashby',
  description: 'Trigger workflow when a new application is submitted',
  version: '1.0.0',
  icon: AshbyIcon,

  subBlocks: buildAshbySubBlocks({
    triggerId: 'ashby_application_submit',
    eventType: 'Application Submitted',
    includeDropdown: true,
  }),

  outputs: buildApplicationSubmitOutputs(),

  webhook: {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
  },
}
