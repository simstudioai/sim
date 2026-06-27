import { ZoomIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ZoomBlockDisplay = {
  type: 'zoom',
  name: 'Zoom',
  description: 'Create and manage Zoom meetings and recordings',
  category: 'tools',
  bgColor: '#2D8CFF',
  icon: ZoomIcon,
  iconColor: '#2D8CFF',
  longDescription:
    'Integrate Zoom into workflows. Create, list, update, and delete Zoom meetings. Get meeting details, invitations, recordings, and participants. Manage cloud recordings programmatically.',
  docsLink: 'https://docs.sim.ai/integrations/zoom',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
