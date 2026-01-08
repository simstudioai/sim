'use client'

import { useCallback, useEffect, useState } from 'react'
import { createLogger } from '@sim/logger'
import { ChevronDown, ChevronRight, Eye, EyeOff, Loader2, X } from 'lucide-react'
import { Badge, ButtonGroup, ButtonGroupItem, Input, Label, Textarea } from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { getEnv } from '@/lib/core/config/env'
import { isDev } from '@/lib/core/config/feature-flags'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl, getEmailDomain } from '@/lib/core/utils/urls'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { EmbedCodeGenerator } from './components/embed-code-generator'
import { useFormDeployment } from './hooks/use-form-deployment'
import { useIdentifierValidation } from './hooks/use-identifier-validation'

const logger = createLogger('FormDeploy')

interface FormErrors {
  identifier?: string
  title?: string
  password?: string
  emails?: string
  general?: string
}

interface FieldConfig {
  name: string
  type: string
  label: string
  description?: string
  required?: boolean
}

export interface ExistingForm {
  id: string
  identifier: string
  title: string
  description?: string
  customizations: {
    primaryColor?: string
    thankYouMessage?: string
    logoUrl?: string
    fieldConfigs?: FieldConfig[]
  }
  authType: 'public' | 'password' | 'email'
  hasPassword?: boolean
  allowedEmails?: string[]
  showBranding: boolean
  isActive: boolean
}

interface FormDeployProps {
  workflowId: string
  onDeploymentComplete?: () => void
  onValidationChange?: (isValid: boolean) => void
  onSubmittingChange?: (isSubmitting: boolean) => void
  onExistingFormChange?: (exists: boolean) => void
  formSubmitting?: boolean
  setFormSubmitting?: (submitting: boolean) => void
  onDeployed?: () => Promise<void>
}

const getDomainPrefix = (() => {
  const prefix = `${getEmailDomain()}/form/`
  return () => prefix
})()

