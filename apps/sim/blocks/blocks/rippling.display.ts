import { RipplingIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const RipplingBlockDisplay = {
  type: 'rippling',
  name: 'Rippling',
  description: 'Manage workers, departments, custom objects, and company data in Rippling',
  category: 'tools',
  bgColor: '#502D3C',
  icon: RipplingIcon,
  longDescription:
    'Integrate Rippling Platform into your workflow. Manage workers, users, departments, teams, titles, work locations, business partners, supergroups, custom objects, custom apps, custom pages, custom settings, object categories, reports, and draft hires.',
  docsLink: 'https://docs.sim.ai/integrations/rippling',
  integrationType: IntegrationType.HR,
} satisfies BlockDisplay
