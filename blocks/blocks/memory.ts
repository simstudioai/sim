import { BrainIcon } from '@/components/icons'
import { BlockConfig } from '../types'

export const MemoryBlock: BlockConfig = {
  type: 'memory',
  name: 'Memory',
  description: 'Add memory store',
  bgColor: '#FF65BF',
  icon: BrainIcon,
  category: 'blocks',
  tools: {
    access: [],
  },
  inputs: {
    code: { type: 'string', required: true },
    timeout: { type: 'number', required: false },
    memoryLimit: { type: 'number', required: false },
  },
  outputs: {
    response: {
      type: {
        result: 'any',
        stdout: 'string',
        executionTime: 'number',
      },
    },
  },
  subBlocks: [
    {
      id: 'code',
      type: 'code',
      layout: 'full',
    },
  ],
}
