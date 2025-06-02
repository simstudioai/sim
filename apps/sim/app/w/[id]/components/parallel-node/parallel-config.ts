import { SplitIcon } from 'lucide-react'

export const ParallelTool = {
  id: 'parallel',
  type: 'parallel',
  name: 'Parallel',
  description: 'Parallel Execution',
  icon: SplitIcon,
  bgColor: '#8BC34A',
  data: {
    label: 'Parallel',
    parallelType: 'collection' as 'collection' | 'count',
    count: 5,
    collection: '',
    extent: 'parent',
    executionState: {
      currentExecution: 0,
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
