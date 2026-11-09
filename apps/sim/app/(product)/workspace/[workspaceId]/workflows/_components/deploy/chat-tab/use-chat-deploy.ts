'use client'

import { useState } from 'react'
import { useFeedbackExpiry } from '@sim/emcn/feedback/use-feedback-expiry'
import { getErrorMessage } from '@sim/utils/errors'
import {
  type AuthType,
  buildChatDeploymentUrl,
  type ChatDetail,
  type ChatFormData,
  formatInternalOutputSelector,
  hasExistingPassword,
  isPasswordRequired,
  isWhitespaceOnlyPassword,
  shouldConfirmPasswordChange,
  useCreateChat,
  useDeleteChat,
  useIdentifierValidation,
  useUpdateChat,
} from '@/platform/lib/data/workflow-deploy'
import {
  createLogger,
  useDeploymentShape,
  usePermissionConfig,
} from '@/platform/lib/data/workflows'

const logger = createLogger('ChatDeploy')

const IDENTIFIER_PATTERN = /^[a-z0-9-]+$/
const DEFAULT_WELCOME_MESSAGE = 'Hi there! How can I help you today?'

const INITIAL_FORM: ChatFormData = {
  identifier: '',
  title: '',
  description: '',
  authType: 'public',
  password: '',
  emails: [],
  welcomeMessage: DEFAULT_WELCOME_MESSAGE,
  selectedOutputBlocks: [],
  includeThinking: false,
  includeToolCalls: false,
}

/** Every access mode in its display order. */
const AUTH_TYPES: readonly AuthType[] = ['public', 'password', 'email', 'sso']

interface ChatFormErrors {
  identifier?: string
  title?: string
  password?: string
  emails?: string
  outputBlocks?: string
  general?: string
}

interface UseChatDeployOptions {
  workflowId: string
  existingChat: ChatDetail | null
  isLoadingChat: boolean
  refetchChat: () => Promise<unknown>
  /** A chat launched or updated: the deployment's own reads go stale. */
  onDeployed: () => void
  /** A chat deleted: the dialog closes, as legacy's does. */
  onDeleted: () => void
}

function formFromChat(chat: ChatDetail): ChatFormData {
  return {
    identifier: chat.identifier || '',
    title: chat.title || '',
    description: chat.description || '',
    authType: chat.authType || 'public',
    password: '',
    emails: Array.isArray(chat.allowedEmails) ? [...chat.allowedEmails] : [],
    welcomeMessage: chat.customizations?.welcomeMessage || DEFAULT_WELCOME_MESSAGE,
    selectedOutputBlocks: Array.isArray(chat.outputConfigs)
      ? chat.outputConfigs.map((config) =>
          formatInternalOutputSelector(config.blockId, config.path)
        )
      : [],
    includeThinking: chat.includeThinking ?? false,
    includeToolCalls: chat.includeToolCalls ?? false,
  }
}

/**
 * The chat deployment form: identifier availability, title, outputs, streamed thinking and tool
 * calls, access control (public, password, email or SSO allowlists, as policy allows) and the
 * welcome message, with legacy's validation, password-change confirmation, launch in a new tab and
 * delete.
 */
