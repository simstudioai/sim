'use client'

import { useEffect, useRef, useState } from 'react'
import { useTranslations } from 'next-intl'
import { createLogger } from '@sim/logger'
import { AlertTriangle, Check, Clipboard, Eye, EyeOff, Loader2, RefreshCw } from 'lucide-react'
import {
  Button,
  ButtonGroup,
  ButtonGroupItem,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  TagInput,
  type TagItem,
  Textarea,
  Tooltip,
} from '@/components/emcn'
import { Alert, AlertDescription, Skeleton } from '@/components/ui'
import { getEnv, isTruthy } from '@/lib/core/config/env'
import { generatePassword } from '@/lib/core/security/encryption'
import { cn } from '@/lib/core/utils/cn'
import { getBaseUrl, getEmailDomain } from '@/lib/core/utils/urls'
import { quickValidateEmail } from '@/lib/messaging/email/validation'
import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components/output-select/output-select'
import {
  type AuthType,
  type ChatFormData,
  useCreateChat,
  useDeleteChat,
  useUpdateChat,
} from '@/hooks/queries/chats'
import { useIdentifierValidation } from './hooks'

const logger = createLogger('ChatDeploy')

const IDENTIFIER_PATTERN = /^[a-z0-9-]+$/

interface ChatDeployProps {
  workflowId: string
  deploymentInfo: {
    apiKey: string
  } | null
  existingChat: ExistingChat | null
  isLoadingChat: boolean
  onRefetchChat: () => Promise<void>
  chatSubmitting: boolean
  setChatSubmitting: (submitting: boolean) => void
  onValidationChange?: (isValid: boolean) => void
  showDeleteConfirmation?: boolean
  setShowDeleteConfirmation?: (show: boolean) => void
  onDeploymentComplete?: () => void
  onDeployed?: () => void
  onVersionActivated?: () => void
}

export interface ExistingChat {
  id: string
  identifier: string
  title: string
  description: string
  authType: 'public' | 'password' | 'email' | 'sso'
  allowedEmails: string[]
  outputConfigs: Array<{ blockId: string; path: string }>
  customizations?: {
    welcomeMessage?: string
    imageUrl?: string
  }
  isActive: boolean
}

interface FormErrors {
  identifier?: string
  title?: string
  password?: string
  emails?: string
  outputBlocks?: string
  general?: string
}

const initialFormData: ChatFormData = {
  identifier: '',
  title: '',
  description: '',
  authType: 'public',
  password: '',
  emails: [],
  welcomeMessage: 'Hi there! How can I help you today?',
  selectedOutputBlocks: [],
}

