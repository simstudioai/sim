import { MicrosoftPlannerIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const MicrosoftPlannerBlockDisplay = {
  type: 'microsoft_planner',
  name: 'Microsoft Planner',
  description: 'Manage tasks, plans, and buckets in Microsoft Planner',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: MicrosoftPlannerIcon,
  longDescription:
    'Integrate Microsoft Planner into the workflow. Manage tasks, plans, buckets, and task details including checklists and references.',
  docsLink: 'https://docs.sim.ai/integrations/microsoft_planner',
  integrationType: IntegrationType.Productivity,
} satisfies BlockDisplay
