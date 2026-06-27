import { PagerDutyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PagerDutyBlockDisplay = {
  type: 'pagerduty',
  name: 'PagerDuty',
  description: 'Manage incidents and on-call schedules with PagerDuty',
  category: 'tools',
  bgColor: '#06AC38',
  icon: PagerDutyIcon,
  iconColor: '#06AC38',
  longDescription:
    'Integrate PagerDuty into your workflow to list, create, and update incidents, add notes, list services, and check on-call schedules.',
  docsLink: 'https://docs.sim.ai/integrations/pagerduty',
  integrationType: IntegrationType.Observability,
  triggerAllowed: true,
} satisfies BlockDisplay
