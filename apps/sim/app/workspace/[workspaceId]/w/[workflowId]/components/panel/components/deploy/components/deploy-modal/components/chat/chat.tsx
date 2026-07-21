'use client'

import { useEffect, useRef, useState } from 'react'
import {
  ButtonGroup,
  ButtonGroupItem,
  ChipConfirmModal,
  ChipInput,
  cn,
  Input,
  Label,
  Loader,
  Skeleton,
  TagInput,
  type TagItem,
  Textarea,
  Tooltip,
} from '@sim/emcn'
import { createLogger } from '@sim/logger'
import { getErrorMessage } from '@sim/utils/errors'
import { normalizeEmail } from '@sim/utils/string'
import { AlertTriangle, Check } from 'lucide-react'
import { GeneratedPasswordInput } from '@/components/ui'
import { getEnv, isTruthy } from '@/lib/core/config/env'
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
import type { ChatDetail } from '@/hooks/queries/deployments'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { useIdentifierValidation } from './hooks'
import {
  getPasswordHelperText,
  getPasswordPlaceholder,
  hasExistingPassword,
  isPasswordRequired,
} from './utils'

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

export type ExistingChat = ChatDetail

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
  const [imageUrl, setImageUrl] = useState<string | null>(null)
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
  const [formInitCounter, setFormInitCounter] = useState(0)

  const createChatMutation = useCreateChat()
  const updateChatMutation = useUpdateChat()
  const deleteChatMutation = useDeleteChat()
  const [isIdentifierValid, setIsIdentifierValid] = useState(false)
  const hasInitializedFormRef = useRef(false)
  const existingPassword = hasExistingPassword(existingChat)

  const updateField = <K extends keyof ChatFormData>(field: K, value: ChatFormData[K]) => {
    setFormData((prev) => ({ ...prev, [field]: value }))
    if (errors[field as keyof FormErrors]) {
      setErrors((prev) => ({ ...prev, [field]: undefined }))
    }
  }

  const setError = (field: keyof FormErrors, message: string) => {
    setErrors((prev) => ({ ...prev, [field]: message }))
  }

  const validateForm = (): boolean => {
    const newErrors: FormErrors = {}

    if (!formData.identifier.trim()) {
      newErrors.identifier = 'Identifier is required'
    } else if (!IDENTIFIER_PATTERN.test(formData.identifier)) {
      newErrors.identifier = 'Identifier can only contain lowercase letters, numbers, and hyphens'
    }

    if (!formData.title.trim()) {
      newErrors.title = 'Title is required'
    }

    if (isPasswordRequired(formData.authType, formData.password, existingPassword)) {
      newErrors.password = 'Password is required when using password protection'
    }

    if (
      (formData.authType === 'email' || formData.authType === 'sso') &&
      formData.emails.length === 0
    ) {
      newErrors.emails = `At least one email or domain is required when using ${formData.authType === 'sso' ? 'SSO' : 'email'} access control`
    }

    if (formData.selectedOutputBlocks.length === 0) {
      newErrors.outputBlocks = 'Please select at least one output block'
    }

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const isFormValid =
    isIdentifierValid &&
    Boolean(formData.title.trim()) &&
    formData.selectedOutputBlocks.length > 0 &&
    !isPasswordRequired(formData.authType, formData.password, existingPassword) &&
    ((formData.authType !== 'email' && formData.authType !== 'sso') || formData.emails.length > 0)

  useEffect(() => {
    onValidationChange?.(isFormValid)
  }, [isFormValid, onValidationChange])

  useEffect(() => {
    if (existingChat && !hasInitializedFormRef.current) {
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

      hasInitializedFormRef.current = true
    } else if (!existingChat && !isLoadingChat) {
      setFormData(initialFormData)
      setImageUrl(null)
      hasInitializedFormRef.current = false
    }
  }, [existingChat, isLoadingChat])

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()

    if (chatSubmitting) return

    setChatSubmitting(true)

    const isNewChat = !existingChat?.id

    const newTab = isNewChat ? window.open('', '_blank') : null

    try {
      if (!validateForm()) {
        newTab?.close()
        setChatSubmitting(false)
        return
      }

      if (!isIdentifierValid && formData.identifier !== existingChat?.identifier) {
        newTab?.close()
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
          imageUrl,
        })
        chatUrl = result.chatUrl
      }

      onDeployed?.()
      onVersionActivated?.()

      if (newTab && chatUrl) {
        newTab.opener = null
        newTab.location.href = chatUrl
      } else if (newTab) {
        newTab.close()
      }

      hasInitializedFormRef.current = false
      await onRefetchChat()
      setFormInitCounter((c) => c + 1)
    } catch (error: unknown) {
      const message = getErrorMessage(error)
      newTab?.close()
      if (message.includes('identifier')) {
        setError('identifier', message)
      } else {
        setError('general', message)
      }
    } finally {
      setChatSubmitting(false)
    }
  }

  const handleDelete = async () => {
    if (!existingChat || !existingChat.id) return

    try {
      await deleteChatMutation.mutateAsync({
        chatId: existingChat.id,
        workflowId,
      })

      setImageUrl(null)
      hasInitializedFormRef.current = false
      setFormInitCounter((c) => c + 1)
      await onRefetchChat()

      onDeploymentComplete?.()
    } catch (error: unknown) {
      logger.error('Failed to delete chat:', error)
      setError('general', getErrorMessage(error) || 'An unexpected error occurred while deleting')
    } finally {
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
          <div className='flex items-center gap-2 rounded-md border border-[color-mix(in_srgb,var(--text-error)_20%,transparent)] bg-[color-mix(in_srgb,var(--text-error)_10%,transparent)] px-3 py-2 text-[var(--text-error)] text-small'>
            <AlertTriangle className='size-4 flex-shrink-0' />
            <span>{errors.general}</span>
          </div>
        )}

        <div className='space-y-3'>
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
              className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'
            >
              Title
            </Label>
            <ChipInput
              id='title'
              placeholder='Customer Support Assistant'
              value={formData.title}
              onChange={(e) => updateField('title', e.target.value)}
              required
              disabled={chatSubmitting}
            />
            {errors.title && (
              <p className='mt-[6.5px] text-[var(--text-error)] text-caption'>{errors.title}</p>
            )}
          </div>

          <div>
            <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
              Output
            </Label>
            <OutputSelect
              workflowId={workflowId}
              selectedOutputs={formData.selectedOutputBlocks}
              onOutputSelect={(values) => updateField('selectedOutputBlocks', values)}
              placeholder='Select which block outputs to use'
              disabled={chatSubmitting}
              className='w-full'
            />
            {errors.outputBlocks && (
              <p className='mt-[6.5px] text-[var(--text-error)] text-caption'>
                {errors.outputBlocks}
              </p>
            )}
          </div>

          <AuthSelector
            key={`${existingChat?.id ?? 'new'}-${formInitCounter}`}
            authType={formData.authType}
            savedAuthType={existingChat?.authType as AuthType | undefined}
            password={formData.password}
            emails={formData.emails}
            onAuthTypeChange={(type) => updateField('authType', type)}
            onPasswordChange={(password) => updateField('password', password)}
            onEmailsChange={(emails) => updateField('emails', emails)}
            disabled={chatSubmitting}
            hasExistingPassword={existingPassword}
            error={errors.password || errors.emails}
          />
          <div>
            <Label
              htmlFor='welcomeMessage'
              className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'
            >
              Welcome message
            </Label>
            <Textarea
              id='welcomeMessage'
              placeholder='Enter a welcome message for your chat'
              value={formData.welcomeMessage}
              onChange={(e) => updateField('welcomeMessage', e.target.value)}
              rows={3}
              disabled={chatSubmitting}
              className='min-h-[80px] resize-none'
            />
            <p className='mt-[6.5px] text-[var(--text-secondary)] text-xs'>
              This message will be displayed when users first open the chat
            </p>
          </div>

          <button
            type='button'
            data-delete-trigger
            onClick={() => setShowDeleteConfirmation(true)}
            className='hidden'
          />
        </div>
      </form>

      <ChipConfirmModal
        open={showDeleteConfirmation}
        onOpenChange={setShowDeleteConfirmation}
        srTitle='Delete Chat'
        title='Delete Chat'
        text={[
          'Are you sure you want to delete ',
          { text: existingChat?.title || 'this chat', bold: true },
          '? ',
          {
            text: `This will remove the chat at "${getEmailDomain()}/chat/${existingChat?.identifier ?? ''}" and make it unavailable to all users.`,
            error: true,
          },
          ' This action cannot be undone.',
        ]}
        confirm={{
          label: 'Delete',
          onClick: handleDelete,
          pending: deleteChatMutation.isPending,
          pendingLabel: 'Deleting...',
        }}
      />
    </>
  )
}

