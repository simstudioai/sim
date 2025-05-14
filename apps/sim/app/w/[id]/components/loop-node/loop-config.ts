import { RepeatIcon } from 'lucide-react'

export const LoopTool = {
  id: 'loop',
  type: 'loop',
  name: 'Loop',
  description: 'Create a Loop',
  icon: RepeatIcon,
  bgColor: '#40E0D0',
  data: {
    label: 'Loop',
    loopType: 'for',
    count: 5,
    collection: '',
    width: 800,
    height: 1000,
    extent: 'parent',
    // Store loop execution state
    executionState: {
      currentIteration: 0,
      isExecuting: false,
      startTime: null,
      endTime: null,
    }
  },
  style: {
    width: 800,
    height: 1000,
  },
  // Specify that this should be rendered as a ReactFlow group node
  isResizable: true,
} 