export function ChatDeploy({
  workflowId,
  deploymentInfo,
  existingChat,
  isLoadingChat,
  onRefetchChat,
  chatSubmitting,
  setChatSubmitting,
  onValidationChange,
  showDeleteConfirmation: externalShowDeleteConfirmation,
  setShowDeleteConfirmation: externalSetShowDeleteConfirmation,
  onDeploymentComplete,
  onDeployed,
  onVersionActivated,
}: ChatDeployProps) {
  const t = useTranslations()
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [internalShowDeleteConfirmation, setInternalShowDeleteConfirmation] = useState(false)

  const showDeleteConfirmation =
    externalShowDeleteConfirmation !== undefined
      ? externalShowDeleteConfirmation
      : internalShowDeleteConfirmation

  const setShowDeleteConfirmation =
    externalSetShowDeleteConfirmation || setInternalShowDeleteConfirmation

  const [formData, setFormData] = useState<ChatFormData>(initialFormData)
  const [errors, setErrors] = useState<FormErrors>({})
  const formRef = useRef<HTMLFormElement>(null)

  const createChatMutation = useCreateChat()
  const updateChatMutation = useUpdateChat()
  const deleteChatMutation = useDeleteChat()
  const [isIdentifierValid, setIsIdentifierValid] = useState(false)
  const [hasInitializedForm, setHasInitializedForm] = useState(false)

  const updateField = <K extends keyof ChatFormData>(field: K, value: ChatFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const setError = (field: keyof FormErrors, message: string) => {
    setErrors((prev) => ({ ...prev, [field]: message }))
  }

  const validateForm = (isExistingChat: boolean): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.identifier.trim()) {
      newErrors.identifier = t('chat_deploy.errors.identifier_required')
    } else if (!IDENTIFIER_PATTERN.test(formData.identifier)) {
      newErrors.identifier = t('chat_deploy.errors.identifier_invalid')
    }

    if (!formData.title.trim()) {
      newErrors.title = t('chat_deploy.errors.title_required')
    }

    if (formData.authType === 'password' && !isExistingChat && !formData.password.trim()) {
      newErrors.password = t('chat_deploy.errors.password_required')
    }

    if (
      (formData.authType === 'email' || formData.authType === 'sso') &&
      formData.emails.length === 0
    ) {
      newErrors.emails =
        formData.authType === 'sso'
          ? t('chat_deploy.errors.emails_required_sso')
          : t('chat_deploy.errors.emails_required_email')
    }

    if (formData.selectedOutputBlocks.length === 0) {
      newErrors.outputBlocks = t('chat_deploy.errors.output_blocks_required')
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const isFormValid =
    isIdentifierValid &&
    Boolean(formData.title.trim()) &&
    formData.selectedOutputBlocks.length > 0 &&
    (formData.authType !== 'password' ||
      Boolean(formData.password.trim()) ||
      Boolean(existingChat)) &&
    ((formData.authType !== 'email' && formData.authType !== 'sso') || formData.emails.length > 0)

  useEffect(() => {
    onValidationChange?.(isFormValid)
  }, [isFormValid, onValidationChange])

  useEffect(() => {
    if (existingChat && !hasInitializedForm) {
      setFormData({
        identifier: existingChat.identifier || '',
        title: existingChat.title || '',
        description: existingChat.description || '',
        authType: existingChat.authType || 'public',
        password: '',
        emails: Array.isArray(existingChat.allowedEmails) ? [...existingChat.allowedEmails] : [],
        welcomeMessage:
          existingChat.customizations?.welcomeMessage || 'Hi there! How can I help you today?',
        selectedOutputBlocks: Array.isArray(existingChat.outputConfigs)
          ? existingChat.outputConfigs.map(
              (config: { blockId: string; path: string }) => `${config.blockId}_${config.path}`
            )
          : [],
      })

      if (existingChat.customizations?.imageUrl) {
        setImageUrl(existingChat.customizations.imageUrl)
      }

      setHasInitializedForm(true)
    } else if (!existingChat && !isLoadingChat) {
      setFormData(initialFormData)
      setImageUrl(null)
      setHasInitializedForm(false)
    }
  }, [existingChat, isLoadingChat, hasInitializedForm])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()

    if (chatSubmitting) return

    setChatSubmitting(true)

    try {
      if (!validateForm(!!existingChat)) {
        setChatSubmitting(false)
        return
      }

      if (!isIdentifierValid && formData.identifier !== existingChat?.identifier) {
        setError('identifier', 'Please wait for identifier validation to complete')
        setChatSubmitting(false)
        return
      }

      let chatUrl: string

      if (existingChat?.id) {
        const result = await updateChatMutation.mutateAsync({
          chatId: existingChat.id,
          workflowId,
          formData,
          imageUrl,
        })
        chatUrl = result.chatUrl
      } else {
        const result = await createChatMutation.mutateAsync({
          workflowId,
          formData,
          apiKey: deploymentInfo?.apiKey,
          imageUrl,
        })
        chatUrl = result.chatUrl
      }

      onDeployed?.()
      onVersionActivated?.()

      if (chatUrl) {
        window.open(chatUrl, '_blank', 'noopener,noreferrer')
      }

      setHasInitializedForm(false)
      await onRefetchChat()
    } catch (error: any) {
      if (error.message?.includes('identifier')) {
        setError('identifier', error.message)
      } else {
        setError('general', error.message)
      }
    } finally {
      setChatSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!existingChat || !existingChat.id) return

    try {
      setIsDeleting(true)

      await deleteChatMutation.mutateAsync({
        chatId: existingChat.id,
        workflowId,
      })

      setImageUrl(null)
      setHasInitializedForm(false)
      await onRefetchChat()

      onDeploymentComplete?.()
    } catch (error: any) {
      logger.error('Failed to delete chat:', error)
      setError('general', error.message || 'An unexpected error occurred while deleting')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirmation(false)
    }
  }

  if (isLoadingChat) {
    return <LoadingSkeleton />
  }

  return (
    <>
      <form
        id='chat-deploy-form'
        ref={formRef}
        onSubmit={handleSubmit}
        className='-mx-1 space-y-4 overflow-y-auto px-1'
      >
        {errors.general && (
          <Alert variant='destructive'>
            <AlertTriangle className='h-4 w-4' />
            <AlertDescription>{errors.general}</AlertDescription>
          </Alert>
        )}

        <div className='space-y-[12px]'>
          <IdentifierInput
            value={formData.identifier}
            onChange={(value) => updateField('identifier', value)}
            originalIdentifier={existingChat?.identifier || undefined}
            disabled={chatSubmitting}
            onValidationChange={setIsIdentifierValid}
            isEditingExisting={!!existingChat}
          />

          <div>
            <Label
              htmlFor='title'
              className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'
            >
              {t('chat_deploy.labels.title')}
            </Label>
            <Input
              id='title'
              placeholder={t('chat_deploy.placeholders.title')}
              value={formData.title}
              onChange={(e) => updateField('title', e.target.value)}
              required
              disabled={chatSubmitting}
            />
            {errors.title && <p className='mt-1 text-destructive text-sm'>{errors.title}</p>}
          </div>

          <div>
            <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
              {t('chat_deploy.labels.output')}
            </Label>
            <OutputSelect
              workflowId={workflowId}
              selectedOutputs={formData.selectedOutputBlocks}
              onOutputSelect={(values) => updateField('selectedOutputBlocks', values)}
              placeholder={t('chat_deploy.placeholders.output')}
              disabled={chatSubmitting}
            />
            {errors.outputBlocks && (
              <p className='mt-1 text-destructive text-sm'>{errors.outputBlocks}</p>
            )}
          </div>

          <AuthSelector
            key={existingChat?.id ?? 'new'}
            authType={formData.authType}
            password={formData.password}
            emails={formData.emails}
            onAuthTypeChange={(type) => updateField('authType', type)}
            onPasswordChange={(password) => updateField('password', password)}
            onEmailsChange={(emails) => updateField('emails', emails)}
            disabled={chatSubmitting}
            isExistingChat={!!existingChat}
            error={errors.password || errors.emails}
          />
          <div>
            <Label
              htmlFor='welcomeMessage'
              className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'
            >
              {t('chat_deploy.labels.welcome_message')}
            </Label>
            <Textarea
              id='welcomeMessage'
              placeholder={t('chat_deploy.placeholders.welcome_message')}
              value={formData.welcomeMessage}
              onChange={(e) => updateField('welcomeMessage', e.target.value)}
              rows={3}
              disabled={chatSubmitting}
              className='min-h-[80px] resize-none'
            />
            <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
              {t('chat_deploy.helper_text.welcome_message')}
            </p>
          </div>

          <button
            type='button'
            data-delete-trigger
            onClick={() => setShowDeleteConfirmation(true)}
            style={{ display: 'none' }}
          />
        </div>
      </form>

      <Modal open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <ModalContent size='sm'>
          <ModalHeader>{t('chat_deploy.modal.delete_title')}</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              {t.rich('chat_deploy.modal.delete_confirmation', {
                title: existingChat?.title || 'this chat',
              })}{' '}
              <span className='text-[var(--text-error)]'>
                {t.rich('chat_deploy.modal.delete_warning', {
                  url: `${getEmailDomain()}/chat/${existingChat?.identifier}`,
                })}
              </span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => setShowDeleteConfirmation(false)}
              disabled={isDeleting}
            >
              {t('chat_deploy.buttons.cancel')}
            </Button>
            <Button variant='destructive' onClick={handleDelete} disabled={isDeleting}>
              {isDeleting ? t('chat_deploy.buttons.deleting') : t('chat_deploy.buttons.delete')}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

function LoadingSkeleton() {
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
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[46px]' />
          <Skeleton className='h-[34px] w-full rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[95px]' />
          <Skeleton className='h-[28px] w-[170px] rounded-[4px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[115px]' />
          <Skeleton className='h-[80px] w-full rounded-[4px]' />
          <Skeleton className='mt-[6.5px] h-[14px] w-[340px]' />
        </div>
      </div>
    </div>
  )
}

