import { SplitIcon } from 'lucide-react'

export const ParallelTool = {
  id: 'parallel',
  type: 'parallel',
  name: 'Parallel',
  description: 'Parallel Execution',
  icon: SplitIcon,
  bgColor: '#FEE12B',
  data: {
    label: 'Parallel',
    parallelType: 'count' as 'collection' | 'count',
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
