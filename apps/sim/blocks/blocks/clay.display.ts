import { ClayIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ClayBlockDisplay = {
  type: 'clay',
  name: 'Clay',
  description: 'Populate Clay workbook',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: ClayIcon,
  longDescription: 'Integrate Clay into the workflow. Can populate a table with data.',
  docsLink: 'https://docs.sim.ai/integrations/clay',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
