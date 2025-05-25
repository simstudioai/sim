import { RepeatIcon } from 'lucide-react'

export const LoopTool = {
  id: 'loop',
  type: 'loop',
  name: 'Loop',
  description: 'Create a Loop',
  icon: RepeatIcon,
  bgColor: '#2FB3FF',
  data: {
    label: 'Loop',
    loopType: 'for',
    count: 5,
    collection: '',
    width: 500,
    height: 300,
    extent: 'parent',
    executionState: {
      currentIteration: 0,
      isExecuting: false,
      startTime: null,
      endTime: null,
    },
  },
  style: {
    width: 500,
    height: 300,
  },
  // Specify that this should be rendered as a ReactFlow group node
  isResizable: true,
}
