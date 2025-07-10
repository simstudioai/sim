import React from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'

export interface PersonaFormProps {
  formData: { name: string; description: string; photo: string }
  onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => void
  onSubmit: (e: React.FormEvent) => void
  visible: boolean
  onCancel?: () => void
}

export function PersonaForm({ formData, onChange, onSubmit, visible, onCancel }: PersonaFormProps) {
  if (!visible) return null
  return (
    <form onSubmit={onSubmit} className='mb-8 p-4 border rounded space-y-4'>
      <Input
        name='name'
        placeholder='Persona Name'
        value={formData.name}
        onChange={onChange}
        required
      />
      <Textarea
        name='description'
        placeholder='Description'
        value={formData.description}
        onChange={onChange}
        required
      />
      <Input
        name='photo'
        placeholder='Photo URL (optional)'
        value={formData.photo}
        onChange={onChange}
      />
      <div className='flex gap-2'>
        <Button type='submit'>Create Persona</Button>
        {onCancel && (
          <Button type='button' variant='outline' onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  )
} 