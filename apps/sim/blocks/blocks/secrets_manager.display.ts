import { SecretsManagerIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const SecretsManagerBlockDisplay = {
  type: 'secrets_manager',
  name: 'AWS Secrets Manager',
  description: 'Connect to AWS Secrets Manager',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #BD0816 0%, #FF5252 100%)',
  icon: SecretsManagerIcon,
  longDescription:
    'Integrate AWS Secrets Manager into the workflow. Can retrieve, create, update, list, and delete secrets.',
  docsLink: 'https://docs.sim.ai/integrations/secrets_manager',
  integrationType: IntegrationType.Security,
} satisfies BlockDisplay
