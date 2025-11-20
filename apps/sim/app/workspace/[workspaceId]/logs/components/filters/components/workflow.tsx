import { useEffect, useMemo, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Button } from '@/components/emcn'
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
import {
  commandListClass,
  dropdownContentClass,
  filterButtonClass,
  workflowDropdownListStyle,
} from '@/app/workspace/[workspaceId]/logs/components/filters/components/shared'
import { useFilterStore } from '@/stores/logs/filters/store'

const logger = createLogger('LogsWorkflowFilter')

interface WorkflowOption {
  id: string
  name: string
  color: string
}

export default function Workflow() {
  const { workflowIds, toggleWorkflowId, setWorkflowIds, folderIds } = useFilterStore()
  const params = useParams()
  const workspaceId = params?.workspaceId as string | undefined
  const [workflows, setWorkflows] = useState<WorkflowOption[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')

  useEffect(() => {
    const fetchWorkflows = async () => {
      try {
        setLoading(true)
        const query = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : ''
        const response = await fetch(`/api/workflows${query}`)
        if (response.ok) {
          const { data } = await response.json()
          const scoped = Array.isArray(data)
            ? folderIds.length > 0
              ? data.filter((w: any) => (w.folderId ? folderIds.includes(w.folderId) : false))
              : data
            : []
          const workflowOptions: WorkflowOption[] = scoped.map((workflow: any) => ({
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
  }, [workspaceId, folderIds])

  const getSelectedWorkflowsText = () => {
    if (workflowIds.length === 0) return 'All workflows'
    if (workflowIds.length === 1) {
      const selected = workflows.find((w) => w.id === workflowIds[0])
      return selected ? selected.name : 'All workflows'
    }
    return `${workflowIds.length} workflows selected`
  }

  const isWorkflowSelected = (workflowId: string) => {
    return workflowIds.includes(workflowId)
  }

  const clearSelections = () => {
    setWorkflowIds([])
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant='outline' className={filterButtonClass}>
          {loading ? 'Loading workflows...' : getSelectedWorkflowsText()}
          <ChevronDown className='ml-2 h-4 w-4 text-muted-foreground' />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align='start'
        side='bottom'
        avoidCollisions={false}
        sideOffset={4}
        className={dropdownContentClass}
      >
        <Command>
          <CommandInput placeholder='Search workflows...' onValueChange={(v) => setSearch(v)} />
          <CommandList className={commandListClass} style={workflowDropdownListStyle}>
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
