'use client'
import { useEffect, useRef, useState } from 'react'
import { Pencil } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { AssignWorkflow } from './AssignWorkflow'

interface CreatePersonaModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onCreate: (data: {
    name: string
    description: string
    photo: string
    workflows: string[]
  }) => Promise<void>
}

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2)
}

export function CreatePersonaModal({ open, onOpenChange, onCreate }: CreatePersonaModalProps) {
  const params = useParams()
  const workspaceId = params?.workspaceId as string
  const [form, setForm] = useState({ name: '', description: '', photo: '' })
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [allWorkflows, setAllWorkflows] = useState<any[]>([])
  const [selectedWorkflows, setSelectedWorkflows] = useState<string[]>([])
  const [photoFile, setPhotoFile] = useState<File | null>(null)
  const [photoPreview, setPhotoPreview] = useState<string>('')
  const fileInputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open || !workspaceId) return
    fetch(`/api/workflows?workspaceId=${workspaceId}`)
      .then((res) => res.json())
      .then((data) => setAllWorkflows(data.workflows || []))
      .catch(() => setAllWorkflows([]))
  }, [open, workspaceId])

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

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    let photoUrl = form.photo
    try {
      if (!form.name.trim()) throw new Error('Name is required')
      if (photoFile) {
        // Upload file to /api/upload (implement this endpoint to save to /public/static/)
        const data = new FormData()
        data.append('file', photoFile)
        const res = await fetch('/api/upload', { method: 'POST', body: data })
        if (!res.ok) throw new Error('Failed to upload photo')
        const json = await res.json()
        photoUrl = json.url
      }
      await onCreate({ ...form, photo: photoUrl, workflows: selectedWorkflows })
      setForm({ name: '', description: '', photo: '' })
      setPhotoFile(null)
      setPhotoPreview('')
      setSelectedWorkflows([])
      onOpenChange(false)
    } catch (err: any) {
      setError(err.message || 'Failed to create persona')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Create Persona</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='mb-2 flex flex-col items-center justify-center gap-2'>
            <div className='relative'>
              <Avatar className='h-24 w-24'>
                {photoPreview ? (
                  <AvatarImage src={photoPreview} alt={form.name} />
                ) : (
                  <AvatarFallback className='text-2xl'>{getInitials(form.name)}</AvatarFallback>
                )}
              </Avatar>
              <button
                type='button'
                className='absolute right-1 bottom-1 flex h-8 w-8 items-center justify-center rounded-full border border-gray-200 bg-background shadow transition-colors hover:bg-accent'
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
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
                disabled={loading}
              />
            </div>
          </div>
          <Input
            name='name'
            placeholder='Persona Name'
            value={form.name}
            onChange={handleChange}
            required
            disabled={loading}
          />
          <Textarea
            name='description'
            placeholder='Description'
            value={form.description}
            onChange={handleChange}
            disabled={loading}
          />
          {/* Hidden photo url field for backend compatibility */}
          <input type='hidden' name='photo' value={form.photo} />
          <div>
            <div className='mb-2 font-medium'>Assign Workflows</div>
            <div className='rounded-md border bg-background p-4'>
              <AssignWorkflow
                workflows={allWorkflows}
                selected={selectedWorkflows}
                onChange={setSelectedWorkflows}
                editable
              />
            </div>
          </div>
          {error && <div className='text-red-500 text-sm'>{error}</div>}
          <Button type='submit' disabled={loading} className='w-full'>
            {loading ? 'Creating...' : 'Create Persona'}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  )
}
