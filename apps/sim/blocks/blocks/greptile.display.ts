import { GreptileIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const GreptileBlockDisplay = {
  type: 'greptile',
  name: 'Greptile',
  description: 'AI-powered codebase search and Q&A',
  category: 'tools',
  bgColor: '#181C1E',
  icon: GreptileIcon,
  longDescription:
    'Query and search codebases using natural language with Greptile. Get AI-generated answers about your code, find relevant files, and understand complex codebases.',
  docsLink: 'https://docs.sim.ai/integrations/greptile',
  integrationType: IntegrationType.DevOps,
} satisfies BlockDisplay
