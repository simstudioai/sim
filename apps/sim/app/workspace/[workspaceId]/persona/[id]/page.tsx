'use client'
import { useEffect, useState } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { PersonaHeader } from '../components/PersonaHeader'
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { AssignWorkflow } from '../components/AssignWorkflow'

export default function PersonaDetailPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params?.workspaceId as string
  const personaId = params?.id as string

  const [persona, setPersona] = useState<any>(null)
  const [workflows, setWorkflows] = useState<any[]>([])
  const [allWorkflows, setAllWorkflows] = useState<any[]>([])
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [assigning, setAssigning] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    if (!personaId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/persona/${personaId}`).then(res => res.json()),
      fetch(`/api/persona/workflow?personaId=${personaId}`).then(res => res.json()),
      fetch(`/api/workflows?workspaceId=${workspaceId}`).then(res => res.json()),
    ])
      .then(([personaRes, wfRes, allWfRes]) => {
        setPersona(personaRes.persona)
        setWorkflows(wfRes.workflows || [])
        setAllWorkflows(allWfRes.workflows || [])
        setSelectedWorkflows((wfRes.workflows || []).map((w: any) => w.workflowId))
        setLoading(false)
      })
      .catch(() => {
        setError('Failed to load persona detail')
        setLoading(false)
      })
  }, [personaId, workspaceId])

  const handleAssign = async () => {
    setAssigning(true)
    setError(null)
    try {
      // Assign all selected workflows (POST for new, DELETE for unselected)
      const toAssign = selectedWorkflows.filter(
        id => !workflows.some((w: any) => w.workflowId === id)
      )
      const toUnassign = workflows.filter((w: any) => !selectedWorkflows.includes(w.workflowId));
      await Promise.all([
        ...toAssign.map(id =>
          fetch('/api/persona/workflow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personaId, workflowId: id, status: 'in progress' }),
          })
        ),
        ...toUnassign.map(w =>
          fetch(`/api/persona/workflow/${w.id}`, { method: 'DELETE' })
        ),
      ])
      // Refresh workflows
      const wfRes = await fetch(`/api/persona/workflow?personaId=${personaId}`).then(res => res.json())
      setWorkflows(wfRes.workflows || [])
    } catch {
      setError('Failed to assign workflows')
    } finally {
      setAssigning(false)
    }
  }

  const handleDelete = async () => {
    if (!confirm('Delete this persona?')) return
    setDeleting(true)
    setError(null)
    try {
      await fetch(`/api/persona/${personaId}`, { method: 'DELETE' })
      router.push(`/workspace/${workspaceId}/persona`)
    } catch {
      setError('Failed to delete persona')
    } finally {
      setDeleting(false)
    }
  }

  const breadcrumbs = [
    { id: 'persona', label: 'Personas', href: `/workspace/${workspaceId}/persona` },
    { id: personaId, label: persona?.name || 'Detail' },
  ]

  return (
    <div className='flex h-screen flex-col pl-14 md:pl-60'>
      <PersonaHeader breadcrumbs={breadcrumbs} />
      <div className='flex-1 overflow-auto px-6 pb-6'>
        {loading ? (
          <div className='text-muted-foreground'>Loading...</div>
        ) : error ? (
          <div className='text-red-500'>{error}</div>
        ) : (
          <div className='max-w-2xl mx-auto'>
            <div className='flex items-center gap-4 mb-6'>
              <Avatar className='h-16 w-16'>
                {persona?.photo ? (
                  <AvatarImage src={persona.photo} alt={persona.name} />
                ) : (
                  <AvatarFallback>{getInitials(persona?.name || '')}</AvatarFallback>
                )}
              </Avatar>
              <div>
                <div className='font-bold text-xl'>{persona.name}</div>
                <div className='text-muted-foreground'>{persona.description}</div>
                <div className='text-xs text-muted-foreground mt-1'>ID: {persona.id}</div>
              </div>
              <div className='ml-auto flex gap-2'>
                <Button variant='outline' onClick={() => router.push(`/workspace/${workspaceId}/persona/${personaId}/edit`)}>
                  Edit
                </Button>
                <Button variant='destructive' onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </div>
            <div className='mb-4'>
              <div className='font-medium mb-2 flex items-center gap-2'>
                <span>Assigned Workflows</span>
                <Button size='sm' variant='outline' onClick={() => router.push(`/workspace/${workspaceId}/persona/${personaId}/edit`)}>
                  Edit
                </Button>
              </div>
              <div className='rounded-md border bg-background p-4'>
                <AssignWorkflow
                  workflows={allWorkflows}
                  selected={selectedWorkflows}
                  onChange={() => {}}
                  editable={false}
                />
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// Helper for initials
function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
} 