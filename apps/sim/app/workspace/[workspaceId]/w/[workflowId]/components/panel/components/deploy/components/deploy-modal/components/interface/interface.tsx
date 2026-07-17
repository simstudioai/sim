'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Input, Label, Loader, Textarea, toast } from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { InterfaceRenderer } from '@/components/interfaces'
import { getBaseUrl } from '@/lib/core/utils/urls'
import { type InterfaceSpec, toPublicInterfaceDto } from '@/lib/interfaces'
import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components/output-select/output-select'
import {
  useCreateInterface,
  useDeleteInterface,
  useGenerateInterface,
  useUpdateInterface,
  validateInterfaceIdentifier,
} from '@/hooks/queries/interfaces'

const logger = createLogger('InterfaceDeploy')

const IDENTIFIER_PATTERN = /^[a-z0-9-]+$/
const DEFAULT_PRIMARY_COLOR = '#2563eb'

interface InterfaceDeployProps {
  workflowId: string
  existingInterface: {
    id: string
    identifier: string
    title: string
    description?: string | null
    customizations?: { primaryColor?: string; brief?: string } | null
    outputConfigs?: Array<{ blockId: string; path: string }> | null
    spec?: unknown
  } | null
  isLoading: boolean
  submitting: boolean
  setSubmitting: (value: boolean) => void
  onValidationChange?: (isValid: boolean) => void
  onDeployed?: () => void
  onRefetch?: () => Promise<void>
}

function emptyFormState() {
  return {
    identifier: '',
    title: '',
    description: '',
    primaryColor: DEFAULT_PRIMARY_COLOR,
    brief: '',
    selectedOutputs: [] as string[],
    spec: null as InterfaceSpec | null,
  }
}

function formStateFromExisting(existing: NonNullable<InterfaceDeployProps['existingInterface']>) {
  const outputs = existing.outputConfigs || []
  return {
    identifier: existing.identifier || '',
    title: existing.title || '',
    description: existing.description || '',
    primaryColor: existing.customizations?.primaryColor || DEFAULT_PRIMARY_COLOR,
    brief: existing.customizations?.brief || '',
    selectedOutputs: outputs.map((o) => `${o.blockId}_${o.path || 'content'}`),
    spec: (existing.spec as InterfaceSpec) || null,
  }
}

