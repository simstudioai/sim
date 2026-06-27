import { AthenaIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const AthenaBlockDisplay = {
  type: 'athena',
  name: 'Athena',
  description: 'Run SQL queries on data in Amazon S3 using AWS Athena',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #4D27A8 0%, #A166FF 100%)',
  icon: AthenaIcon,
  iconColor: '#A166FF',
  longDescription:
    'Integrate AWS Athena into workflows. Execute SQL queries against data in S3, check query status, retrieve results, manage named queries, and list executions. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/athena',
  integrationType: IntegrationType.Analytics,
} satisfies BlockDisplay
