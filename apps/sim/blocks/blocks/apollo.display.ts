import { ApolloIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const ApolloBlockDisplay = {
  type: 'apollo',
  name: 'Apollo',
  description: 'Search, enrich, and manage contacts with Apollo.io',
  category: 'tools',
  bgColor: '#EBF212',
  icon: ApolloIcon,
  longDescription:
    'Integrates Apollo.io into the workflow. Search for people and companies, enrich contact data, manage your CRM contacts and accounts, add contacts to sequences, and create tasks.',
  docsLink: 'https://docs.sim.ai/integrations/apollo',
  integrationType: IntegrationType.Sales,
} satisfies BlockDisplay
