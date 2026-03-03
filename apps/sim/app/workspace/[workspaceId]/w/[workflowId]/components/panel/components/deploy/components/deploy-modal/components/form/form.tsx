'use client'

import { useCallback, useEffect, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createLogger } from '@sim/logger'
import { Check, Eye, EyeOff, Loader2 } from 'lucide-react'
import {
  ButtonGroup,
  ButtonGroupItem,
  Input,
  Label,
  TagInput,
  type TagItem,
  Textarea,
  Tooltip,
} from '@/components/emcn'
import { Skeleton } from '@/components/ui'
import { isDev } from '@/lib/core/config/feature-flags'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl, getEmailDomain } from '@/lib/core/utils/urls'
import { isInputDefinitionTrigger } from '@/lib/workflows/triggers/input-definition-triggers'
import {
  type FieldConfig,
  useCreateForm,
  useDeleteForm,
  useFormByWorkflow,
  useUpdateForm,
} from '@/hooks/queries/forms'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { EmbedCodeGenerator } from './components/embed-code-generator'
import { FormBuilder } from './components/form-builder'
import { useIdentifierValidation } from './hooks/use-identifier-validation'

const logger = createLogger('FormDeploy')

interface FormErrors {
  identifier?: string
  title?: string
  password?: string
  emails?: string
  general?: string
}

