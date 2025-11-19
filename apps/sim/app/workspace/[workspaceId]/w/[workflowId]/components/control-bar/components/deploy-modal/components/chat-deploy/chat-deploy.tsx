'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, Loader2 } from 'lucide-react'
import {
  Button,
  Input,
  Label,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
  Textarea,
} from '@/components/emcn'
import { Alert, AlertDescription, Card, CardContent, Skeleton } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { getEmailDomain } from '@/lib/urls/utils'
import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/chat/components/output-select/output-select'
import { AuthSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/components/auth-selector'
import { IdentifierInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/components/identifier-input'
import { SuccessView } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/components/success-view'
import { useChatDeployment } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/hooks/use-chat-deployment'
import { useChatForm } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/hooks/use-chat-form'

const logger = createLogger('ChatDeploy')

interface ChatDeployProps {
  workflowId: string
  deploymentInfo: {
    apiKey: string
  } | null
  onChatExistsChange?: (exists: boolean) => void
  chatSubmitting: boolean
  setChatSubmitting: (submitting: boolean) => void
  onValidationChange?: (isValid: boolean) => void
  showDeleteConfirmation?: boolean
  setShowDeleteConfirmation?: (show: boolean) => void
  onDeploymentComplete?: () => void
  onDeployed?: () => void
  onUndeploy?: () => Promise<void>
  onVersionActivated?: () => void
}

interface ExistingChat {
  id: string
  identifier: string
  title: string
  description: string
  authType: 'public' | 'password' | 'email'
  allowedEmails: string[]
  outputConfigs: Array<{ blockId: string; path: string }>
  customizations?: {
    welcomeMessage?: string
  }
  isActive: boolean
}

export function ChatDeploy({
  workflowId,
  deploymentInfo,
  onChatExistsChange,
  chatSubmitting,
  setChatSubmitting,
  onValidationChange,
  showDeleteConfirmation: externalShowDeleteConfirmation,
  setShowDeleteConfirmation: externalSetShowDeleteConfirmation,
  onDeploymentComplete,
  onDeployed,
  onUndeploy,
  onVersionActivated,
}: ChatDeployProps) {
  const [isLoading, setIsLoading] = useState(false)
  const [existingChat, setExistingChat] = useState<ExistingChat | null>(null)
  const [imageUrl, setImageUrl] = useState<string | null>(null)
  const [imageUploadError, setImageUploadError] = useState<string | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isImageUploading, setIsImageUploading] = useState(false)
  const [internalShowDeleteConfirmation, setInternalShowDeleteConfirmation] = useState(false)
  const [showSuccessView, setShowSuccessView] = useState(false)

  // Use external state for delete confirmation if provided
  const showDeleteConfirmation =
    externalShowDeleteConfirmation !== undefined
      ? externalShowDeleteConfirmation
      : internalShowDeleteConfirmation

  const setShowDeleteConfirmation =
    externalSetShowDeleteConfirmation || setInternalShowDeleteConfirmation

  const { formData, errors, updateField, setError, validateForm, setFormData } = useChatForm()
  const { deployedUrl, deployChat } = useChatDeployment()
  const formRef = useRef<HTMLFormElement>(null)
  const [isIdentifierValid, setIsIdentifierValid] = useState(false)

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
    if (workflowId) {
      fetchExistingChat()
    }
  }, [workflowId])

  const fetchExistingChat = async () => {
    try {
      setIsLoading(true)
      const response = await fetch(`/api/workflows/${workflowId}/chat/status`)

      if (response.ok) {
        const data = await response.json()

        if (data.isDeployed && data.deployment) {
          const detailResponse = await fetch(`/api/chat/manage/${data.deployment.id}`)

          if (detailResponse.ok) {
            const chatDetail = await detailResponse.json()
            setExistingChat(chatDetail)

            setFormData({
              identifier: chatDetail.identifier || '',
              title: chatDetail.title || '',
              description: chatDetail.description || '',
              authType: chatDetail.authType || 'public',
              password: '',
              emails: Array.isArray(chatDetail.allowedEmails) ? [...chatDetail.allowedEmails] : [],
              welcomeMessage:
                chatDetail.customizations?.welcomeMessage || 'Hi there! How can I help you today?',
              selectedOutputBlocks: Array.isArray(chatDetail.outputConfigs)
                ? chatDetail.outputConfigs.map(
                    (config: { blockId: string; path: string }) =>
                      `${config.blockId}_${config.path}`
                  )
                : [],
            })

            if (chatDetail.customizations?.imageUrl) {
              setImageUrl(chatDetail.customizations.imageUrl)
            }
            setImageUploadError(null)

            onChatExistsChange?.(true)
          }
        } else {
          setExistingChat(null)
          setImageUrl(null)
          setImageUploadError(null)
          onChatExistsChange?.(false)
        }
      }
    } catch (error) {
      logger.error('Error fetching chat status:', error)
    } finally {
      setIsLoading(false)
    }
  }

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault()

    if (chatSubmitting) return

    setChatSubmitting(true)

    try {
      if (!validateForm()) {
        setChatSubmitting(false)
        return
      }

      if (!isIdentifierValid && formData.identifier !== existingChat?.identifier) {
        setError('identifier', 'Please wait for identifier validation to complete')
        setChatSubmitting(false)
        return
      }

      await deployChat(workflowId, formData, null, existingChat?.id, imageUrl)

      onChatExistsChange?.(true)
      setShowSuccessView(true)
      onDeployed?.()
      onVersionActivated?.()

      await fetchExistingChat()
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

      const response = await fetch(`/api/chat/manage/${existingChat.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete chat')
      }

      if (onUndeploy) {
        await onUndeploy()
      }

      setExistingChat(null)
      setImageUrl(null)
      setImageUploadError(null)
      onChatExistsChange?.(false)

      onDeploymentComplete?.()
    } catch (error: any) {
      logger.error('Failed to delete chat:', error)
      setError('general', error.message || 'An unexpected error occurred while deleting')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirmation(false)
    }
  }

  if (isLoading) {
    return <LoadingSkeleton />
  }

  if (deployedUrl && showSuccessView) {
    return (
      <>
        <div id='chat-deploy-form'>
          <SuccessView
            deployedUrl={deployedUrl}
            existingChat={existingChat}
            onDelete={() => setShowDeleteConfirmation(true)}
            onUpdate={() => setShowSuccessView(false)}
          />
        </div>

        {/* Delete Confirmation Dialog */}
        <Modal open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
          <ModalContent>
            <ModalHeader>
              <ModalTitle>Delete Chat?</ModalTitle>
              <ModalDescription>
                This will permanently delete your chat deployment at "{getEmailDomain()}/chat/
                {existingChat?.identifier}" and undeploy the workflow. All users will lose access
                immediately.{' '}
                <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
                  This action cannot be undone.
                </span>
              </ModalDescription>
            </ModalHeader>
            <ModalFooter>
              <Button
                variant='outline'
                className='h-[32px] px-[12px]'
                onClick={() => setShowDeleteConfirmation(false)}
                disabled={isDeleting}
              >
                Cancel
              </Button>
              <Button
                onClick={handleDelete}
                disabled={isDeleting}
                className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
              >
                {isDeleting ? (
                  <>
                    <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                    Deleting...
                  </>
                ) : (
                  'Delete'
                )}
              </Button>
            </ModalFooter>
          </ModalContent>
        </Modal>
      </>
    )
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

        <div className='space-y-4'>
          <IdentifierInput
            value={formData.identifier}
            onChange={(value) => updateField('identifier', value)}
            originalIdentifier={existingChat?.identifier || undefined}
            disabled={chatSubmitting}
            onValidationChange={setIsIdentifierValid}
            isEditingExisting={!!existingChat}
          />

          <div className='space-y-2'>
            <Label htmlFor='title' className='font-medium text-sm'>
              Chat Title
            </Label>
            <Input
              id='title'
              placeholder='Customer Support Assistant'
              value={formData.title}
              onChange={(e) => updateField('title', e.target.value)}
              required
              disabled={chatSubmitting}
            />
            {errors.title && <p className='text-destructive text-sm'>{errors.title}</p>}
          </div>
          <div className='space-y-2'>
            <Label htmlFor='description' className='font-medium text-sm'>
              Description (Optional)
            </Label>
            <Textarea
              id='description'
              placeholder='A brief description of what this chat does'
              value={formData.description}
              onChange={(e) => updateField('description', e.target.value)}
              rows={3}
              disabled={chatSubmitting}
              className='min-h-[80px] resize-none'
            />
          </div>
          <div className='space-y-2'>
            <Label className='font-medium text-sm'>Chat Output</Label>
            <Card className='rounded-[8px] border-input shadow-none'>
              <CardContent className='p-1'>
                <OutputSelect
                  workflowId={workflowId}
                  selectedOutputs={formData.selectedOutputBlocks}
                  onOutputSelect={(values) => updateField('selectedOutputBlocks', values)}
                  placeholder='Select which block outputs to use'
                  disabled={chatSubmitting}
                />
              </CardContent>
            </Card>
            {errors.outputBlocks && (
              <p className='text-destructive text-sm'>{errors.outputBlocks}</p>
            )}
            <p className='mt-2 text-muted-foreground text-xs'>
              Select which block's output to return to the user in the chat interface
            </p>
          </div>

          <AuthSelector
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
          <div className='space-y-2'>
            <Label htmlFor='welcomeMessage' className='font-medium text-sm'>
              Welcome Message
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
            <p className='text-muted-foreground text-xs'>
              This message will be displayed when users first open the chat
            </p>
          </div>

          {/* <div className='space-y-2'>
            <Label className='font-medium text-sm'>Chat Logo</Label>
            <ImageUpload
              value={imageUrl}
              onUpload={(url) => {
                setImageUrl(url)
                setImageUploadError(null)
              }}
              onError={setImageUploadError}
              onUploadStart={setIsImageUploading}
              disabled={chatSubmitting}
              uploadToServer={true}
              height='h-32'
              hideHeader={true}
            />
            {imageUploadError && <p className='text-destructive text-sm'>{imageUploadError}</p>}
            {!imageUrl && !isImageUploading && (
              <p className='text-muted-foreground text-xs'>
                Upload a logo for your chat (PNG, JPEG - max 5MB)
              </p>
            )}
          </div> */}

          <button
            type='button'
            data-delete-trigger
            onClick={() => setShowDeleteConfirmation(true)}
            style={{ display: 'none' }}
          />
        </div>
      </form>

      <Modal open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <ModalContent>
          <ModalHeader>
            <ModalTitle>Delete Chat?</ModalTitle>
            <ModalDescription>
              This will permanently delete your chat deployment at "{getEmailDomain()}/chat/
              {existingChat?.identifier}" and undeploy the workflow. All users will lose access
              immediately.{' '}
              <span className='text-[var(--text-error)] dark:text-[var(--text-error)]'>
                This action cannot be undone.
              </span>
            </ModalDescription>
          </ModalHeader>
          <ModalFooter>
            <Button
              variant='outline'
              className='h-[32px] px-[12px]'
              onClick={() => setShowDeleteConfirmation(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDelete}
              disabled={isDeleting}
              className='h-[32px] bg-[var(--text-error)] px-[12px] text-[var(--white)] hover:bg-[var(--text-error)] hover:text-[var(--white)] dark:bg-[var(--text-error)] dark:text-[var(--white)] hover:dark:bg-[var(--text-error)] dark:hover:text-[var(--white)]'
            >
              {isDeleting ? (
                <>
                  <Loader2 className='mr-2 h-3.5 w-3.5 animate-spin' />
                  Deleting...
                </>
              ) : (
                'Delete'
              )}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}

function LoadingSkeleton() {
  return (
    <div className='space-y-4 py-3'>
      <div className='space-y-2'>
        <Skeleton className='h-5 w-24' />
        <Skeleton className='h-10 w-full' />
      </div>
      <div className='space-y-2'>
        <Skeleton className='h-5 w-20' />
        <Skeleton className='h-10 w-full' />
      </div>
      <div className='space-y-2'>
        <Skeleton className='h-5 w-32' />
        <Skeleton className='h-24 w-full' />
      </div>
      <div className='space-y-2'>
        <Skeleton className='h-5 w-40' />
        <Skeleton className='h-32 w-full rounded-lg' />
      </div>
    </div>
  )
}
