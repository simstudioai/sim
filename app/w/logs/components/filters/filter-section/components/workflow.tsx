import { useMemo } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/app/w/logs/stores/store'

export default function Workflow() {
  const { logs, workflowId, setWorkflowId } = useFilterStore()

  // Extract unique workflows from logs
  const workflows = useMemo(() => {
    const uniqueWorkflows = new Map()

    logs.forEach((log) => {
      if (log.workflow && !uniqueWorkflows.has(log.workflowId)) {
        uniqueWorkflows.set(log.workflowId, {
          id: log.workflowId,
          name: log.workflow.name,
          color: log.workflow.color,
        })
      }
    })

    return Array.from(uniqueWorkflows.values())
  }, [logs])

  const getSelectedWorkflowName = () => {
    if (!workflowId) return 'All workflows'
    const selected = workflows.find((w) => w.id === workflowId)
    return selected ? selected.name : 'All workflows'
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm" className="w-full justify-between text-sm font-normal">
          {getSelectedWorkflowName()}
          <ChevronDown className="h-4 w-4 ml-2 text-muted-foreground" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="w-[180px] max-h-[300px] overflow-y-auto">
        <DropdownMenuItem
          key="all"
          onClick={() => setWorkflowId(null)}
          className="flex items-center justify-between p-2 cursor-pointer text-sm"
        >
          <span>All workflows</span>
          {workflowId === null && <Check className="h-4 w-4 text-primary" />}
        </DropdownMenuItem>

        {workflows.map((workflow) => (
          <DropdownMenuItem
            key={workflow.id}
            onClick={() => setWorkflowId(workflow.id)}
            className="flex items-center justify-between p-2 cursor-pointer text-sm"
          >
            <div className="flex items-center">
              <div
                className="w-2 h-2 rounded-full mr-2"
                style={{ backgroundColor: workflow.color }}
              />
              {workflow.name}
            </div>
            {workflowId === workflow.id && <Check className="h-4 w-4 text-primary" />}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