export function FormDeploy({
  workflowId,
  onDeploymentComplete,
  onValidationChange,
  onSubmittingChange,
  onExistingFormChange,
  formSubmitting,
  setFormSubmitting,
  onDeployed,
}: FormDeployProps) {
  const [identifier, setIdentifier] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [thankYouMessage, setThankYouMessage] = useState(
    'Your response has been submitted successfully.'
  )
  const [authType, setAuthType] = useState<'public' | 'password' | 'email'>('public')
  const [password, setPassword] = useState('')
  const [allowedEmails, setAllowedEmails] = useState<string[]>([])
  const [existingForm, setExistingForm] = useState<ExistingForm | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [formUrl, setFormUrl] = useState('')
  const [inputFields, setInputFields] = useState<{ name: string; type: string }[]>([])
  const [showPasswordField, setShowPasswordField] = useState(false)
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([])
  const [expandedFields, setExpandedFields] = useState<Set<string>>(new Set())
  const [errors, setErrors] = useState<FormErrors>({})
  const [isIdentifierValid, setIsIdentifierValid] = useState(false)

  const { createForm, updateForm, deleteForm, isSubmitting } = useFormDeployment()

  const {
    isChecking: isCheckingIdentifier,
    error: identifierError,
    isValid: identifierValidationPassed,
  } = useIdentifierValidation(identifier, existingForm?.identifier, !!existingForm)

  useEffect(() => {
    setIsIdentifierValid(identifierValidationPassed)
  }, [identifierValidationPassed])

  const setError = (field: keyof FormErrors, message: string) => {
    setErrors((prev) => ({ ...prev, [field]: message }))
  }

  const clearError = (field: keyof FormErrors) => {
    setErrors((prev) => ({ ...prev, [field]: undefined }))
  }

  // Fetch existing form deployment
  useEffect(() => {
    async function fetchExistingForm() {
      if (!workflowId) return

      try {
        setIsLoading(true)
        const response = await fetch(`/api/workflows/${workflowId}/form/status`)

        if (response.ok) {
          const data = await response.json()
          if (data.isDeployed && data.form) {
            const detailResponse = await fetch(`/api/form/manage/${data.form.id}`)
            if (detailResponse.ok) {
              const formDetail = await detailResponse.json()
              const form = formDetail.form as ExistingForm
              setExistingForm(form)
              onExistingFormChange?.(true)

              setIdentifier(form.identifier)
              setTitle(form.title)
              setDescription(form.description || '')
              setThankYouMessage(
                form.customizations?.thankYouMessage ||
                  'Your response has been submitted successfully.'
              )
              setAuthType(form.authType)
              setAllowedEmails(form.allowedEmails || [])
              if (form.customizations?.fieldConfigs) {
                setFieldConfigs(form.customizations.fieldConfigs)
              }

              const baseUrl = getBaseUrl()
              try {
                const url = new URL(baseUrl)
                let host = url.host
                if (host.startsWith('www.')) host = host.substring(4)
                setFormUrl(`${url.protocol}//${host}/form/${form.identifier}`)
              } catch {
                setFormUrl(
                  isDev
                    ? `http://localhost:3000/form/${form.identifier}`
                    : `https://sim.ai/form/${form.identifier}`
                )
              }
            }
          } else {
            setExistingForm(null)
            onExistingFormChange?.(false)

            const workflowName =
              useWorkflowStore.getState().blocks[Object.keys(useWorkflowStore.getState().blocks)[0]]
                ?.name || 'Form'
            setTitle(`${workflowName} Form`)
          }
        }
      } catch (err) {
        logger.error('Error fetching form deployment:', err)
      } finally {
        setIsLoading(false)
      }
    }

    fetchExistingForm()
  }, [workflowId, onExistingFormChange])

  // Get input fields from start block and initialize field configs
  useEffect(() => {
    const blocks = Object.values(useWorkflowStore.getState().blocks)
    const startBlock = blocks.find((b) => b.type === 'starter' || b.type === 'start_trigger')

    if (startBlock) {
      const inputFormat = useSubBlockStore.getState().getValue(startBlock.id, 'inputFormat')
      if (inputFormat && Array.isArray(inputFormat)) {
        setInputFields(inputFormat)

        // Initialize field configs if not already set
        if (fieldConfigs.length === 0) {
          setFieldConfigs(
            inputFormat.map((f: { name: string; type?: string }) => ({
              name: f.name,
              type: f.type || 'string',
              label: f.name
                .replace(/([A-Z])/g, ' $1')
                .replace(/_/g, ' ')
                .replace(/^./, (s) => s.toUpperCase())
                .trim(),
            }))
          )
        }
      }
    }
  }, [workflowId, fieldConfigs.length])

  // Validate form
  useEffect(() => {
    const isValid =
      inputFields.length > 0 &&
      isIdentifierValid &&
      title.trim().length > 0 &&
      (authType !== 'password' || password.length > 0 || !!existingForm?.hasPassword) &&
      (authType !== 'email' || allowedEmails.length > 0)

    onValidationChange?.(isValid)
  }, [
    isIdentifierValid,
    title,
    authType,
    password,
    allowedEmails,
    existingForm?.hasPassword,
    onValidationChange,
    inputFields.length,
  ])

  useEffect(() => {
    onSubmittingChange?.(isSubmitting)
    setFormSubmitting?.(isSubmitting)
  }, [isSubmitting, onSubmittingChange, setFormSubmitting])

  const toggleFieldExpanded = (fieldName: string) => {
    setExpandedFields((prev) => {
      const next = new Set(prev)
      if (next.has(fieldName)) {
        next.delete(fieldName)
      } else {
        next.add(fieldName)
      }
      return next
    })
  }

  const updateFieldConfig = (fieldName: string, updates: Partial<FieldConfig>) => {
    setFieldConfigs((prev) => prev.map((f) => (f.name === fieldName ? { ...f, ...updates } : f)))
  }

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setErrors({})

      // Validate before submit
      if (!isIdentifierValid && identifier !== existingForm?.identifier) {
        setError('identifier', 'Please wait for identifier validation to complete')
        return
      }

      if (!title.trim()) {
        setError('title', 'Title is required')
        return
      }

      if (authType === 'password' && !existingForm?.hasPassword && !password.trim()) {
        setError('password', 'Password is required')
        return
      }

      if (authType === 'email' && allowedEmails.length === 0) {
        setError('emails', 'At least one email or domain is required')
        return
      }

      const customizations = {
        thankYouMessage,
        fieldConfigs,
      }

      try {
        if (existingForm) {
          await updateForm(existingForm.id, {
            identifier,
            title,
            description,
            customizations,
            authType,
            password: password || undefined,
            allowedEmails,
          })
        } else {
          const result = await createForm({
            workflowId,
            identifier,
            title,
            description,
            customizations,
            authType,
            password,
            allowedEmails,
          })

          if (result?.formUrl) {
            setFormUrl(result.formUrl)
            // Open the form in a new window after successful deployment
            window.open(result.formUrl, '_blank', 'noopener,noreferrer')
          }
        }

        await onDeployed?.()

        if (!existingForm) {
          onDeploymentComplete?.()
        }
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : 'An error occurred'
        logger.error('Error deploying form:', err)

        // Parse error message and show inline
        if (message.toLowerCase().includes('identifier')) {
          setError('identifier', message)
        } else if (message.toLowerCase().includes('password')) {
          setError('password', message)
        } else if (message.toLowerCase().includes('email')) {
          setError('emails', message)
        } else {
          setError('general', message)
        }
      }
    },
    [
      existingForm,
      workflowId,
      identifier,
      title,
      description,
      thankYouMessage,
      fieldConfigs,
      authType,
      password,
      allowedEmails,
      isIdentifierValid,
      createForm,
      updateForm,
      onDeployed,
      onDeploymentComplete,
    ]
  )

  const handleDelete = useCallback(async () => {
    if (!existingForm) return

    try {
      await deleteForm(existingForm.id)
      setExistingForm(null)
      onExistingFormChange?.(false)
      setIdentifier('')
      setTitle('')
      setDescription('')
      setFormUrl('')
    } catch (err) {
      logger.error('Error deleting form:', err)
    }
  }, [existingForm, deleteForm, onExistingFormChange])

  if (isLoading) {
    return (
      <div className='-mx-1 space-y-4 px-1'>
        <div className='space-y-[12px]'>
          <div>
            <Skeleton className='mb-[6.5px] h-[16px] w-[26px]' />
            <Skeleton className='h-[34px] w-full rounded-[4px]' />
            <Skeleton className='mt-[6.5px] h-[14px] w-[320px]' />
          </div>
          <div>
            <Skeleton className='mb-[6.5px] h-[16px] w-[30px]' />
            <Skeleton className='h-[34px] w-full rounded-[4px]' />
          </div>
        </div>
      </div>
    )
  }

  if (inputFields.length === 0) {
    return (
      <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-secondary)]'>
        Add input fields to the Start block to create a form.
      </div>
    )
  }

  const fullUrl = `${getEnv('NEXT_PUBLIC_APP_URL')}/form/${identifier}`
  const displayUrl = fullUrl.replace(/^https?:\/\//, '')

  return (
    <form
      id='form-deploy-form'
      onSubmit={handleSubmit}
      className='-mx-1 space-y-4 overflow-y-auto px-1'
    >
      <div className='space-y-[12px]'>
        {/* URL Input - matching chat style */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            URL
          </Label>
          <div
            className={cn(
              'relative flex items-stretch overflow-hidden rounded-[4px] border border-[var(--border-1)]',
              (identifierError || errors.identifier) && 'border-[var(--text-error)]'
            )}
          >
            <div className='flex items-center whitespace-nowrap bg-[var(--surface-5)] px-[8px] font-medium text-[var(--text-secondary)] text-sm'>
              {getDomainPrefix()}
            </div>
            <div className='relative flex-1'>
              <Input
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  clearError('identifier')
                }}
                placeholder='my-form'
                className={cn(
                  'rounded-none border-0 pl-0 shadow-none',
                  isCheckingIdentifier && 'pr-[32px]'
                )}
              />
              {isCheckingIdentifier && (
                <div className='-translate-y-1/2 absolute top-1/2 right-2'>
                  <Loader2 className='h-4 w-4 animate-spin text-[var(--text-tertiary)]' />
                </div>
              )}
            </div>
          </div>
          {(identifierError || errors.identifier) && (
            <p className='mt-[6.5px] text-[11px] text-[var(--text-error)]'>
              {identifierError || errors.identifier}
            </p>
          )}
          <p className='mt-[6.5px] truncate text-[11px] text-[var(--text-secondary)]'>
            {existingForm && identifier ? (
              <>
                Live at:{' '}
                <a
                  href={fullUrl}
                  target='_blank'
                  rel='noopener noreferrer'
                  className='text-[var(--text-primary)] hover:underline'
                >
                  {displayUrl}
                </a>
              </>
            ) : (
              'The unique URL path where your form will be accessible'
            )}
          </p>
        </div>

        {/* Title */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Title
          </Label>
          <Input
            value={title}
            onChange={(e) => {
              setTitle(e.target.value)
              clearError('title')
            }}
            placeholder='Contact Form'
          />
          {errors.title && (
            <p className='mt-[6.5px] text-[11px] text-[var(--text-error)]'>{errors.title}</p>
          )}
        </div>

        {/* Description */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Description
          </Label>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder='Fill out the form below'
          />
          <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
            Optional text shown below the form title
          </p>
        </div>

        {/* Form Fields Configuration */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Form fields
          </Label>
          <div className='space-y-[8px]'>
            {fieldConfigs.map((config) => (
              <div
                key={config.name}
                className='overflow-hidden rounded-[4px] border border-[var(--border-1)]'
              >
                <div
                  className='flex cursor-pointer items-center justify-between bg-[var(--surface-4)] px-[10px] py-[5px]'
                  onClick={() => toggleFieldExpanded(config.name)}
                >
                  <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
                    {expandedFields.has(config.name) ? (
                      <ChevronDown className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
                    ) : (
                      <ChevronRight className='h-[14px] w-[14px] text-[var(--text-tertiary)]' />
                    )}
                    <span className='truncate font-medium text-[14px] text-[var(--text-tertiary)]'>
                      {config.label || config.name}
                    </span>
                  </div>
                  <Badge size='sm'>{config.type}</Badge>
                </div>

                {expandedFields.has(config.name) && (
                  <div className='flex flex-col gap-[8px] border-[var(--border-1)] border-t px-[10px] pt-[6px] pb-[10px]'>
                    <div className='flex flex-col gap-[6px]'>
                      <Label className='text-[13px]'>Label</Label>
                      <Input
                        value={config.label}
                        onChange={(e) => updateFieldConfig(config.name, { label: e.target.value })}
                        placeholder='Enter display label'
                      />
                    </div>
                    <div className='flex flex-col gap-[6px]'>
                      <Label className='text-[13px]'>Description</Label>
                      <Input
                        value={config.description || ''}
                        onChange={(e) =>
                          updateFieldConfig(config.name, { description: e.target.value })
                        }
                        placeholder='Optional help text'
                      />
                    </div>
                    <p className='text-[11px] text-[var(--text-secondary)]'>
                      Maps to:{' '}
                      <code className='rounded bg-[var(--surface-4)] px-1'>{config.name}</code>
                    </p>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Access Control */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Access control
          </Label>
          <ButtonGroup
            value={authType}
            onValueChange={(val) => setAuthType(val as 'public' | 'password' | 'email')}
          >
            <ButtonGroupItem value='public'>Public</ButtonGroupItem>
            <ButtonGroupItem value='password'>Password</ButtonGroupItem>
            <ButtonGroupItem value='email'>Email</ButtonGroupItem>
          </ButtonGroup>
        </div>

        {authType === 'password' && (
          <div>
            <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              Password
            </Label>
            <div className='relative'>
              <Input
                type={showPasswordField ? 'text' : 'password'}
                value={password}
                onChange={(e) => {
                  setPassword(e.target.value)
                  clearError('password')
                }}
                placeholder={
                  existingForm?.hasPassword ? 'Enter new password to change' : 'Enter password'
                }
                className='pr-[32px]'
              />
              <button
                type='button'
                onClick={() => setShowPasswordField(!showPasswordField)}
                className='-translate-y-1/2 absolute top-1/2 right-[8px] text-[var(--text-secondary)]'
              >
                {showPasswordField ? <EyeOff className='h-4 w-4' /> : <Eye className='h-4 w-4' />}
              </button>
            </div>
            {errors.password && (
              <p className='mt-[6.5px] text-[11px] text-[var(--text-error)]'>{errors.password}</p>
            )}
            <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
              {existingForm?.hasPassword
                ? 'Leave empty to keep the current password'
                : 'This password will be required to access your form'}
            </p>
          </div>
        )}

        {authType === 'email' && (
          <div>
            <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              Allowed emails
            </Label>
            <div className='flex flex-wrap items-center gap-[4px] rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-5)] px-[8px] py-[6px]'>
              {allowedEmails.map((email) => (
                <div
                  key={email}
                  className='flex items-center gap-[4px] rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-4)] px-[6px] py-[2px] text-[12px]'
                >
                  <span>{email}</span>
                  <button
                    type='button'
                    onClick={() => setAllowedEmails(allowedEmails.filter((e) => e !== email))}
                    className='text-[var(--text-tertiary)] hover:text-[var(--text-primary)]'
                  >
                    <X className='h-[12px] w-[12px]' />
                  </button>
                </div>
              ))}
              <input
                type='text'
                placeholder={
                  allowedEmails.length > 0 ? 'Add another' : 'Enter emails or @domain.com'
                }
                className='min-w-[150px] flex-1 border-none bg-transparent p-0 text-sm outline-none placeholder:text-[var(--text-muted)]'
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ',') {
                    e.preventDefault()
                    const value = (e.target as HTMLInputElement).value.trim()
                    if (value && !allowedEmails.includes(value)) {
                      setAllowedEmails([...allowedEmails, value])
                      clearError('emails')
                      ;(e.target as HTMLInputElement).value = ''
                    }
                  }
                }}
              />
            </div>
            {errors.emails && (
              <p className='mt-[6.5px] text-[11px] text-[var(--text-error)]'>{errors.emails}</p>
            )}
            <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
              Add specific emails or entire domains (@example.com)
            </p>
          </div>
        )}

        {/* Thank You Message */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            Thank you message
          </Label>
          <Textarea
            value={thankYouMessage}
            onChange={(e) => setThankYouMessage(e.target.value)}
            placeholder='Your response has been submitted successfully.'
            rows={2}
            className='min-h-[60px] resize-none'
          />
          <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
            This message will be displayed after form submission
          </p>
        </div>

        {/* Embed Code - only when deployed */}
        {existingForm && formUrl && (
          <EmbedCodeGenerator formUrl={formUrl} identifier={identifier} />
        )}

        {errors.general && (
          <p className='mt-[6.5px] text-[11px] text-[var(--text-error)]'>{errors.general}</p>
        )}

        <button type='button' data-delete-trigger onClick={handleDelete} className='hidden' />
      </div>
    </form>
  )
}
