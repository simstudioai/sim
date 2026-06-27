import { ZoomInfoIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ZoomInfoBlockDisplay = {
  type: 'zoominfo',
  name: 'ZoomInfo',
  description: 'Search and enrich B2B company and contact data with ZoomInfo.',
  category: 'tools',
  bgColor: '#EA1B15',
  icon: ZoomInfoIcon,
  longDescription:
    'Integrates ZoomInfo into the workflow. Search companies and contacts, enrich firmographic and contact data, find intent signals, and pull news — all using the ZoomInfo GTM API.',
  docsLink: 'https://docs.sim.ai/integrations/zoominfo',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
