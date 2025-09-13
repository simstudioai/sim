import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { createLogger } from '@/lib/logs/console/logger'
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
  const [search, setSearch] = useState('')
  const logger = useMemo(() => createLogger('LogsWorkflowFilter'), [])

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
        logger.error('Failed to fetch workflows', { error })
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
        className='w-[180px] rounded-lg border-[#E5E5E5] bg-[#FFFFFF] p-0 shadow-xs dark:border-[#414141] dark:bg-[var(--surface-elevated)]'
      >
        <Command>
          <CommandInput placeholder='Search workflows...' onValueChange={(v) => setSearch(v)} />
          <CommandList>
            <CommandEmpty>{loading ? 'Loading workflows...' : 'No workflows found.'}</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value='all-workflows'
                onSelect={() => {
                  clearSelections()
                }}
                className='cursor-pointer'
              >
                <span>All workflows</span>
                {workflowIds.length === 0 && (
                  <Check className='ml-auto h-4 w-4 text-muted-foreground' />
                )}
              </CommandItem>
              {useMemo(() => {
                const q = search.trim().toLowerCase()
                const filtered = q
                  ? workflows.filter((w) => w.name.toLowerCase().includes(q))
                  : workflows
                return filtered.map((workflow) => (
                  <CommandItem
                    key={workflow.id}
                    value={`${workflow.name}`}
                    onSelect={() => {
                      toggleWorkflowId(workflow.id)
                    }}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center'>
                      <div
                        className='mr-2 h-2 w-2 rounded-full'
                        style={{ backgroundColor: workflow.color }}
                      />
                      {workflow.name}
                    </div>
                    {isWorkflowSelected(workflow.id) && (
                      <Check className='ml-auto h-4 w-4 text-muted-foreground' />
                    )}
                  </CommandItem>
                ))
              }, [workflows, search, workflowIds])}
            </CommandGroup>
          </CommandList>
        </Command>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
