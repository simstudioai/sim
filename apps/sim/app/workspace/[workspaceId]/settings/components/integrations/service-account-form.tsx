'use client'

import { createElement, useState } from 'react'
import {
  Badge,
  Button,
  Input,
  Label,
  ModalBody,
  ModalFooter,
  ModalHeader,
  Textarea,
} from '@/components/emcn'
import { serviceAccountJsonSchema } from '@/lib/api/contracts/credentials'
import { cn } from '@/lib/core/utils/cn'
import type { OAuthServiceConfig } from '@/lib/oauth'

interface ServiceAccountFormProps {
  service: OAuthServiceConfig | null
  serviceLabel: string
  workspaceId: string
  setupGuideHref?: string
  onBack: () => void
  onCreate: (input: {
    workspaceId: string
    type: 'service_account'
    serviceAccountJson: string
    displayName?: string
    description?: string
  }) => Promise<unknown>
  onCreated: () => void
}

export function ServiceAccountForm({
  service,
  serviceLabel,
  workspaceId,
  setupGuideHref,
  onBack,
  onCreate,
  onCreated,
}: ServiceAccountFormProps) {
  const [jsonInput, setJsonInput] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [dragActive, setDragActive] = useState(false)

  const readJsonFile = (file: File) => {
    if (!file.name.endsWith('.json')) {
      setError('Only .json files are supported')
      return
    }
    const reader = new FileReader()
    reader.onload = (e) => {
      const text = e.target?.result
      if (typeof text !== 'string') return
      setJsonInput(text)
      setError(null)
      if (!displayName.trim()) {
        try {
          const parsed = JSON.parse(text)
          if (parsed.client_email) setDisplayName(parsed.client_email)
        } catch {
          // surface validation on submit instead
        }
      }
    }
    reader.readAsText(file)
  }

  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    readJsonFile(file)
    event.target.value = ''
  }

  const handleDragOver = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(true)
  }

  const handleDragLeave = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
  }

  const handleDrop = (event: React.DragEvent) => {
    event.preventDefault()
    event.stopPropagation()
    setDragActive(false)
    const file = event.dataTransfer.files[0]
    if (file) readJsonFile(file)
  }

  const handleSubmit = async () => {
    setError(null)
    const trimmed = jsonInput.trim()
    if (!trimmed) {
      setError('Paste the service account JSON key.')
      return
    }
    const validation = serviceAccountJsonSchema.safeParse(trimmed)
    if (!validation.success) {
      setError(validation.error.issues[0]?.message ?? 'Invalid JSON')
      return
    }
    setIsSubmitting(true)
    try {
      await onCreate({
        workspaceId,
        type: 'service_account',
        displayName: displayName.trim() || undefined,
        description: description.trim() || undefined,
        serviceAccountJson: trimmed,
      })
      onCreated()
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'Failed to add service account'
      setError(message)
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <>
      <ModalHeader>
        <div className='flex items-center gap-2.5'>
          <Button
            type='button'
            variant='ghost'
            onClick={() => {
              setError(null)
              onBack()
            }}
            className='h-6 w-6 rounded-[4px] p-0 text-[var(--text-muted)] hover-hover:bg-[var(--surface-5)] hover-hover:text-[var(--text-primary)]'
            aria-label='Back'
          >
            ←
          </Button>
          <span>Add {serviceLabel}</span>
        </div>
      </ModalHeader>
      <ModalBody>
        {error && (
          <div className='mb-3'>
            <Badge variant='red' size='lg' dot className='max-w-full'>
              {error}
            </Badge>
          </div>
        )}
        <div className='flex flex-col gap-4'>
          <div className='flex items-center gap-3'>
            <div className='flex h-[40px] w-[40px] flex-shrink-0 items-center justify-center rounded-[8px] bg-[var(--surface-5)]'>
              {service && createElement(service.icon, { className: 'h-[18px] w-[18px]' })}
            </div>
            <div>
              <p className='font-medium text-[13px] text-[var(--text-primary)]'>
                Add {service?.name || 'service account'}
              </p>
              <p className='text-[12px] text-[var(--text-tertiary)]'>
                {service?.description || 'Paste or upload the JSON key file'}
              </p>
              {setupGuideHref && (
                <a
                  href={setupGuideHref}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-[12px] text-[var(--accent)] hover:underline'
                >
                  View setup guide
                </a>
              )}
            </div>
          </div>

          <div>
            <Label>
              JSON Key<span className='ml-1'>*</span>
            </Label>
            <div
              onDragOver={handleDragOver}
              onDragLeave={handleDragLeave}
              onDrop={handleDrop}
              className={cn(
                'relative mt-1.5 rounded-md border-2 border-dashed transition-colors',
                dragActive ? 'border-[var(--accent)] bg-[var(--accent)]/5' : 'border-transparent'
              )}
            >
              {dragActive && (
                <div className='pointer-events-none absolute inset-0 z-10 flex items-center justify-center rounded-md bg-[var(--accent)]/5'>
                  <p className='font-medium text-[13px] text-[var(--accent)]'>
                    Drop JSON key file here
                  </p>
                </div>
              )}
              <Textarea
                value={jsonInput}
                onChange={(event) => {
                  setJsonInput(event.target.value)
                  setError(null)
                  if (!displayName.trim()) {
                    try {
                      const parsed = JSON.parse(event.target.value)
                      if (parsed.client_email) setDisplayName(parsed.client_email)
                    } catch {
                      // surface validation on submit instead
                    }
                  }
                }}
                placeholder='Paste your service account JSON key here or drag & drop a .json file...'
                autoComplete='off'
                data-lpignore='true'
                className={cn(
                  'min-h-[120px] resize-none border-0 font-mono text-[12px]',
                  dragActive && 'opacity-30'
                )}
              />
            </div>
            <div className='mt-1.5'>
              <label className='inline-flex cursor-pointer items-center gap-1.5 text-[12px] text-[var(--text-muted)] hover:text-[var(--text-secondary)]'>
                <input type='file' accept='.json' onChange={handleFileUpload} className='hidden' />
                Or upload a .json file
              </label>
            </div>
          </div>
          <div>
            <Label>Display name</Label>
            <Input
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              placeholder='Auto-populated from client_email'
              autoComplete='off'
              data-lpignore='true'
              className='mt-1.5'
            />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder='Optional description'
              maxLength={500}
              autoComplete='off'
              data-lpignore='true'
              className='mt-1.5 min-h-[80px] resize-none'
            />
          </div>
        </div>
      </ModalBody>
      <ModalFooter>
        <Button
          variant='default'
          onClick={() => {
            setError(null)
            onBack()
          }}
        >
          Back
        </Button>
        <Button
          variant='primary'
          onClick={handleSubmit}
          disabled={!jsonInput.trim() || isSubmitting}
        >
          {isSubmitting ? 'Adding...' : 'Add Service Account'}
        </Button>
      </ModalFooter>
    </>
  )
}