function LoadingSkeleton() {
  return (
    <div className='-mx-1 space-y-4 px-1'>
      <div className='space-y-3'>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[26px]' />
          <Skeleton className='h-[34px] w-full rounded-sm' />
          <Skeleton className='mt-[6.5px] h-[14px] w-[320px]' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[30px]' />
          <Skeleton className='h-[34px] w-full rounded-sm' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[46px]' />
          <Skeleton className='h-[34px] w-full rounded-sm' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[95px]' />
          <Skeleton className='h-[28px] w-[170px] rounded-sm' />
        </div>
        <div>
          <Skeleton className='mb-[6.5px] h-[16px] w-[115px]' />
          <Skeleton className='h-[80px] w-full rounded-sm' />
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
        className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'
      >
        URL
      </Label>
      <div
        className={cn(
          'relative flex items-stretch overflow-hidden rounded-sm border border-[var(--border-1)] bg-[var(--surface-5)]',
          error && 'border-[var(--text-error)]'
        )}
      >
        <div className='flex items-center whitespace-nowrap bg-[var(--surface-5)] pr-1.5 pl-2 font-medium text-[var(--text-secondary)] text-sm'>
          {getDomainPrefix()}
        </div>
        <div className='relative flex-1'>
          <Input
            id='chat-url'
            placeholder='my-chat'
            value={value}
            onChange={(e) => handleChange(e.target.value)}
            required
            disabled={disabled}
            className={cn(
              'rounded-none border-0 bg-transparent pl-0 shadow-none disabled:bg-transparent disabled:opacity-100',
              (isChecking || (isValid && value)) && 'pr-8'
            )}
          />
          {isChecking ? (
            <div className='-translate-y-1/2 absolute top-1/2 right-2'>
              <Loader className='size-4 text-[var(--text-tertiary)]' animate />
            </div>
          ) : (
            isValid &&
            value &&
            value !== originalIdentifier && (
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <div className='-translate-y-1/2 absolute top-1/2 right-2'>
                    <Check className='size-4 text-[var(--brand-accent)]' />
                  </div>
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <span>Name is available</span>
                </Tooltip.Content>
              </Tooltip.Root>
            )
          )}
        </div>
      </div>
      {error && <p className='mt-[6.5px] text-[var(--text-error)] text-caption'>{error}</p>}
      <p className='mt-[6.5px] truncate text-[var(--text-secondary)] text-xs'>
        {isEditingExisting && value ? (
          <>
            Live at:{' '}
            <a
              href={fullUrl}
              target='_blank'
              rel='noopener noreferrer'
              className='text-[var(--text-primary)] hover-hover:underline'
            >
              {displayUrl}
            </a>
          </>
        ) : (
          'The unique URL path where your chat will be accessible'
        )}
      </p>
    </div>
  )
}

