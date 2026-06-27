import { InfisicalIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const InfisicalBlockDisplay = {
  type: 'infisical',
  name: 'Infisical',
  description: 'Manage secrets with Infisical',
  category: 'tools',
  bgColor: '#F7FE62',
  icon: InfisicalIcon,
  longDescription:
    'Integrate Infisical into your workflow. List, get, create, update, and delete secrets across project environments.',
  docsLink: 'https://docs.sim.ai/integrations/infisical',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
