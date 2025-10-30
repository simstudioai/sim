import { useEffect, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { LinearIcon } from '@/components/icons'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'

export interface LinearProjectInfo {
  id: string
  name: string
}

interface LinearProjectSelectorProps {
  value: string
  onChange: (projectId: string, projectInfo?: LinearProjectInfo) => void
  credential: string
  teamId: string
  label?: string
  disabled?: boolean
  workflowId?: string
}

export function LinearProjectSelector({
  value,
  onChange,
  credential,
  teamId,
  label = 'Select Linear project',
  disabled = false,
  workflowId,
}: LinearProjectSelectorProps) {
  const [projects, setProjects] = useState<LinearProjectInfo[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [open, setOpen] = useState(false)
  const [selectedProject, setSelectedProject] = useState<LinearProjectInfo | null>(null)

  useEffect(() => {
    if (!credential || !teamId) return
    const controller = new AbortController()
    setLoading(true)
    setError(null)

    fetch('/api/tools/linear/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential, teamId, workflowId }),
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          const errorText = await res.text()
          throw new Error(`HTTP error! status: ${res.status} - ${errorText}`)
        }
        return res.json()
      })
      .then((data) => {
        if (data.error) {
          setError(data.error)
          setProjects([])
        } else {
          setProjects(data.projects)

          // Find selected project info if we have a value
          if (value) {
            const projectInfo = data.projects.find((p: LinearProjectInfo) => p.id === value)
            setSelectedProject(projectInfo || null)
          }
        }
      })
      .catch((err) => {
        if (err.name === 'AbortError') return
        setError(err.message)
        setProjects([])
      })
      .finally(() => setLoading(false))
    return () => controller.abort()
  }, [credential, teamId, value, workflowId])

  // Sync selected project with value prop
  useEffect(() => {
    if (value && projects.length > 0) {
      const projectInfo = projects.find((p) => p.id === value)
      setSelectedProject(projectInfo || null)
    } else if (!value) {
      setSelectedProject(null)
    }
  }, [value, projects])

  const handleSelectProject = (project: LinearProjectInfo) => {
    setSelectedProject(project)
    onChange(project.id, project)
    setOpen(false)
  }

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='w-full justify-between'
          disabled={disabled || !credential || !teamId}
        >
          {selectedProject ? (
            <div className='flex items-center gap-2 overflow-hidden'>
              <LinearIcon className='h-4 w-4' />
              <span className='truncate font-normal'>{selectedProject.name}</span>
            </div>
          ) : (
            <div className='flex items-center gap-2'>
              <LinearIcon className='h-4 w-4' />
              <span className='text-muted-foreground'>{label}</span>
            </div>
          )}
          <ChevronDown className='ml-2 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[300px] p-0' align='start'>
        <Command>
          <CommandInput placeholder='Search projects...' />
          <CommandList>
            <CommandEmpty>
              {loading ? (
                <div className='flex items-center justify-center p-4'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  <span className='ml-2'>Loading projects...</span>
                </div>
              ) : error ? (
                <div className='p-4 text-center'>
                  <p className='text-destructive text-sm'>{error}</p>
                </div>
              ) : !credential || !teamId ? (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>Missing credentials or team</p>
                  <p className='text-muted-foreground text-xs'>
                    Please configure Linear credentials and select a team.
                  </p>
                </div>
              ) : (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>No projects found</p>
                  <p className='text-muted-foreground text-xs'>
                    No projects available for the selected team.
                  </p>
                </div>
              )}
            </CommandEmpty>

            {projects.length > 0 && (
              <CommandGroup>
                <div className='px-2 py-1.5 font-medium text-muted-foreground text-xs'>
                  Projects
                </div>
                {projects.map((project) => (
                  <CommandItem
                    key={project.id}
                    value={`project-${project.id}-${project.name}`}
                    onSelect={() => handleSelectProject(project)}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center gap-2 overflow-hidden'>
                      <LinearIcon className='h-4 w-4' />
                      <span className='truncate font-normal'>{project.name}</span>
                    </div>
                    {project.id === value && <Check className='ml-auto h-4 w-4' />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
