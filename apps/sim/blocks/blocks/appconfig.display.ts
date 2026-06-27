import { AppConfigIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AppConfigBlockDisplay = {
  type: 'appconfig',
  name: 'AWS AppConfig',
  description: 'Manage and retrieve configuration with AWS AppConfig',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #B0084D 0%, #FF4F8B 100%)',
  icon: AppConfigIcon,
  longDescription:
    'Integrate AWS AppConfig into workflows. Manage applications, environments, and configuration profiles, create and read hosted configuration versions, run and inspect deployments, and retrieve the latest deployed configuration at runtime. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/appconfig',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