export function useChatDeploy({
  workflowId,
  existingChat,
  isLoadingChat,
  refetchChat,
  onDeployed,
  onDeleted,
}: UseChatDeployOptions) {
  const { features } = useDeploymentShape()
  const { config: permissionConfig } = usePermissionConfig()
  const [form, setForm] = useState<ChatFormData>(INITIAL_FORM)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [errors, setErrors] = useState<ChatFormErrors>({})
  const [submitting, setSubmitting] = useState(false)
  const [succeededAt, setSucceededAt] = useState<number | null>(null)
  const [confirmingPassword, setConfirmingPassword] = useState(false)
  const [confirmingDelete, setConfirmingDelete] = useState(false)
  const [needsSeed, setNeedsSeed] = useState(true)
  const createChat = useCreateChat()
  const updateChat = useUpdateChat()
  const deleteChat = useDeleteChat()
  useFeedbackExpiry(succeededAt, () => setSucceededAt(null))

  // The form seeds once the saved chat is read, and again after a save or delete re-reads it, so a
  // background refetch never overwrites an edit in progress.
  if (needsSeed && !isLoadingChat) {
    setNeedsSeed(false)
    setForm(existingChat ? formFromChat(existingChat) : INITIAL_FORM)
    setImageUrl(existingChat?.customizations?.imageUrl ?? null)
  }

  const existingPassword = hasExistingPassword(existingChat)
  const identifier = useIdentifierValidation(
    form.identifier,
    existingChat?.identifier || undefined,
    Boolean(existingChat)
  )

  const allowedAuthTypes = permissionConfig.allowedChatDeployAuthTypes
  const savedAuthType = existingChat?.authType
  const ssoAvailable =
    features.sso || savedAuthType === 'sso' || (allowedAuthTypes?.includes('sso') ?? false)
  const authOptions = AUTH_TYPES.filter(
    (type) =>
      (type !== 'sso' || ssoAvailable) &&
      (allowedAuthTypes === null || allowedAuthTypes.includes(type) || type === savedAuthType)
  )

  // A mode the policy no longer allows falls back to the first one it does.
  if (authOptions.length > 0 && !authOptions.includes(form.authType))
    setForm({ ...form, authType: authOptions[0] })

  const update = <K extends keyof ChatFormData>(field: K, value: ChatFormData[K]) => {
    setForm((current) => ({ ...current, [field]: value }))
    const errorField = field === 'selectedOutputBlocks' ? 'outputBlocks' : field
    if (errorField in errors)
      setErrors((current) => ({ ...current, [errorField]: undefined, general: undefined }))
  }

  const validate = (): boolean => {
    const next: ChatFormErrors = {}
    if (!form.identifier.trim()) next.identifier = 'Identifier is required'
    else if (!IDENTIFIER_PATTERN.test(form.identifier))
      next.identifier = 'Identifier can only contain lowercase letters, numbers, and hyphens'
    if (!form.title.trim()) next.title = 'Title is required'
    if (isPasswordRequired(form.authType, form.password, existingPassword))
      next.password = 'Password is required when using password protection'
    else if (form.authType === 'password' && isWhitespaceOnlyPassword(form.password))
      next.password = 'Password cannot contain only whitespace'
    if ((form.authType === 'email' || form.authType === 'sso') && form.emails.length === 0)
      next.emails = `At least one email or domain is required when using ${form.authType === 'sso' ? 'SSO' : 'email'} access control`
    if (form.selectedOutputBlocks.length === 0)
      next.outputBlocks = 'Please select at least one output block'
    setErrors(next)
    return Object.keys(next).length === 0
  }

  const isValid =
    identifier.isValid &&
    Boolean(form.title.trim()) &&
    form.selectedOutputBlocks.length > 0 &&
    !isPasswordRequired(form.authType, form.password, existingPassword) &&
    (form.authType !== 'password' || !isWhitespaceOnlyPassword(form.password)) &&
    ((form.authType !== 'email' && form.authType !== 'sso') || form.emails.length > 0)

  /** Saves the chat. A new chat opens in a tab claimed during the click, so no blocker stops it. */
  const submit = async (passwordChangeConfirmed = false) => {
    if (submitting) return
    const isNew = !existingChat?.id
    const tab = isNew ? window.open('', '_blank') : null
    setSubmitting(true)
    try {
      if (!validate()) {
        tab?.close()
        return
      }
      if (!identifier.isValid && form.identifier !== existingChat?.identifier) {
        tab?.close()
        setErrors((current) => ({
          ...current,
          identifier: 'Please wait for identifier validation to complete',
        }))
        return
      }
      if (
        !passwordChangeConfirmed &&
        shouldConfirmPasswordChange(existingPassword, form.authType, form.password)
      ) {
        setConfirmingPassword(true)
        return
      }
      const result = existingChat?.id
        ? await updateChat.mutateAsync({
            chatId: existingChat.id,
            workflowId,
            formData: form,
            imageUrl,
          })
        : await createChat.mutateAsync({ workflowId, formData: form, imageUrl })
      onDeployed()
      setSucceededAt(Date.now())
      if (tab && result.chatUrl) {
        tab.opener = null
        tab.location.href = result.chatUrl
      } else tab?.close()
      await refetchChat()
      setNeedsSeed(true)
    } catch (error) {
      const message = getErrorMessage(error)
      tab?.close()
      if (message.includes('identifier'))
        setErrors((current) => ({ ...current, identifier: message }))
      else setErrors((current) => ({ ...current, general: message }))
    } finally {
      setSubmitting(false)
    }
  }

  const remove = async () => {
    if (!existingChat?.id) return
    try {
      await deleteChat.mutateAsync({ chatId: existingChat.id, workflowId })
      await refetchChat()
      setNeedsSeed(true)
      onDeleted()
    } catch (error) {
      logger.error('Failed to delete chat', { error })
      throw new Error(getErrorMessage(error) || 'An unexpected error occurred while deleting')
    }
  }

  const chatExists = Boolean(existingChat)
  const actionLabel = succeededAt
    ? chatExists
      ? 'Updated'
      : 'Launched'
    : submitting
      ? chatExists
        ? 'Updating…'
        : 'Launching…'
      : chatExists
        ? 'Update'
        : 'Launch chat'

  return {
    form,
    update,
    errors,
    identifier,
    authOptions,
    existingPassword,
    isValid,
    submitting,
    actionLabel,
    chatExists,
    chatId: existingChat?.id ?? null,
    liveUrl: existingChat
      ? buildChatDeploymentUrl(existingChat.identifier).replace(/^https?:\/\//, '')
      : null,
    originalIdentifier: existingChat?.identifier || undefined,
    submit,
    remove,
    deleting: deleteChat.isPending,
    confirmingPassword,
    setConfirmingPassword,
    confirmingDelete,
    setConfirmingDelete,
  }
}

export type ChatDeployForm = ReturnType<typeof useChatDeploy>
