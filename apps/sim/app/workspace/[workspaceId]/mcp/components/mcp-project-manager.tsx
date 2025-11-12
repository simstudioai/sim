'use client'

import { useCallback, useEffect, useMemo, useState, useTransition } from 'react'
import { Loader2, RefreshCcw, Rocket } from 'lucide-react'
import type { McpServerProject } from '@/lib/mcp/types'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'

interface McpProjectManagerProps {
  workspaceId: string
}

interface CreateProjectState {
  name: string
  description: string
}

const defaultState: CreateProjectState = {
  name: '',
  description: '',
}

export function McpProjectManager({ workspaceId }: McpProjectManagerProps) {
  const [projects, setProjects] = useState<McpServerProject[]>([])
  const [formState, setFormState] = useState<CreateProjectState>(defaultState)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [isPending, startTransition] = useTransition()

  const fetchProjects = useCallback(async () => {
    setIsLoading(true)
    setError(null)

    try {
      const response = await fetch(`/api/mcp/projects?workspaceId=${workspaceId}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`Failed to load projects (${response.status})`)
      }

      const payload = await response.json()
      const nextProjects =
        payload?.data?.projects ?? payload?.projects ?? payload?.data ?? []
      setProjects(nextProjects as McpServerProject[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load MCP projects')
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    fetchProjects().catch(() => {
      // Already handled inside fetchProjects
    })
  }, [fetchProjects])

  const canSubmit = useMemo(() => formState.name.trim().length > 2, [formState.name])

  const handleCreateProject = () => {
    setError(null)
    startTransition(async () => {
      try {
        const response = await fetch('/api/mcp/projects', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...formState,
            workspaceId,
            runtime: 'node',
            entryPoint: 'index.ts',
          }),
        })

        if (!response.ok) {
          const payload = await response.json().catch(() => ({}))
          throw new Error(payload.error || 'Failed to create project')
        }

        setFormState(defaultState)
        await fetchProjects()
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create project')
      }
    })
  }

  return (
    <div className='grid gap-6 lg:grid-cols-[2fr,3fr]'>
      <Card>
        <CardHeader>
          <CardTitle>New hosted server</CardTitle>
          <CardDescription>
            Start with a project name and optional description. You can define manifests, custom
            tools, and deployments after the project is created.
          </CardDescription>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='space-y-2'>
            <label className='text-sm font-medium' htmlFor='mcp-name'>
              Project name
            </label>
            <Input
              id='mcp-name'
              placeholder='Reddit Research Agent'
              value={formState.name}
              onChange={(event) => setFormState((prev) => ({ ...prev, name: event.target.value }))}
              disabled={isPending}
            />
          </div>
          <div className='space-y-2'>
            <label className='text-sm font-medium' htmlFor='mcp-description'>
              Description
            </label>
            <Textarea
              id='mcp-description'
              placeholder='Scrapes Reddit, summarises arXiv abstracts, and republishes insights to Substack.'
              value={formState.description}
              onChange={(event) =>
                setFormState((prev) => ({ ...prev, description: event.target.value }))
              }
              disabled={isPending}
              rows={4}
            />
          </div>
          {error && (
            <div className='rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive'>
              {error}
            </div>
          )}
        </CardContent>
        <CardFooter className='flex justify-between'>
          <p className='text-sm text-muted-foreground'>
            Use <code className='rounded bg-muted px-1 py-0.5 text-xs'>simstudio mcp init</code> to
            scaffold code locally.
          </p>
          <Button onClick={handleCreateProject} disabled={!canSubmit || isPending}>
            {isPending ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : <Rocket className='mr-2 h-4 w-4' />}
            Create project
          </Button>
        </CardFooter>
      </Card>
      <Card className='flex flex-col'>
        <CardHeader className='flex flex-row items-center justify-between'>
          <div>
            <CardTitle>Existing projects</CardTitle>
            <CardDescription>Track status, deployments, and active versions.</CardDescription>
          </div>
          <Button variant='ghost' size='icon' onClick={() => fetchProjects()} disabled={isLoading}>
            <RefreshCcw className={cn('h-4 w-4', { 'animate-spin': isLoading })} />
            <span className='sr-only'>Refresh projects</span>
          </Button>
        </CardHeader>
        <CardContent className='flex-1 space-y-3 overflow-auto'>
          {isLoading ? (
            <div className='flex h-32 items-center justify-center text-muted-foreground'>
              <Loader2 className='mr-2 h-4 w-4 animate-spin' />
              Loading projects…
            </div>
          ) : projects.length === 0 ? (
            <div className='text-sm text-muted-foreground'>
              No projects yet. Create one to start exposing workflows, Reddit scrapers, YouTube
              transcribers, or CRM integrations as MCP servers.
            </div>
          ) : (
            projects.map((project) => (
              <div
                key={project.id}
                className='rounded-lg border bg-card px-4 py-3 text-sm shadow-sm transition hover:border-primary/40'
              >
                <div className='flex flex-wrap items-center justify-between gap-2'>
                  <div>
                    <p className='font-medium'>{project.name}</p>
                    <p className='text-xs text-muted-foreground'>{project.slug}</p>
                  </div>
                  <Badge variant={project.status === 'active' ? 'default' : 'secondary'}>
                    {project.status}
                  </Badge>
                </div>
                <p className='mt-2 text-muted-foreground'>
                  {project.description || 'No description provided.'}
                </p>
                <div className='mt-3 flex flex-wrap items-center gap-3 text-xs text-muted-foreground'>
                  {project.currentVersionNumber ? (
                    <span>v{project.currentVersionNumber}</span>
                  ) : (
                    <span>No version deployed</span>
                  )}
                  <span>Runtime: {project.runtime}</span>
                  <span>Visibility: {project.visibility}</span>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
