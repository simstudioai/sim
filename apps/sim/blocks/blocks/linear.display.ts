import { LinearIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const LinearBlockDisplay = {
  type: 'linear',
  name: 'Linear (Legacy)',
  description: 'Interact with Linear issues, projects, and more',
  category: 'tools',
  bgColor: '#5E6AD2',
  icon: LinearIcon,
  longDescription:
    'Integrate Linear into the workflow. Can manage issues, comments, projects, labels, workflow states, cycles, attachments, and more. Can also trigger workflows based on Linear webhook events.',
  docsLink: 'https://docs.sim.ai/integrations/linear',
  integrationType: IntegrationType.Productivity,
  hideFromToolbar: true,
  triggerAllowed: true,
} satisfies BlockDisplay

export const LinearV2BlockDisplay = {
  ...LinearBlockDisplay,
  type: 'linear_v2',
  name: 'Linear',
  hideFromToolbar: false,
} satisfies BlockDisplay
