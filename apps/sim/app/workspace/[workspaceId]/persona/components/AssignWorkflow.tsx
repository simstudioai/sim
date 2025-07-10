import { useMemo, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card } from '@/components/ui/card'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Label } from '@/components/ui/label'

interface AssignWorkflowProps {
  workflows: { id: string; name: string; status?: string; description?: string }[]
  selected: string[]
  onChange: (selected: string[]) => void
  onSave?: () => void
  loading?: boolean
  error?: string | null
  editable?: boolean
}

function getStatusBadge(status?: string) {
  switch (status) {
    case 'done':
      return (
        <Badge className='bg-green-100 text-green-700' variant='secondary'>
          Done
        </Badge>
      )
    case 'in progress':
      return (
        <Badge className='bg-yellow-100 text-yellow-700' variant='secondary'>
          In Progress
        </Badge>
      )
    case 'failed':
      return (
        <Badge className='bg-red-100 text-red-700' variant='secondary'>
          Failed
        </Badge>
      )
    default:
      return (
        <Badge className='bg-gray-100 text-gray-700' variant='secondary'>
          {status || 'Unknown'}
        </Badge>
      )
  }
}

export function AssignWorkflow({
  workflows,
  selected,
  onChange,
  onSave,
  loading,
  error,
  editable = true,
}: AssignWorkflowProps) {
  const [search, setSearch] = useState('')
  // Only show selected workflows as cards
  const selectedWorkflows = useMemo(() => {
    return workflows.filter(
      (wf) => selected.includes(wf.id) && wf.name.toLowerCase().includes(search.toLowerCase())
    )
  }, [workflows, selected, search])
  // Suggestions: workflows not yet selected, filtered by search
  const suggestions = useMemo(() => {
    const q = search.toLowerCase()
    return workflows.filter((wf) => !selected.includes(wf.id) && wf.name.toLowerCase().includes(q))
  }, [workflows, selected, search])

  return (
    <div className='flex flex-col gap-4'>
      <div>
        <Label htmlFor='workflow-search' className='mb-1 block'>
          Add Workflow
        </Label>
        <Command className='rounded-md border bg-background'>
          <CommandInput
            id='workflow-search'
            placeholder='Search workflows...'
            value={search}
            onValueChange={setSearch}
            disabled={loading || !editable}
          />
          <CommandList>
            <CommandEmpty>No workflows found.</CommandEmpty>
            <CommandGroup>
              {suggestions.map((wf) => (
                <CommandItem
                  key={wf.id}
                  value={wf.name}
                  onSelect={() => {
                    if (!editable) return
                    onChange([...selected, wf.id])
                    setSearch('')
                  }}
                  className='cursor-pointer'
                >
                  <span className='font-medium'>{wf.name}</span>
                  {wf.description && (
                    <span className='ml-2 text-muted-foreground text-xs'>{wf.description}</span>
                  )}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </div>
      <div>
        <Label className='mb-1 block'>Assigned Workflows</Label>
        {selectedWorkflows.length === 0 ? (
          <div className='text-muted-foreground text-sm'>No workflows assigned.</div>
        ) : (
          <div className='flex flex-col gap-3'>
            {selectedWorkflows.map((wf) => (
              <Card key={wf.id} className='flex flex-col gap-1 p-3'>
                <div className='flex items-center gap-2'>
                  <span className='font-medium'>{wf.name}</span>
                  {getStatusBadge(wf.status)}
                  {editable && (
                    <Button
                      size='icon'
                      variant='ghost'
                      className='ml-auto h-7 w-7 text-muted-foreground'
                      onClick={() => onChange(selected.filter((id) => id !== wf.id))}
                      disabled={loading}
                      aria-label='Unassign workflow'
                    >
                      ×
                    </Button>
                  )}
                </div>
                {wf.description && (
                  <div className='text-muted-foreground text-xs'>{wf.description}</div>
                )}
              </Card>
            ))}
          </div>
        )}
      </div>
      {onSave && (
        <Button className='mt-2 w-fit' onClick={onSave} disabled={loading}>
          {loading ? 'Saving...' : 'Save Assignment'}
        </Button>
      )}
      {error && <div className='text-red-500 text-sm'>{error}</div>}
    </div>
  )
}
