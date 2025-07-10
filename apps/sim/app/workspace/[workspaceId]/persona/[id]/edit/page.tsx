'use client'
import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useParams, useRouter } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AssignWorkflow } from '../../components/AssignWorkflow'
import { PersonaHeader } from '../../components/PersonaHeader'

export default function PersonaEditPage() {
  const params = useParams()
  const router = useRouter()
  const workspaceId = params.workspaceId as string
  const personaId = params.id as string

  interface Persona {
    id: string
    name: string
    description: string
    photo: string
  }

  interface Workflow {
    id: string
    workflowId: string
    status: string
  }

  const [persona, setPersona] = useState<Persona | null>(null)
  const [form, setForm] = useState({ name: '', description: '', photo: '' })
  const [workflows, setWorkflows] = useState<Workflow[]>([])
  const [allWorkflows, setAllWorkflows] = useState<Workflow[]>([])
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [assigning, setAssigning] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!personaId) return
    setLoading(true)
    Promise.all([
      fetch(`/api/persona/${personaId}`).then((res) => res.json()),
      fetch(`/api/persona/workflow?personaId=${personaId}`).then((res) => res.json()),
      fetch(`/api/workflows?workspaceId=${workspaceId}`).then((res) => res.json()),
    ])
      .then(([personaRes, wfRes, allWfRes]) => {
        setPersona(personaRes.persona)
        setForm({
          name: personaRes.persona.name || '',
          description: personaRes.persona.description || '',
          photo: personaRes.persona.photo || '',
        })
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

  useEffect(() => {
    if (photoFile) {
      const url = URL.createObjectURL(photoFile)
      setPhotoPreview(url)
      return () => URL.revokeObjectURL(url)
    }
    setPhotoPreview('')
  }, [photoFile])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    setForm({ ...form, [e.target.name]: e.target.value })
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) {
      setPhotoFile(file)
    }
  }

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    setSaving(true)
    setError(null)
    let photoUrl = form.photo
    try {
      if (photoFile) {
        const data = new FormData()
        data.append('file', photoFile)
        const res = await fetch('/api/upload', { method: 'POST', body: data })
        if (!res.ok) throw new Error('Failed to upload photo')
        const json = await res.json()
        photoUrl = json.url
      }
      await fetch(`/api/persona/${personaId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, photo: photoUrl }),
      })
      router.push(`/workspace/${workspaceId}/persona/${personaId}`)
    } catch {
      setError('Failed to save persona')
    } finally {
      setSaving(false)
    }
  }

  const handleAssign = async () => {
    setAssigning(true)
    setError(null)
    try {
      const toAssign = selectedWorkflows.filter(
        (id) => !workflows.some((w: any) => w.workflowId === id)
      )
      const toUnassign = workflows.filter((w: any) => !selectedWorkflows.includes(w.workflowId))
      await Promise.all([
        ...toAssign.map((id) =>
          fetch('/api/persona/workflow', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ personaId, workflowId: id, status: 'in progress' }),
          })
        ),
        ...toUnassign.map((w) => fetch(`/api/persona/workflow/${w.id}`, { method: 'DELETE' })),
      ])
      const wfRes = await fetch(`/api/persona/workflow?personaId=${personaId}`).then((res) =>
        res.json()
      )
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
    { id: personaId, label: persona?.name || 'Edit' },
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
          <div className='mx-auto max-w-2xl'>
            <form onSubmit={handleSave} className='mb-6 space-y-4'>
              <div className='mb-2 flex flex-col items-center justify-center gap-2'>
                <div className='relative'>
                  <Avatar className='h-24 w-24'>
                    {photoPreview ? (
                      <AvatarImage src={photoPreview} alt={form.name} />
                    ) : form.photo ? (
                      <AvatarImage src={form.photo} alt={form.name} />
                    ) : (
                      <AvatarFallback className='text-2xl'>{getInitials(form.name)}</AvatarFallback>
                    )}
                  </Avatar>
                  <button
                    type='button'
                    className='absolute right-1 bottom-1 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-background shadow transition-colors hover:bg-accent'
                    onClick={() => fileInputRef.current?.click()}
                    disabled={saving}
                    title='Change photo'
                  >
                    <Pencil className='h-4 w-4 text-muted-foreground' />
                  </button>
                  <input
                    ref={fileInputRef}
                    type='file'
                    accept='image/*'
                    className='hidden'
                    onChange={handlePhotoChange}
                    disabled={saving}
                  />
                </div>
              </div>
              <Input
                name='name'
                placeholder='Persona Name'
                value={form.name}
                onChange={handleChange}
                required
                disabled={saving}
              />
              <Textarea
                name='description'
                placeholder='Description'
                value={form.description}
                onChange={handleChange}
                disabled={saving}
              />
              {/* Hidden photo url field for backend compatibility */}
              <input type='hidden' name='photo' value={form.photo} />
              <div className='ml-auto flex flex-col gap-2'>
                <Button type='submit' disabled={saving}>
                  {saving ? 'Saving...' : 'Save'}
                </Button>
                <Button variant='destructive' onClick={handleDelete} disabled={deleting}>
                  {deleting ? 'Deleting...' : 'Delete'}
                </Button>
              </div>
            </form>
            <div className='mb-4'>
              <div className='mb-2 font-medium'>Assign Workflows</div>
              <div className='rounded-md border bg-background p-4'>
                <AssignWorkflow
                  workflows={allWorkflows}
                  selected={selectedWorkflows}
                  onChange={setSelectedWorkflows}
                  onSave={handleAssign}
                  loading={assigning}
                  error={error}
                  editable
                />
              </div>
              <div className='mt-4'>
                <div className='mb-2 font-medium'>Current Workflows</div>
                <ul className='ml-6 list-disc text-sm'>
                  {workflows.map((w: any) => (
                    <li key={w.id}>
                      {allWorkflows.find((aw: any) => aw.id === w.workflowId)?.name || w.workflowId}{' '}
                      ({w.status})
                    </li>
                  ))}
                </ul>
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
