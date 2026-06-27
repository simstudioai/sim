import { DsPyIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'
import { IntegrationType } from '@/blocks/types'

export const DSPyBlockDisplay = {
  type: 'dspy',
  name: 'DSPy',
  description: 'Run predictions using self-hosted DSPy programs',
  category: 'tools',
  bgColor: '#FFFFFF',
  icon: DsPyIcon,
  longDescription:
    'Integrate with your self-hosted DSPy programs for LLM-powered predictions. Supports Predict, Chain of Thought, and ReAct agents. DSPy is the framework for programming—not prompting—language models.',
  docsLink: 'https://docs.sim.ai/integrations/dspy',
  integrationType: IntegrationType.AI,
} satisfies BlockDisplay
