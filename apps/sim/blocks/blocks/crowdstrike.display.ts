import { CrowdStrikeIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const CrowdStrikeBlockDisplay = {
  type: 'crowdstrike',
  name: 'CrowdStrike',
  description: 'Query CrowdStrike Identity Protection sensors and documented aggregates',
  category: 'tools',
  bgColor: '#E01F3D',
  icon: CrowdStrikeIcon,
  iconColor: '#E01F3D',
  longDescription:
    'Integrate CrowdStrike Identity Protection into workflows to search sensors, fetch documented sensor details by device ID, and run documented sensor aggregate queries.',
  docsLink: 'https://docs.sim.ai/integrations/crowdstrike',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