interface AuthSelectorProps {
  authType: AuthType
  /** The persisted mode of an existing chat, kept selectable even if newly disallowed. */
  savedAuthType?: AuthType
  password: string
  emails: string[]
  onAuthTypeChange: (type: AuthType) => void
  onPasswordChange: (password: string) => void
  onEmailsChange: (emails: string[]) => void
  disabled?: boolean
  hasExistingPassword?: boolean
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
  savedAuthType,
  password,
  emails,
  onAuthTypeChange,
  onPasswordChange,
  onEmailsChange,
  disabled = false,
  hasExistingPassword = false,
  error,
}: AuthSelectorProps) {
  const [emailError, setEmailError] = useState('')
  const [invalidEmailItems, setInvalidEmailItems] = useState<TagItem[]>([])

  const emailsRef = useRef(emails)
  const invalidEmailItemsRef = useRef(invalidEmailItems)

  useEffect(() => {
    emailsRef.current = emails
  }, [emails])

  const addEmail = (email: string): boolean => {
    if (!email.trim()) return false

    const normalized = normalizeEmail(email)
    const isDomainPattern = normalized.startsWith('@')
    const validation = quickValidateEmail(normalized)
    const isValid = validation.isValid || isDomainPattern

    if (
      emailsRef.current.includes(normalized) ||
      invalidEmailItemsRef.current.some((item) => item.value === normalized)
    ) {
      return false
    }

    if (isValid) {
      setEmailError('')
      emailsRef.current = [...emailsRef.current, normalized]
      onEmailsChange(emailsRef.current)
    } else {
      invalidEmailItemsRef.current = [
        ...invalidEmailItemsRef.current,
        { value: normalized, isValid, error: validation.reason ?? 'Invalid email format' },
      ]
      setInvalidEmailItems(invalidEmailItemsRef.current)
    }

    return isValid
  }

  const emailItems = [
    ...emails.map((email) => ({ value: email, isValid: true })),
    ...invalidEmailItems,
  ]

  const handleRemoveEmailItem = (_value: string, index: number) => {
    const itemToRemove = emailItems[index]
    if (!itemToRemove) return

    if (itemToRemove.isValid) {
      emailsRef.current = emailsRef.current.filter((e) => e !== itemToRemove.value)
      onEmailsChange(emailsRef.current)
    } else {
      invalidEmailItemsRef.current = invalidEmailItemsRef.current.filter(
        (item) => item.value !== itemToRemove.value
      )
      setInvalidEmailItems(invalidEmailItemsRef.current)
    }
  }

  const { config: permissionConfig } = usePermissionConfig()

  const ssoEnabled = isTruthy(getEnv('NEXT_PUBLIC_SSO_ENABLED'))
  const baseAuthOptions: AuthType[] = ssoEnabled
    ? ['public', 'password', 'email', 'sso']
    : ['public', 'password', 'email']

  // Org access-control may restrict which auth modes are allowed (`null` = all).
  // The route is the source of truth; this just hides disallowed options. Only a
  // chat's already-saved mode is grandfathered (kept visible) — not the unsaved
  // `public` default of a brand-new chat.
  const allowedAuthTypes = permissionConfig.allowedChatDeployAuthTypes
  const authOptions = baseAuthOptions.filter(
    (type) => allowedAuthTypes === null || allowedAuthTypes.includes(type) || type === savedAuthType
  )

  // If the current selection isn't offered (e.g. a new chat defaulting to a
  // now-disallowed `public`), snap to the first allowed mode so the form can't
  // submit a value the server will reject.
  useEffect(() => {
    if (authOptions.length > 0 && !authOptions.includes(authType)) {
      onAuthTypeChange(authOptions[0])
    }
  }, [authOptions, authType, onAuthTypeChange])

  return (
    <div className='space-y-4'>
      <div>
        <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
          Access control
        </Label>
        <ButtonGroup
          value={authType}
          onValueChange={(val) => onAuthTypeChange(val as AuthType)}
          disabled={disabled}
        >
          {authOptions.map((type) => (
            <ButtonGroupItem key={type} value={type}>
              {AUTH_LABELS[type]}
            </ButtonGroupItem>
          ))}
        </ButtonGroup>
      </div>

      {authType === 'password' && (
        <div>
          <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
            Password
          </Label>
          <GeneratedPasswordInput
            value={password}
            onChange={onPasswordChange}
            disabled={disabled}
            placeholder={getPasswordPlaceholder(hasExistingPassword)}
            required={!hasExistingPassword}
          />
          <p className='mt-[6.5px] text-[var(--text-secondary)] text-xs'>
            {getPasswordHelperText(hasExistingPassword)}
          </p>
        </div>
      )}

      {(authType === 'email' || authType === 'sso') && (
        <div>
          <Label className='mb-[6.5px] block pl-0.5 font-medium text-[var(--text-primary)] text-small'>
            {authType === 'email' ? 'Allowed emails' : 'Allowed SSO emails'}
          </Label>
          <TagInput
            items={emailItems}
            onAdd={(value) => addEmail(value)}
            onRemove={handleRemoveEmailItem}
            placeholder='Enter emails or domains (@example.com)'
            placeholderWithTags='Add email'
            disabled={disabled}
          />
          {emailError && (
            <p className='mt-[6.5px] text-[var(--text-error)] text-caption'>{emailError}</p>
          )}
          <p className='mt-[6.5px] text-[var(--text-secondary)] text-xs'>
            {authType === 'email'
              ? 'Add specific emails or entire domains (@example.com)'
              : 'Add emails or domains that can access via SSO'}
          </p>
        </div>
      )}

      {error && <p className='mt-[6.5px] text-[var(--text-error)] text-caption'>{error}</p>}
    </div>
  )
}
