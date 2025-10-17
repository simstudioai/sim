import { SearchIcon } from '@/components/icons'
import type { BlockConfig } from '@/blocks/types'
import type { SymbolFinderResponse } from '@/tools/symbol_finder/types'

export const SymbolFinderBlock: BlockConfig<SymbolFinderResponse> = {
  type: 'symbolFinder',
  name: 'Symbol Finder',
  description: 'Find meaningful symbols and imagery for target audiences',
  longDescription: 'Discover culturally relevant symbols, icons, and imagery that resonate with specific demographics and regions.',
  docsLink: 'https://docs.sim.ai/tools/symbol-finder',
  category: 'tools',
  bgColor: '#9B59B6',
  icon: SearchIcon,
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
      id: 'region',
      title: 'Region',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the region',
    },
    {
      id: 'targetAudience',
      title: 'Target Audience',
      type: 'short-input',
      layout: 'full',
      required: true,
      placeholder: 'Enter the target audience',
    },
  ],
  tools: {
    access: ['symbol_finder_execute'],
  },
  inputs: {
    objective: { type: 'string', description: 'Symbol finding objective' },
    region: { type: 'string', description: 'Target region' },
    targetAudience: { type: 'string', description: 'Target audience' },
  },
  outputs: {
    content: { type: 'string', description: 'Symbol finder results' },
  },
}