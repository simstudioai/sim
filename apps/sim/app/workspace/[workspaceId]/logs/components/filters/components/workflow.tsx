import { useEffect, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { useFilterStore } from '@/stores/logs/filters/store'

interface WorkflowOption {
  id: string
  name: string
  color: string
}

export default function Workflow() {
  const { workflowIds, toggleWorkflowId, setWorkflowIds } = useFilterStore()
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([])
  const [loading, setLoading] = useState(true)

  // Fetch all available workflows from the API
  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        setLoading(true)
        const response = await fetch('/api/workflows')
        if (response.ok) {
          const { data } = await response.json()
          const workflowOptions: WorkflowOption[] = data.map((workflow: any) => ({
            id: workflow.id,
            name: workflow.name,
            color: workflow.color || '#3972F6',
          }))
          setWorkflows(workflowOptions)
        }
      } catch (error) {
        console.error('Failed to fetch workflows:', error)
      } finally {
        setLoading(false)
      }
    }

    fetchWorkflows()
  }, [])

  // Get display text for the dropdown button
  const getSelectedWorkflowsText = () => {
    if (workflowIds.length === 0) return 'All workflows'
    if (workflowIds.length === 1) {
      const selected = workflows.find((w) => w.id === workflowIds[0])
      return selected ? selected.name : 'All workflows'
    }
    return `${workflowIds.length} workflows selected`
  }

  // Check if a workflow is selected
  const isWorkflowSelected = (workflowId: string) => {
    return workflowIds.includes(workflowId)
  }

  // Clear all selections
  const clearSelections = () => {
    setWorkflowIds([])
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant='outline'
          size='sm'
          className='w-full justify-between rounded-[10px] border-[#E5E5E5] bg-[#FFFFFF] font-normal text-sm dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
        >
          {loading ? 'Loading workflows...' : getSelectedWorkflowsText()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        className='max-h-[300px] w-[180px] overflow-y-auto rounded-lg border-[#E5E5E5] bg-[#FFFFFF] shadow-xs dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
        style={{
          scrollbarWidth: 'none',
          msOverflowStyle: 'none',
        }}
      >
        <DropdownMenuItem
          key='all'
          onSelect={(e) => {
            e.preventDefault()
            clearSelections()
          }}
          className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
        >
          <span>All workflows</span>
          {workflowIds.length === 0 && <Check className='h-4 w-4 text-muted-foreground' />}
        </DropdownMenuItem>

        {!loading && workflows.length > 0 && <DropdownMenuSeparator />}

        {!loading &&
          workflows.map((workflow) => (
            <DropdownMenuItem
              key={workflow.id}
              onSelect={(e) => {
                e.preventDefault()
                toggleWorkflowId(workflow.id)
              }}
              className='flex cursor-pointer items-center justify-between rounded-md px-3 py-2 font-[380] text-card-foreground text-sm hover:bg-secondary/50 focus:bg-secondary/50'
            >
              <div className='flex items-center'>
                <div
                  className='mr-2 h-2 w-2 rounded-full'
                  style={{ backgroundColor: workflow.color }}
                />
                {workflow.name}
              </div>
              {isWorkflowSelected(workflow.id) && (
                <Check className='h-4 w-4 text-muted-foreground' />
              )}
            </DropdownMenuItem>
          ))}

        {loading && (
          <DropdownMenuItem
            disabled
            className='rounded-md px-3 py-2 font-[380] text-muted-foreground text-sm'
          >
            Loading workflows...
          </DropdownMenuItem>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
