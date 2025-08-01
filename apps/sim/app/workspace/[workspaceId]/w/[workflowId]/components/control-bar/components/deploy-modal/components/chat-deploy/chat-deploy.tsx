'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle } from 'lucide-react'
import {
  Alert,
  AlertDescription,
  Card,
  CardContent,
  Input,
  Label,
  Skeleton,
  Textarea,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { getBaseDomain, getEmailDomain } from '@/lib/urls/utils'
import { AuthSelector } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/components/auth-selector'
import { SubdomainInput } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/components/subdomain-input'
import { useChatDeployment } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/hooks/use-chat-deployment'
import { useChatForm } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/control-bar/components/deploy-modal/components/chat-deploy/hooks/use-chat-form'
import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/chat/components'

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
}

interface ExistingChat {
  id: string
  subdomain: string
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
}: ChatDeployProps) {
  // Loading and existing chat state
  const [isLoading, setIsLoading] = useState(false)
  const [existingChat, setExistingChat] = useState<ExistingChat | null>(null)

  // Form and deployment hooks
  const { formData, errors, updateField, setError, validateForm, setFormData } = useChatForm()
  const { deployedUrl, deployChat } = useChatDeployment()

  // Refs
  const formRef = useRef<HTMLFormElement>(null)

  // Subdomain validation state
  const [isSubdomainValid, setIsSubdomainValid] = useState(false)

  // Track overall form validity
  const isFormValid =
    isSubdomainValid &&
    Boolean(formData.title.trim()) &&
    formData.selectedOutputBlocks.length > 0 &&
    (formData.authType !== 'password' ||
      Boolean(formData.password.trim()) ||
      Boolean(existingChat)) &&
    (formData.authType !== 'email' || formData.emails.length > 0)

  // Notify parent of validation changes
  useEffect(() => {
    onValidationChange?.(isFormValid)
  }, [isFormValid, onValidationChange])

  // Fetch existing chat data when component mounts
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
          const detailResponse = await fetch(`/api/chat/edit/${data.deployment.id}`)

          if (detailResponse.ok) {
            const chatDetail = await detailResponse.json()
            setExistingChat(chatDetail)

            // Populate form with existing data
            setFormData({
              subdomain: chatDetail.subdomain || '',
              title: chatDetail.title || '',
              description: chatDetail.description || '',
              authType: chatDetail.authType || 'public',
              password: '', // Never populate password for security
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

            onChatExistsChange?.(true)
          }
        } else {
          setExistingChat(null)
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

    // Prevent double submission
    if (chatSubmitting) return

    setChatSubmitting(true)

    try {
      // Validate form
      if (!validateForm()) {
        setChatSubmitting(false)
        return
      }

      // Check subdomain validation
      if (!isSubdomainValid && formData.subdomain !== existingChat?.subdomain) {
        setError('subdomain', 'Please wait for subdomain validation to complete')
        setChatSubmitting(false)
        return
      }

      // Deploy chat
      await deployChat(workflowId, formData, deploymentInfo, existingChat?.id)

      // Success - component will show success state via deployedUrl
      onChatExistsChange?.(true)
    } catch (error: any) {
      // Handle subdomain conflict specifically
      if (error.message?.includes('subdomain')) {
        setError('subdomain', error.message)
      } else {
        setError('general', error.message)
      }
    } finally {
      setChatSubmitting(false)
    }
  }

  // Setup form for external submission
  useEffect(() => {
    const form = formRef.current
    if (form) {
      const handleDOMSubmit = (e: Event) => {
        e.preventDefault()
        handleSubmit()
      }
      form.addEventListener('submit', handleDOMSubmit)
      return () => {
        form.removeEventListener('submit', handleDOMSubmit)
      }
    }
  }, [handleSubmit])

  if (isLoading) {
    return <LoadingSkeleton />
  }

  if (deployedUrl) {
    return <SuccessView deployedUrl={deployedUrl} existingChat={existingChat} />
  }

  return (
    <form
      ref={formRef}
      onSubmit={handleSubmit}
      className='chat-deploy-form -mx-1 space-y-4 overflow-y-auto px-1'
    >
      {errors.general && (
        <Alert variant='destructive'>
          <AlertTriangle className='h-4 w-4' />
          <AlertDescription>{errors.general}</AlertDescription>
        </Alert>
      )}

      <div className='space-y-4'>
        {/* Subdomain Input */}
        <SubdomainInput
          value={formData.subdomain}
          onChange={(value) => updateField('subdomain', value)}
          originalSubdomain={existingChat?.subdomain}
          disabled={chatSubmitting}
          onValidationChange={setIsSubdomainValid}
        />

        {/* Title Input */}
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

        {/* Description Input */}
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
          />
        </div>

        {/* Output Configuration */}
        <div className='space-y-2'>
          <Label className='font-medium text-sm'>Chat Output</Label>
          <Card className='rounded-md border-input shadow-none'>
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
          {errors.outputBlocks && <p className='text-destructive text-sm'>{errors.outputBlocks}</p>}
          <p className='mt-2 text-muted-foreground text-xs'>
            Select which block's output to return to the user in the chat interface
          </p>
        </div>

        {/* Authentication Selector */}
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

        {/* Welcome Message */}
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
          />
          <p className='text-muted-foreground text-xs'>
            This message will be displayed when users first open the chat
          </p>
        </div>
      </div>
    </form>
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

function SuccessView({
  deployedUrl,
  existingChat,
}: {
  deployedUrl: string
  existingChat: ExistingChat | null
}) {
  const url = new URL(deployedUrl)
  const hostname = url.hostname
  const isDevelopmentUrl = hostname.includes('localhost')

  let domainSuffix
  if (isDevelopmentUrl) {
    const baseDomain = getBaseDomain()
    const baseHost = baseDomain.split(':')[0]
    const port = url.port || (baseDomain.includes(':') ? baseDomain.split(':')[1] : '3000')
    domainSuffix = `.${baseHost}:${port}`
  } else {
    domainSuffix = `.${getEmailDomain()}`
  }

  const baseDomainForSplit = getEmailDomain()
  const subdomainPart = isDevelopmentUrl
    ? hostname.split('.')[0]
    : hostname.split(`.${baseDomainForSplit}`)[0]

  return (
    <div className='space-y-4'>
      <div className='space-y-2'>
        <Label className='font-medium text-sm'>
          Chat {existingChat ? 'Update' : 'Deployment'} Successful
        </Label>
        <div className='relative flex items-center rounded-md ring-offset-background'>
          <a
            href={deployedUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='flex h-10 flex-1 items-center break-all rounded-l-md border border-r-0 p-2 font-medium text-primary text-sm'
          >
            {subdomainPart}
          </a>
          <div className='flex h-10 items-center whitespace-nowrap rounded-r-md border border-l-0 bg-muted px-3 font-medium text-muted-foreground text-sm'>
            {domainSuffix}
          </div>
        </div>
        <p className='text-muted-foreground text-xs'>
          Your chat is now live at{' '}
          <a
            href={deployedUrl}
            target='_blank'
            rel='noopener noreferrer'
            className='text-primary hover:underline'
          >
            this URL
          </a>
        </p>
      </div>
    </div>
  )
}
