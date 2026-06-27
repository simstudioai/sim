import { GoogleMeetIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GoogleMeetBlockDisplay = {
  type: 'google_meet',
  name: 'Google Meet',
  description: 'Create and manage Google Meet meetings',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: GoogleMeetIcon,
  longDescription:
    'Integrate Google Meet into your workflow. Create meeting spaces, get space details, end conferences, list conference records, and view participants.',
  docsLink: 'https://docs.sim.ai/integrations/google_meet',
  integrationType: IntegrationType.Communication,
} satisfies BlockDisplay