interface FormDeployProps {
  workflowId: string
  onDeploymentComplete?: () => void
  onValidationChange?: (isValid: boolean) => void
  onSubmittingChange?: (isSubmitting: boolean) => void
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
  formSubmitting,
  setFormSubmitting,
  onDeployed,
}: FormDeployProps) {
  const t = useTranslations()
  const [identifier, setIdentifier] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [thankYouMessage, setThankYouMessage] = useState('')
  const [authType, setAuthType] = useState<'public' | 'password' | 'email'>('public')
  const [password, setPassword] = useState('')
  const [emailItems, setEmailItems] = useState<TagItem[]>([])
  const [formUrl, setFormUrl] = useState('')
  const [inputFields, setInputFields] = useState<{ name: string; type: string }[]>([])
  const [showPasswordField, setShowPasswordField] = useState(false)
  const [fieldConfigs, setFieldConfigs] = useState<FieldConfig[]>([])
  const [errors, setErrors] = useState<FormErrors>({})
  const [isIdentifierValid, setIsIdentifierValid] = useState(false)

  const { data: existingForm, isLoading } = useFormByWorkflow(workflowId)
  const createFormMutation = useCreateForm()
  const updateFormMutation = useUpdateForm()
  const deleteFormMutation = useDeleteForm()

  const isSubmitting = createFormMutation.isPending || updateFormMutation.isPending

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

  useEffect(() => {
    if (!thankYouMessage) {
      setThankYouMessage(t('form_deploy.placeholders.thank_you_message'))
    }
  }, [])

  // Populate form fields when existing form data is loaded
  useEffect(() => {
    if (existingForm) {
      setIdentifier(existingForm.identifier)
      setTitle(existingForm.title)
      setDescription(existingForm.description || '')
      setThankYouMessage(
        existingForm.customizations?.thankYouMessage ||
          t('form_deploy.placeholders.thank_you_message')
      )
      setAuthType(existingForm.authType)
      setEmailItems(
        (existingForm.allowedEmails || []).map((email) => ({ value: email, isValid: true }))
      )
      if (existingForm.customizations?.fieldConfigs) {
        setFieldConfigs(existingForm.customizations.fieldConfigs)
      }

      const baseUrl = getBaseUrl()
      try {
        const url = new URL(baseUrl)
        let host = url.host
        if (host.startsWith('www.')) host = host.substring(4)
        setFormUrl(`${url.protocol}//${host}/form/${existingForm.identifier}`)
      } catch {
        setFormUrl(
          isDev
            ? `http://localhost:3000/form/${existingForm.identifier}`
            : `https://sim.ai/form/${existingForm.identifier}`
        )
      }
    } else if (!isLoading) {
      const workflowName =
        useWorkflowStore.getState().blocks[Object.keys(useWorkflowStore.getState().blocks)[0]]
          ?.name || 'Form'
      setTitle(`${workflowName} Form`)
    }
  }, [existingForm, isLoading])

  useEffect(() => {
    const blocks = Object.values(useWorkflowStore.getState().blocks)
    const startBlock = blocks.find((b) => isInputDefinitionTrigger(b.type))

    if (startBlock) {
      const inputFormat = useSubBlockStore.getState().getValue(startBlock.id, 'inputFormat')
      if (inputFormat && Array.isArray(inputFormat)) {
        setInputFields(inputFormat)

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

  const allowedEmails = emailItems.filter((item) => item.isValid).map((item) => item.value)

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
    allowedEmails.length,
    existingForm?.hasPassword,
    onValidationChange,
    inputFields.length,
  ])

  useEffect(() => {
    onSubmittingChange?.(isSubmitting)
    setFormSubmitting?.(isSubmitting)
  }, [isSubmitting, onSubmittingChange, setFormSubmitting])

  const handleSubmit = useCallback(
    async (e: React.FormEvent) => {
      e.preventDefault()
      setErrors({})

      if (!isIdentifierValid && identifier !== existingForm?.identifier) {
        setError('identifier', t('form_deploy.errors.validation_pending'))
        return
      }

      if (!title.trim()) {
        setError('title', t('form_deploy.errors.title_required'))
        return
      }

      if (authType === 'password' && !existingForm?.hasPassword && !password.trim()) {
        setError('password', t('form_deploy.errors.password_required'))
        return
      }

      if (authType === 'email' && allowedEmails.length === 0) {
        setError('emails', t('form_deploy.errors.emails_required'))
        return
      }

      const customizations = {
        thankYouMessage,
        fieldConfigs,
      }

      try {
        if (existingForm) {
          await updateFormMutation.mutateAsync({
            formId: existingForm.id,
            workflowId,
            data: {
              identifier,
              title,
              description,
              customizations,
              authType,
              password: password || undefined,
              allowedEmails,
            },
          })
        } else {
          const result = await createFormMutation.mutateAsync({
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
      createFormMutation,
      updateFormMutation,
      onDeployed,
      onDeploymentComplete,
    ]
  )

  const handleDelete = useCallback(async () => {
    if (!existingForm) return

    try {
      await deleteFormMutation.mutateAsync({
        formId: existingForm.id,
        workflowId,
      })
      setIdentifier('')
      setTitle('')
      setDescription('')
      setFormUrl('')
    } catch (err) {
      logger.error('Error deleting form:', err)
    }
  }, [existingForm, deleteFormMutation, workflowId])

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
        {t('form_deploy.helper_text.no_input_fields')}
      </div>
    )
  }

  const fullUrl = `${getBaseUrl()}/form/${identifier}`
  const displayUrl = fullUrl.replace(/^https?:\/\//, '')

  return (
    <form id='form-deploy-form' onSubmit={handleSubmit} className='-mx-1 space-y-4 px-1'>
      <div className='space-y-[12px]'>
        {/* URL Input - matching chat style */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            {t('form_deploy.labels.url')}
          </Label>
          <div
            className={cn(
              'relative flex items-stretch overflow-hidden rounded-[4px] border border-[var(--border-1)]',
              (identifierError || errors.identifier) && 'border-[var(--text-error)]'
            )}
          >
            <div className='flex items-center whitespace-nowrap bg-[var(--surface-5)] pr-[6px] pl-[8px] font-medium text-[var(--text-secondary)] text-sm'>
              {getDomainPrefix()}
            </div>
            <div className='relative flex-1'>
              <Input
                value={identifier}
                onChange={(e) => {
                  setIdentifier(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))
                  clearError('identifier')
                }}
                placeholder={t('form_deploy.placeholders.form_url')}
                className={cn(
                  'rounded-none border-0 pl-0 shadow-none',
                  (isCheckingIdentifier || (identifierValidationPassed && identifier)) &&
                    'pr-[32px]'
                )}
              />
              {isCheckingIdentifier ? (
                <div className='-translate-y-1/2 absolute top-1/2 right-2'>
                  <Loader2 className='h-4 w-4 animate-spin text-[var(--text-tertiary)]' />
                </div>
              ) : (
                identifierValidationPassed &&
                identifier && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <div className='-translate-y-1/2 absolute top-1/2 right-2'>
                        <Check className='h-4 w-4 text-[var(--brand-tertiary-2)]' />
                      </div>
                    </Tooltip.Trigger>
                    <Tooltip.Content>
                      <span>{t('form_deploy.helper_text.name_available')}</span>
                    </Tooltip.Content>
                  </Tooltip.Root>
                )
              )}
            </div>
          </div>
          {(identifierError || errors.identifier) && (
            <p className='mt-[6.5px] text-[12px] text-[var(--text-error)]'>
              {identifierError || errors.identifier}
            </p>
          )}
          <p className='mt-[6.5px] truncate text-[11px] text-[var(--text-secondary)]'>
            {existingForm && identifier ? (
              <>
                {t('form_deploy.helper_text.live_at')}{' '}
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
              t('form_deploy.helper_text.url')
            )}
          </p>
        </div>

        {/* Form Builder Preview */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            {t('form_deploy.labels.form_builder')}
          </Label>
          <FormBuilder
            title={title}
            onTitleChange={(value: string) => {
              setTitle(value)
              clearError('title')
            }}
            description={description}
            onDescriptionChange={setDescription}
            fieldConfigs={fieldConfigs}
            onFieldConfigsChange={setFieldConfigs}
            titleError={errors.title}
          />
        </div>

        {/* Access Control */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            {t('form_deploy.labels.access_control')}
          </Label>
          <ButtonGroup
            value={authType}
            onValueChange={(val) => setAuthType(val as 'public' | 'password' | 'email')}
          >
            <ButtonGroupItem value='public'>{t('form_deploy.buttons.public')}</ButtonGroupItem>
            <ButtonGroupItem value='password'>{t('form_deploy.buttons.password')}</ButtonGroupItem>
            <ButtonGroupItem value='email'>{t('form_deploy.buttons.email')}</ButtonGroupItem>
          </ButtonGroup>
        </div>

        {authType === 'password' && (
          <div>
            <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              {t('form_deploy.labels.password')}
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
                  existingForm?.hasPassword
                    ? t('form_deploy.placeholders.password_existing')
                    : t('form_deploy.placeholders.password')
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
              <p className='mt-[6.5px] text-[12px] text-[var(--text-error)]'>{errors.password}</p>
            )}
            <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
              {existingForm?.hasPassword
                ? t('form_deploy.helper_text.password_existing')
                : t('form_deploy.helper_text.password')}
            </p>
          </div>
        )}

        {authType === 'email' && (
          <div>
            <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              {t('form_deploy.labels.allowed_emails')}
            </Label>
            <TagInput
              items={emailItems}
              onAdd={(value) => {
                const trimmed = value.trim().toLowerCase()
                if (!trimmed || emailItems.some((item) => item.value === trimmed)) {
                  return false
                }
                const isDomainPattern = trimmed.startsWith('@')
                const isValid = isDomainPattern || trimmed.includes('@')
                setEmailItems((prev) => [...prev, { value: trimmed, isValid }])
                if (isValid) {
                  clearError('emails')
                }
                return isValid
              }}
              onRemove={(_value, index) => {
                setEmailItems((prev) => prev.filter((_, i) => i !== index))
              }}
              placeholder={t('form_deploy.placeholders.emails')}
              placeholderWithTags={t('form_deploy.placeholders.emails_additional')}
            />
            {errors.emails && (
              <p className='mt-[6.5px] text-[12px] text-[var(--text-error)]'>{errors.emails}</p>
            )}
            <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
              {t('form_deploy.helper_text.emails')}
            </p>
          </div>
        )}

        {/* Thank You Message */}
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            {t('form_deploy.labels.thank_you_message')}
          </Label>
          <Textarea
            value={thankYouMessage}
            onChange={(e) => setThankYouMessage(e.target.value)}
            placeholder={t('form_deploy.placeholders.thank_you_message')}
            rows={2}
            className='min-h-[60px] resize-none'
          />
          <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
            {t('form_deploy.helper_text.thank_you_message')}
          </p>
        </div>

        {/* Embed Code - only when deployed */}
        {existingForm && formUrl && (
          <EmbedCodeGenerator formUrl={formUrl} identifier={identifier} />
        )}

        {errors.general && (
          <p className='mt-[6.5px] text-[12px] text-[var(--text-error)]'>{errors.general}</p>
        )}

        <button type='button' data-delete-trigger onClick={handleDelete} className='hidden' />
      </div>
    </form>
  )
}
