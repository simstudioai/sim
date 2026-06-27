import { PeopleDataLabsIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const PeopleDataLabsBlockDisplay = {
  type: 'peopledatalabs',
  name: 'People Data Labs',
  description: 'Enrich and search people and companies',
  category: 'tools',
  bgColor: '#4831C3',
  icon: PeopleDataLabsIcon,
  iconColor: '#4831C3',
  longDescription:
    'Enrich a single person or company with People Data Labs, or search the global person and company datasets with SQL or Elasticsearch DSL. Useful for sales enrichment, contact lookup, and CRM hygiene.',
  docsLink: 'https://docs.sim.ai/integrations/peopledatalabs',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
