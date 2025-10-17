import { SignalIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SymbolEvaluatorResponse } from '@/tools/symbol_evaluator/types'

export const SymbolEvaluatorBlock: BlockConfig<SymbolEvaluatorResponse> = {
  type: 'symbolEvaluator',
  name: 'Symbol Evaluator',
  description: 'Evaluate symbol effectiveness for target audiences',
  longDescription: 'Analyze and evaluate how well symbols resonate with specific target audiences and objectives.',
  docsLink: 'https://docs.sim.ai/tools/symbol-evaluator',
  category: 'tools',
  bgColor: '#8E44AD',
  icon: SignalIcon,
  subBlocks: [
    {
      id: 'objective',
      title: 'Objective',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the objective',
    },
    {
      id: 'supportingObjective',
      title: 'Supporting Objective',
      type: 'short-input',
      layout: 'full',
      required: false,
      placeholder: 'Enter supporting objective (optional)',
    },
    {
      id: 'targetAudience',
      title: 'Target Audience',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the target audience',
    },
    {
      id: 'region',
      title: 'Region',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the region',
    },
    {
      id: 'symbols',
      title: 'Symbols',
      type: 'long-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter symbols to evaluate',
    },
  ],
  tools: {
    access: ['symbol_evaluator_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Main objective' },
    supportingObjective: { type: 'string', description: 'Supporting objective (optional)' },
    targetAudience: { type: 'string', description: 'Target audience' },
    region: { type: 'string', description: 'Target region' },
    symbols: { type: 'string', description: 'Symbols to evaluate' },
  },
  outputs: {
    content: { type: 'string', description: 'Symbol evaluator results' },
  },
}