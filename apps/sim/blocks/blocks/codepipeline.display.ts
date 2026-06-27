import { CodePipelineIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const CodePipelineBlockDisplay = {
  type: 'codepipeline',
  name: 'CodePipeline',
  description: 'Run, monitor, and approve AWS CodePipeline pipelines',
  category: 'tools',
  bgColor: 'linear-gradient(45deg, #2E27AD 0%, #527FFF 100%)',
  icon: CodePipelineIcon,
  iconColor: '#527FFF',
  longDescription:
    'Integrate AWS CodePipeline into workflows. Start, stop, and monitor pipeline executions, retry failed stages, and approve or reject manual approval actions. Requires AWS access key and secret access key.',
  docsLink: 'https://docs.sim.ai/integrations/codepipeline',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
