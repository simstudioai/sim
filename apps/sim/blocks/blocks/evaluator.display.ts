import { ChartBarIcon } from '@/components/icons'
import type { BlockDisplay } from '@/blocks/manifest'

export const EvaluatorBlockDisplay = {
  type: 'evaluator',
  name: 'Evaluator',
  description: 'Evaluate content',
  category: 'blocks',
  bgColor: '#4D5FFF',
  icon: ChartBarIcon,
  longDescription:
    'This is a core workflow block. Assess content quality using customizable evaluation metrics and scoring criteria. Create objective evaluation frameworks with numeric scoring to measure performance across multiple dimensions.',
  docsLink: 'https://docs.sim.ai/workflows/blocks/evaluator',
} satisfies BlockDisplay