export function InterfaceDeploy({
  workflowId,
  existingInterface,
  isLoading,
  submitting,
  setSubmitting,
  onValidationChange,
  onDeployed,
  onRefetch,
}: InterfaceDeployProps) {
  const generateMutation = useGenerateInterface()
  const createMutation = useCreateInterface()
  const updateMutation = useUpdateInterface()
  const deleteMutation = useDeleteInterface()

  const [identifier, setIdentifier] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [primaryColor, setPrimaryColor] = useState(DEFAULT_PRIMARY_COLOR)
  const [brief, setBrief] = useState('')
  const [selectedOutputs, setSelectedOutputs] = useState<string[]>([])
  const [spec, setSpec] = useState<InterfaceSpec | null>(null)
  const [identifierError, setIdentifierError] = useState<string | null>(null)
  const [formError, setFormError] = useState<string | null>(null)
  const [briefAtGenerate, setBriefAtGenerate] = useState<string | null>(null)

  const hydratedWorkflowIdRef = useRef<string | null>(null)
  const hydratedInterfaceIdRef = useRef<string | null>(null)
  const dirtyRef = useRef(false)

  const applyFormState = (state: ReturnType<typeof emptyFormState>) => {
    setIdentifier(state.identifier)
    setTitle(state.title)
    setDescription(state.description)
    setPrimaryColor(state.primaryColor)
    setBrief(state.brief)
    setSelectedOutputs(state.selectedOutputs)
    setSpec(state.spec)
    setBriefAtGenerate(state.spec ? state.brief : null)
    setFormError(null)
    setIdentifierError(null)
  }

  const markDirty = () => {
    dirtyRef.current = true
  }

  useEffect(() => {
    const workflowChanged = hydratedWorkflowIdRef.current !== workflowId
    if (workflowChanged) {
      hydratedWorkflowIdRef.current = workflowId
      hydratedInterfaceIdRef.current = existingInterface?.id ?? null
      dirtyRef.current = false
      applyFormState(
        existingInterface ? formStateFromExisting(existingInterface) : emptyFormState()
      )
      return
    }

    const nextInterfaceId = existingInterface?.id ?? null
    if (hydratedInterfaceIdRef.current !== nextInterfaceId) {
      hydratedInterfaceIdRef.current = nextInterfaceId
      if (!dirtyRef.current) {
        applyFormState(
          existingInterface ? formStateFromExisting(existingInterface) : emptyFormState()
        )
      }
      return
    }

    // Routine refetch for the same deployment: do not clobber unsaved edits
    if (dirtyRef.current || !existingInterface) return
    applyFormState(formStateFromExisting(existingInterface))
  }, [workflowId, existingInterface])

  // Changing the brief after generate invalidates the previous UI
  useEffect(() => {
    if (spec && briefAtGenerate !== null && brief !== briefAtGenerate) {
      setSpec(null)
      setBriefAtGenerate(null)
    }
  }, [brief, briefAtGenerate, spec])

  const isValid = useMemo(() => {
    return (
      IDENTIFIER_PATTERN.test(identifier) && title.trim().length > 0 && !identifierError && !!spec
    )
  }, [identifier, title, identifierError, spec])

  useEffect(() => {
    onValidationChange?.(isValid)
  }, [isValid, onValidationChange])

  useEffect(() => {
    if (!identifier || !IDENTIFIER_PATTERN.test(identifier)) {
      setIdentifierError(
        identifier ? 'Use lowercase letters, numbers, and hyphens only' : 'Identifier is required'
      )
      return
    }
    if (existingInterface?.identifier === identifier) {
      setIdentifierError(null)
      return
    }

    let cancelled = false
    const handle = setTimeout(async () => {
      try {
        const result = await validateInterfaceIdentifier(identifier)
        if (cancelled) return
        setIdentifierError(result.available ? null : result.error || 'Identifier unavailable')
      } catch {
        if (!cancelled) setIdentifierError('Failed to validate identifier')
      }
    }, 300)

    return () => {
      cancelled = true
      clearTimeout(handle)
    }
  }, [identifier, existingInterface?.identifier])

  const outputConfigs = selectedOutputs
    .map((outputId) => {
      const firstUnderscoreIndex = outputId.indexOf('_')
      if (firstUnderscoreIndex === -1) return null
      const blockId = outputId.substring(0, firstUnderscoreIndex)
      const path = outputId.substring(firstUnderscoreIndex + 1)
      if (!blockId || !path) return null
      return { blockId, path }
    })
    .filter((config): config is { blockId: string; path: string } => config !== null)

  const previewDto = useMemo(() => {
    if (!spec) return null
    return toPublicInterfaceDto({ title: title || 'Interface', description, primaryColor }, spec)
  }, [spec, title, description, primaryColor])

  const handleGenerate = async () => {
    setFormError(null)
    setSubmitting(true)
    try {
      const result = await generateMutation.mutateAsync({
        workflowId,
        brief,
        primaryColor,
        title: title || undefined,
      })
      dirtyRef.current = true
      setSpec(result.spec as InterfaceSpec)
      setBriefAtGenerate(brief)
      toast({ message: 'Interface generated — preview below, then publish.' })
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to generate interface')
      setFormError(message)
      logger.error(message, error)
    } finally {
      setSubmitting(false)
    }
  }

  const handlePublish = async () => {
    if (!spec || !isValid) return
    setFormError(null)
    setSubmitting(true)
    try {
      if (existingInterface?.id) {
        await updateMutation.mutateAsync({
          id: existingInterface.id,
          workflowId,
          body: {
            identifier,
            title,
            description,
            customizations: { primaryColor, brief },
            outputConfigs,
            spec,
          },
        })
      } else {
        await createMutation.mutateAsync({
          workflowId,
          identifier,
          title,
          description,
          customizations: { primaryColor, brief },
          outputConfigs,
          spec,
        })
      }
      dirtyRef.current = false
      await onRefetch?.()
      onDeployed?.()
      const url = `${getBaseUrl()}/interface/${identifier}`
      toast({ message: `Interface published: ${url}` })
      window.open(url, '_blank', 'noopener,noreferrer')
    } catch (error) {
      const message = getErrorMessage(error, 'Failed to publish interface')
      setFormError(message)
      logger.error(message, error)
    } finally {
      setSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!existingInterface?.id) return
    setSubmitting(true)
    try {
      await deleteMutation.mutateAsync({ id: existingInterface.id, workflowId })
      dirtyRef.current = false
      applyFormState(emptyFormState())
      await onRefetch?.()
      toast({ message: 'Interface deleted' })
    } catch (error) {
      setFormError(getErrorMessage(error, 'Failed to delete interface'))
    } finally {
      setSubmitting(false)
    }
  }

  if (isLoading) {
    return (
      <div className='flex h-40 items-center justify-center'>
        <Loader className='h-5 w-5' />
      </div>
    )
  }

  return (
    <div className='space-y-5'>
      <p className='text-[var(--text-secondary)] text-sm'>
        Generate a form or button UI for this workflow, preview it, then publish a public link.
        Leaving outputs empty shows a simple Done message after submit.
      </p>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-1.5'>
          <Label htmlFor='interface-identifier'>Identifier</Label>
          <Input
            id='interface-identifier'
            value={identifier}
            onChange={(e) => {
              markDirty()
              setIdentifier(e.target.value.toLowerCase())
            }}
            placeholder='send-hi'
          />
          {identifierError ? (
            <p className='text-red-600 text-xs'>{identifierError}</p>
          ) : (
            <p className='text-[var(--text-tertiary)] text-xs'>
              {getBaseUrl()}/interface/{identifier || '…'}
            </p>
          )}
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='interface-title'>Title</Label>
          <Input
            id='interface-title'
            value={title}
            onChange={(e) => {
              markDirty()
              setTitle(e.target.value)
            }}
            placeholder='Send hi email'
          />
        </div>
      </div>

      <div className='space-y-1.5'>
        <Label htmlFor='interface-description'>Description</Label>
        <Input
          id='interface-description'
          value={description}
          onChange={(e) => {
            markDirty()
            setDescription(e.target.value)
          }}
          placeholder='Optional public description'
        />
      </div>

      <div className='grid gap-4 sm:grid-cols-2'>
        <div className='space-y-1.5'>
          <Label htmlFor='interface-color'>Primary color</Label>
          <Input
            id='interface-color'
            value={primaryColor}
            onChange={(e) => {
              markDirty()
              setPrimaryColor(e.target.value)
            }}
            placeholder='#2563eb'
          />
        </div>
        <div className='space-y-1.5'>
          <Label>Outputs to display</Label>
          <OutputSelect
            workflowId={workflowId}
            selectedOutputs={selectedOutputs}
            onOutputSelect={(outputs) => {
              markDirty()
              setSelectedOutputs(outputs)
            }}
          />
          <p className='text-[var(--text-tertiary)] text-xs'>
            Optional. Empty means the public page only shows Done after a successful run.
          </p>
        </div>
      </div>

      <div className='space-y-1.5'>
        <Label htmlFor='interface-brief'>Brief</Label>
        <Textarea
          id='interface-brief'
          value={brief}
          onChange={(e) => {
            markDirty()
            setBrief(e.target.value)
          }}
          placeholder='e.g. One big button that sends the email. Keep it minimal.'
          rows={3}
        />
      </div>

      {formError ? <p className='text-red-600 text-sm'>{formError}</p> : null}

      <div className='flex flex-wrap gap-2'>
        <Button type='button' variant='default' disabled={submitting} onClick={handleGenerate}>
          {generateMutation.isPending ? 'Generating…' : 'Generate'}
        </Button>
        <Button
          type='button'
          variant='tertiary'
          disabled={submitting || !isValid}
          onClick={handlePublish}
          data-interface-publish
        >
          {existingInterface ? 'Publish update' : 'Publish'}
        </Button>
        {existingInterface ? (
          <Button
            type='button'
            variant='default'
            disabled={submitting}
            onClick={handleDelete}
            data-delete-trigger
          >
            Delete
          </Button>
        ) : null}
      </div>

      {previewDto ? (
        <div className='rounded-lg border border-[var(--border)] bg-[var(--bg-primary)]'>
          <div className='border-[var(--border)] border-b px-4 py-2 font-medium text-sm'>
            Preview
          </div>
          <InterfaceRenderer
            dto={previewDto}
            onSubmit={async () => {
              toast({
                message: 'Preview only — publish to run the workflow from the public page.',
              })
            }}
          />
        </div>
      ) : null}
    </div>
  )
}