interface IdentifierInputProps {
  value: string
  onChange: (value: string) => void
  originalIdentifier?: string
  disabled?: boolean
  onValidationChange?: (isValid: boolean) => void
  isEditingExisting?: boolean
}

const getDomainPrefix = (() => {
  const prefix = `${getEmailDomain()}/chat/`
  return () => prefix
})()

function IdentifierInput({
  value,
  onChange,
  originalIdentifier,
  disabled = false,
  onValidationChange,
  isEditingExisting = false,
}: IdentifierInputProps) {
  const t = useTranslations()
  const { isChecking, error, isValid } = useIdentifierValidation(
    value,
    originalIdentifier,
    isEditingExisting
  )

  useEffect(() => {
    onValidationChange?.(isValid)
  }, [isValid, onValidationChange])

  const handleChange = (newValue: string) => {
    const lowercaseValue = newValue.toLowerCase()
    onChange(lowercaseValue)
  }

  const fullUrl = `${getBaseUrl()}/chat/${value}`
  const displayUrl = fullUrl.replace(/^https?:\/\//, '')

  return (
    <div>
      <Label
        htmlFor='chat-url'
        className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'
      >
        {t('chat_deploy.labels.url')}
      </Label>
      <div
        className={cn(
          'relative flex items-stretch overflow-hidden rounded-[4px] border border-[var(--border-1)]',
          error && 'border-[var(--text-error)]'
        )}
      >
        <div className='flex items-center whitespace-nowrap bg-[var(--surface-5)] pr-[6px] pl-[8px] font-medium text-[var(--text-secondary)] text-sm dark:bg-[var(--surface-5)]'>
          {getDomainPrefix()}
        </div>
        <div className='relative flex-1'>
          <Input
            id='chat-url'
            placeholder={t('chat_deploy.placeholders.chat_url')}
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            required
            disabled={disabled}
            className={cn(
              'rounded-none border-0 pl-0 shadow-none disabled:bg-transparent disabled:opacity-100',
              (isChecking || (isValid && value)) && 'pr-[32px]'
            )}
          />
          {isChecking ? (
            <div className='-translate-y-1/2 absolute top-1/2 right-2'>
              <Loader2 className='h-4 w-4 animate-spin text-[var(--text-tertiary)]' />
            </div>
          ) : (
            isValid &&
            value &&
            value !== originalIdentifier && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div className='-translate-y-1/2 absolute top-1/2 right-2'>
                    <Check className='h-4 w-4 text-[var(--brand-tertiary-2)]' />
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>{t('chat_deploy.helper_text.name_available')}</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )
          )}
        </div>
      </div>
      {error && <p className='mt-[6.5px] text-[12px] text-[var(--text-error)]'>{error}</p>}
      <p className='mt-[6.5px] truncate text-[11px] text-[var(--text-secondary)]'>
        {isEditingExisting && value ? (
          <>
            {t('chat_deploy.helper_text.live_at')}{' '}
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
          t('chat_deploy.helper_text.url')
        )}
      </p>
    </div>
  )
}

