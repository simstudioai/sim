import { DubIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DubBlockDisplay = {
  type: 'dub',
  name: 'Dub',
  description: 'Link management with Dub',
  category: 'tools',
  bgColor: '#181C1E',
  icon: DubIcon,
  longDescription:
    'Create, manage, and track short links with Dub. Supports custom domains, UTM parameters, link analytics, and more.',
  docsLink: 'https://docs.sim.ai/integrations/dub',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