interface AuthSelectorProps {
  authType: AuthType
  password: string
  emails: string[]
  onAuthTypeChange: (type: AuthType) => void
  onPasswordChange: (password: string) => void
  onEmailsChange: (emails: string[]) => void
  disabled?: boolean
  isExistingChat?: boolean
  error?: string
}

const AUTH_LABELS: Record<AuthType, string> = {
  public: 'Public',
  password: 'Password',
  email: 'Email',
  sso: 'SSO',
}

function AuthSelector({
  authType,
  password,
  emails,
  onAuthTypeChange,
  onPasswordChange,
  onEmailsChange,
  disabled = false,
  isExistingChat = false,
  error,
}: AuthSelectorProps) {
  const t = useTranslations()
  const [showPassword, setShowPassword] = useState(false)
  const [emailError, setEmailError] = useState('')
  const [copySuccess, setCopySuccess] = useState(false)
  const [emailItems, setEmailItems] = useState<TagItem[]>(() =>
    emails.map((email) => ({ value: email, isValid: true }))
  )

  const handleGeneratePassword = () => {
    const newPassword = generatePassword(24)
    onPasswordChange(newPassword)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  const addEmail = (email: string): boolean => {
    if (!email.trim()) return false

    const normalized = email.trim().toLowerCase()
    const isDomainPattern = normalized.startsWith('@')
    const validation = quickValidateEmail(normalized)
    const isValid = validation.isValid || isDomainPattern

    if (emailItems.some((item) => item.value === normalized)) {
      return false
    }

    setEmailItems((prev) => [...prev, { value: normalized, isValid }])

    if (isValid) {
      setEmailError('')
      onEmailsChange([...emails, normalized])
    }

    return isValid
  }

  const handleRemoveEmailItem = (_value: string, index: number, isValid: boolean) => {
    const itemToRemove = emailItems[index]
    setEmailItems((prev) => prev.filter((_, i) => i !== index))
    if (isValid && itemToRemove) {
      onEmailsChange(emails.filter((e) => e !== itemToRemove.value))
    }
  }

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const authOptions = ssoEnabled
    ? (['public', 'password', 'email', 'sso'] as const)
    : (['public', 'password', 'email'] as const)

  return (
    <div className='space-y-[16px]'>
      <div>
        <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
          {t('chat_deploy.labels.access_control')}
        </Label>
        <ButtonGroup
          value={authType}
          onValueChange={(val) => onAuthTypeChange(val as AuthType)}
          disabled={disabled}
        >
          {authOptions.map((type) => (
            <ButtonGroupItem key={type} value={type}>
              {t(`chat_deploy.buttons.${type}`)}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      {authType === 'password' && (
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            {t('chat_deploy.labels.password')}
          </Label>
          <div className='relative'>
            <Input
              type={showPassword ? 'text' : 'password'}
              placeholder={
                isExistingChat
                  ? t('chat_deploy.placeholders.password_existing')
                  : t('chat_deploy.placeholders.password')
              }
              value={password}
              onChange={(e) => onPasswordChange(e.target.value)}
              disabled={disabled}
              className='pr-[88px]'
              required={!isExistingChat}
              autoComplete='new-password'
            />
            <div className='-translate-y-1/2 absolute top-1/2 right-[4px] flex items-center'>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={handleGeneratePassword}
                    disabled={disabled}
                    aria-label={t('chat_deploy.aria.generate_password')}
                    className='!p-1.5'
                  >
                    <RefreshCw className='h-3 w-3' />
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>{t('chat_deploy.buttons.generate')}</span>
                </Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={() => copyToClipboard(password)}
                    disabled={!password || disabled}
                    aria-label={t('chat_deploy.aria.copy_password')}
                    className='!p-1.5'
                  >
                    {copySuccess ? (
                      <Check className='h-3 w-3' />
                    ) : (
                      <Clipboard className='h-3 w-3' />
                    )}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>
                    {copySuccess ? t('chat_deploy.buttons.copied') : t('chat_deploy.buttons.copy')}
                  </span>
                </Tooltip.Content>
              </Tooltip.Root>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    onClick={() => setShowPassword(!showPassword)}
                    disabled={disabled}
                    aria-label={
                      showPassword
                        ? t('chat_deploy.aria.hide_password')
                        : t('chat_deploy.aria.show_password')
                    }
                    className='!p-1.5'
                  >
                    {showPassword ? <EyeOff className='h-3 w-3' /> : <Eye className='h-3 w-3' />}
                  </Button>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>
                    {showPassword ? t('chat_deploy.buttons.hide') : t('chat_deploy.buttons.show')}
                  </span>
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
          </div>
          <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
            {isExistingChat
              ? t('chat_deploy.helper_text.password_existing')
              : t('chat_deploy.helper_text.password')}
          </p>
        </div>
      )}

      {(authType === 'email' || authType === 'sso') && (
        <div>
          <Label className='mb-[6.5px] block pl-[2px] font-medium text-[13px] text-[var(--text-primary)]'>
            {authType === 'email'
              ? t('chat_deploy.labels.allowed_emails')
              : t('chat_deploy.labels.allowed_sso_emails')}
          </Label>
          <TagInput
            items={emailItems}
            onAdd={(value) => addEmail(value)}
            onRemove={handleRemoveEmailItem}
            placeholder={t('chat_deploy.placeholders.emails')}
            placeholderWithTags={t('chat_deploy.placeholders.emails_additional')}
            disabled={disabled}
          />
          {emailError && (
            <p className='mt-[6.5px] text-[12px] text-[var(--text-error)]'>{emailError}</p>
          )}
          <p className='mt-[6.5px] text-[11px] text-[var(--text-secondary)]'>
            {authType === 'email'
              ? t('chat_deploy.helper_text.emails')
              : t('chat_deploy.helper_text.sso_emails')}
          </p>
        </div>
      )}

      {error && <p className='mt-[6.5px] text-[12px] text-[var(--text-error)]'>{error}</p>}
    </div>
  )
}
