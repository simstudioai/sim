'use client'

import { type FormEvent, useEffect, useRef, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Copy,
  Eye,
  EyeOff,
  Loader2,
  Plus,
  RefreshCw,
  Trash2,
} from 'lucide-react'
import { z } from 'zod'
import { Alert, AlertDescription } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { Textarea } from '@/components/ui/textarea'
import { isDev } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console-logger'
import { getBaseDomain } from '@/lib/urls/utils'
import { cn } from '@/lib/utils'
import { OutputSelect } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/chat/components/output-select/output-select'
import type { OutputConfig } from '@/stores/panel/chat/types'

const logger = createLogger('ChatDeploy')

interface ChatDeployProps {
  workflowId: string
  onClose: () => void
  deploymentInfo: {
    apiKey: string
  } | null
  onChatExistsChange?: (exists: boolean) => void
  showDeleteConfirmation?: boolean
  setShowDeleteConfirmation?: (show: boolean) => void
  onDeploymentComplete?: () => void
}

type AuthType = 'public' | 'password' | 'email'

const getDomainSuffix = (() => {
  const suffix = isDev ? `.${getBaseDomain()}` : '.simstudio.ai'
  return () => suffix
})()

// Define Zod schema for API request validation
const chatSchema = z.object({
  workflowId: z.string().min(1, 'Workflow ID is required'),
  subdomain: z
    .string()
    .min(1, 'Subdomain is required')
    .regex(/^[a-z0-9-]+$/, 'Subdomain can only contain lowercase letters, numbers, and hyphens'),
  title: z.string().min(1, 'Title is required'),
  description: z.string().optional(),
  customizations: z.object({
    primaryColor: z.string(),
    welcomeMessage: z.string(),
  }),
  authType: z.enum(['public', 'password', 'email']),
  password: z.string().optional(),
  allowedEmails: z.array(z.string()).optional(),
  outputBlockIds: z.array(z.string()).optional(),
  outputPaths: z.array(z.string()).optional(),
})

export function ChatDeploy({
  workflowId,
  onClose,
  deploymentInfo,
  onChatExistsChange,
  showDeleteConfirmation: externalShowDeleteConfirmation,
  setShowDeleteConfirmation: externalSetShowDeleteConfirmation,
  onDeploymentComplete,
}: ChatDeployProps) {
  // Form state
  const [subdomain, setSubdomain] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [isDeploying, setIsDeploying] = useState(false)
  const [subdomainError, setSubdomainError] = useState('')
  const [deployedChatUrl, setDeployedChatUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)
  const [isCheckingSubdomain, setIsCheckingSubdomain] = useState(false)
  const [subdomainAvailable, setSubdomainAvailable] = useState<boolean | null>(null)
  const subdomainCheckTimeoutRef = useRef<NodeJS.Timeout | null>(null)

  // Authentication options
  const [authType, setAuthType] = useState<AuthType>('public')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [emails, setEmails] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [emailError, setEmailError] = useState('')
  const [copySuccess, setCopySuccess] = useState(false)

  // Existing chat state
  const [existingChat, setExistingChat] = useState<any | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [_dataFetched, setDataFetched] = useState(false)

  // Track original values to detect changes
  const [originalValues, setOriginalValues] = useState<{
    subdomain: string
    title: string
    description: string
    authType: AuthType
    emails: string[]
    selectedOutputIds: string[]
  } | null>(null)

  // State to track if any changes have been made
  const [hasChanges, setHasChanges] = useState(false)

  // Confirmation dialogs
  const [showEditConfirmation, setShowEditConfirmation] = useState(false)
  const [internalShowDeleteConfirmation, setInternalShowDeleteConfirmation] = useState(false)

  // Output block selection
  const [selectedOutputBlocks, setSelectedOutputBlocks] = useState<string[]>([])

  // Track manual submission state
  const [chatSubmitting, setChatSubmitting] = useState(false)

  // Set up a ref for the form element
  const formRef = useRef<HTMLFormElement>(null)

  // Use external state for delete confirmation if provided
  const showDeleteConfirmation =
    externalShowDeleteConfirmation !== undefined
      ? externalShowDeleteConfirmation
      : internalShowDeleteConfirmation

  const setShowDeleteConfirmation =
    externalSetShowDeleteConfirmation || setInternalShowDeleteConfirmation

  // Welcome message state
  const [welcomeMessage, setWelcomeMessage] = useState('Hi there! How can I help you today?')

  // Expose a method to handle external submission requests
  useEffect(() => {
    // This will run when the component mounts
    // Ensure hidden input for API deployment is set up
    if (formRef.current) {
      let deployApiInput = formRef.current.querySelector('#deployApiEnabled') as HTMLInputElement
      if (!deployApiInput) {
        deployApiInput = document.createElement('input')
        deployApiInput.type = 'hidden'
        deployApiInput.id = 'deployApiEnabled'
        deployApiInput.name = 'deployApiEnabled'
        deployApiInput.value = 'true'
        formRef.current.appendChild(deployApiInput)
      }
    }

    // Clean up any loading states
    return () => {
      setIsDeploying(false)
      setChatSubmitting(false)
    }
  }, [])

  // Fetch existing chat data when component mounts
  useEffect(() => {
    if (workflowId) {
      setIsLoading(true)
      setDataFetched(false)
      fetchExistingChat()
    }
  }, [workflowId])

  // Check for changes when form values update
  useEffect(() => {
    if (originalValues && existingChat) {
      const currentAuthTypeChanged = authType !== originalValues.authType
      const subdomainChanged = subdomain !== originalValues.subdomain
      const titleChanged = title !== originalValues.title
      const descriptionChanged = description !== originalValues.description
      const outputBlockChanged = selectedOutputBlocks.some(
        (blockId) => !originalValues.selectedOutputIds.includes(blockId)
      )
      const welcomeMessageChanged =
        welcomeMessage !==
        (existingChat.customizations?.welcomeMessage || 'Hi there! How can I help you today?')

      // Check if emails have changed
      const emailsChanged =
        emails.length !== originalValues.emails.length ||
        emails.some((email) => !originalValues.emails.includes(email))

      // Check if password has changed - any value in password field means change
      const passwordChanged = password.length > 0

      // Determine if any changes have been made
      const changed =
        subdomainChanged ||
        titleChanged ||
        descriptionChanged ||
        currentAuthTypeChanged ||
        emailsChanged ||
        passwordChanged ||
        outputBlockChanged ||
        welcomeMessageChanged

      setHasChanges(changed)
    }
  }, [
    subdomain,
    title,
    description,
    authType,
    emails,
    password,
    selectedOutputBlocks,
    welcomeMessage,
    originalValues,
  ])

  // Fetch existing chat data for this workflow
  const fetchExistingChat = async () => {
    try {
      const response = await fetch(`/api/workflows/${workflowId}/chat/status`)

      if (response.ok) {
        const data = await response.json()

        if (data.isDeployed && data.deployment) {
          // Get detailed chat info
          const detailResponse = await fetch(`/api/chat/edit/${data.deployment.id}`)

          if (detailResponse.ok) {
            const chatDetail = await detailResponse.json()
            setExistingChat(chatDetail)

            // Notify parent component that a chat exists
            if (onChatExistsChange) {
              onChatExistsChange(true)
            }

            // Populate form with existing data
            setSubdomain(chatDetail.subdomain || '')
            setTitle(chatDetail.title || '')
            setDescription(chatDetail.description || '')
            setAuthType(chatDetail.authType || 'public')

            // Store original values for change detection
            setOriginalValues({
              subdomain: chatDetail.subdomain || '',
              title: chatDetail.title || '',
              description: chatDetail.description || '',
              authType: chatDetail.authType || 'public',
              emails: Array.isArray(chatDetail.allowedEmails) ? [...chatDetail.allowedEmails] : [],
              selectedOutputIds: Array.isArray(chatDetail.outputConfigs)
                ? chatDetail.outputConfigs.map(
                    (config: OutputConfig) => `${config.blockId}_${config.path}`
                  )
                : [],
            })

            // Set emails if using email auth
            if (chatDetail.authType === 'email' && Array.isArray(chatDetail.allowedEmails)) {
              setEmails(chatDetail.allowedEmails)
            }

            // For security, we don't populate password - user will need to enter a new one if changing it

            // Inside the fetchExistingChat function - update how we load output configs
            if (chatDetail.outputConfigs) {
              const configs = Array.isArray(chatDetail.outputConfigs)
                ? (chatDetail.outputConfigs as OutputConfig[])
                : []
              const combinedOutputIds = configs.map((config) => `${config.blockId}_${config.path}`)
              setSelectedOutputBlocks(combinedOutputIds)
            }

            // Set welcome message if it exists
            if (chatDetail.customizations?.welcomeMessage) {
              setWelcomeMessage(chatDetail.customizations.welcomeMessage)
            }
          } else {
            logger.error('Failed to fetch chat details')
          }
        } else {
          setExistingChat(null)
          setOriginalValues(null)

          // Notify parent component that no chat exists
          if (onChatExistsChange) {
            onChatExistsChange(false)
          }
        }
      }
    } catch (error) {
      logger.error('Error fetching chat status:', error)
    } finally {
      setIsLoading(false)
      setDataFetched(true)
      setHasChanges(false) // Reset changes detection after loading
    }
  }

  // Validate subdomain format on input change and check availability
  const handleSubdomainChange = (value: string) => {
    const lowercaseValue = value.toLowerCase()
    setSubdomain(lowercaseValue)
    setSubdomainAvailable(null)

    // Clear any existing timeout
    if (subdomainCheckTimeoutRef.current) {
      clearTimeout(subdomainCheckTimeoutRef.current)
    }

    // Validate subdomain format
    if (lowercaseValue && !/^[a-z0-9-]+$/.test(lowercaseValue)) {
      setSubdomainError('Subdomain can only contain lowercase letters, numbers, and hyphens')
      // Reset deploying states when validation errors occur
      setIsDeploying(false)
      setChatSubmitting(false)
      return
    }
    setSubdomainError('')

    // Skip check if empty or same as original (for updates)
    if (!lowercaseValue || (originalValues && lowercaseValue === originalValues.subdomain)) {
      return
    }

    // Debounce check to avoid unnecessary API calls
    subdomainCheckTimeoutRef.current = setTimeout(() => {
      checkSubdomainAvailability(lowercaseValue)
    }, 500)
  }

  // Check if subdomain is available
  const checkSubdomainAvailability = async (domain: string) => {
    if (!domain) return

    setIsCheckingSubdomain(true)

    try {
      const response = await fetch(
        `/api/chat/subdomains/validate?subdomain=${encodeURIComponent(domain)}`
      )
      const data = await response.json()

      // Only update if this is still the current subdomain
      if (domain === subdomain) {
        if (response.ok) {
          setSubdomainAvailable(data.available)
          if (!data.available) {
            setSubdomainError('This subdomain is already in use')
            // Reset deploying states when subdomain is unavailable
            setIsDeploying(false)
            setChatSubmitting(false)
          } else {
            setSubdomainError('')
          }
        } else {
          setSubdomainError('Error checking subdomain availability')
          // Reset deploying states on API error
          setIsDeploying(false)
          setChatSubmitting(false)
        }
      }
    } catch (error) {
      logger.error('Error checking subdomain availability:', error)
      setSubdomainError('Error checking subdomain availability')
      // Reset deploying states on error
      setIsDeploying(false)
      setChatSubmitting(false)
    } finally {
      setIsCheckingSubdomain(false)
    }
  }

  // Validate and add email
  const handleAddEmail = () => {
    // Basic email validation
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail) && !newEmail.startsWith('@')) {
      setEmailError('Please enter a valid email or domain (e.g., user@example.com or @example.com)')
      return
    }

    // Add email if it's not already in the list
    if (!emails.includes(newEmail)) {
      setEmails([...emails, newEmail])
      setNewEmail('')
      setEmailError('')
    } else {
      setEmailError('This email or domain is already in the list')
    }
  }

  // Remove email from the list
  const handleRemoveEmail = (email: string) => {
    setEmails(emails.filter((e) => e !== email))
  }

  // Password generation and copy functionality
  const generatePassword = () => {
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*()_-+='
    let result = ''
    const length = 24

    for (let i = 0; i < length; i++) {
      result += chars.charAt(Math.floor(Math.random() * chars.length))
    }

    setPassword(result)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
    setCopySuccess(true)
    setTimeout(() => {
      setCopySuccess(false)
    }, 2000)
  }

  const handleDelete = async () => {
    if (!existingChat || !existingChat.id) return

    try {
      setIsDeleting(true)

      const response = await fetch(`/api/chat/edit/${existingChat.id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to delete chat')
      }

      // Close modal after successful deletion
      onClose()
    } catch (error: any) {
      logger.error('Failed to delete chat:', error)
      setErrorMessage(error.message || 'An unexpected error occurred while deleting')
    } finally {
      setIsDeleting(false)
      setShowDeleteConfirmation(false)
    }
  }

  // Deploy or update chat
  const handleSubmit = async (e?: FormEvent) => {
    if (e) e.preventDefault()

    // If already submitting, don't process again
    if (chatSubmitting) return

    setChatSubmitting(true)
    setErrorMessage(null)

    // Log form state to help debug
    logger.info('Form submission triggered with values:', {
      subdomain,
      title,
      authType,
      hasOutputBlockSelection: !!selectedOutputBlocks.length,
    })

    // Basic validation
    if (!workflowId || !subdomain.trim() || !title.trim()) {
      logger.error('Missing required fields', { workflowId, subdomain, title })
      setChatSubmitting(false)
      setErrorMessage('Please fill out all required fields')
      return
    }

    // Check subdomain availability before submission if it's different from original
    if (
      (!existingChat || subdomain !== existingChat.subdomain) &&
      (!originalValues || subdomain !== originalValues.subdomain)
    ) {
      setIsCheckingSubdomain(true)
      try {
        const response = await fetch(
          `/api/chat/subdomains/validate?subdomain=${encodeURIComponent(subdomain)}`
        )
        const data = await response.json()

        if (!response.ok || !data.available) {
          setSubdomainError('This subdomain is already in use')
          setChatSubmitting(false)
          setIsCheckingSubdomain(false)
          return
        }
      } catch (error) {
        logger.error('Error checking subdomain availability:', error)
        setSubdomainError('Error checking subdomain availability')
        setChatSubmitting(false)
        setIsCheckingSubdomain(false)
        return
      }
      setIsCheckingSubdomain(false)
    }

    // Verify output selection if it's set
    if (selectedOutputBlocks.length === 0) {
      logger.error('No output blocks selected')
      setErrorMessage('Please select at least one output block')
      setChatSubmitting(false)
      return
    }

    if (subdomainError) {
      setChatSubmitting(false)
      return
    }

    // Validate authentication options
    if (authType === 'password' && !password.trim() && !existingChat) {
      setErrorMessage('Password is required when using password protection')
      setChatSubmitting(false)
      return
    }

    if (authType === 'email' && emails.length === 0) {
      setErrorMessage('At least one email or domain is required when using email access control')
      setChatSubmitting(false)
      return
    }

    // If editing an existing chat, check if we should show confirmation
    if (existingChat?.isActive) {
      const majorChanges =
        subdomain !== existingChat.subdomain ||
        authType !== existingChat.authType ||
        (authType === 'email' &&
          JSON.stringify(emails) !== JSON.stringify(existingChat.allowedEmails))

      if (majorChanges) {
        setShowEditConfirmation(true)
        setChatSubmitting(false)
        return
      }
    }

    // Proceed with create/update
    await deployOrUpdateChat()
  }

  // Actual deployment/update logic
  const deployOrUpdateChat = async () => {
    setErrorMessage(null)

    try {
      // Create request payload
      const payload: any = {
        workflowId,
        subdomain: subdomain.trim(),
        title: title.trim(),
        description: description.trim(),
        customizations: {
          primaryColor: '#802FFF',
          welcomeMessage: welcomeMessage.trim(),
        },
        authType: authType,
      }

      // Always include auth specific fields regardless of authType
      // This ensures they're always properly handled
      if (authType === 'password') {
        // For password auth, only send the password if:
        // 1. It's a new chat, or
        // 2. Creating a new password for an existing chat, or
        // 3. Changing from another auth type to password
        if (password) {
          payload.password = password
        } else if (existingChat && existingChat.authType !== 'password') {
          // If changing to password auth but no password provided for an existing chat,
          // this is an error - server will reject it
          setErrorMessage('Password is required when using password protection')
          setChatSubmitting(false)
          return // Stop the submission
        }

        payload.allowedEmails = [] // Clear emails when using password auth
      } else if (authType === 'email') {
        payload.allowedEmails = emails
      } else if (authType === 'public') {
        // Explicitly set empty values for public access
        payload.allowedEmails = []
      }

      // Add output block configuration if selected
      if (selectedOutputBlocks && selectedOutputBlocks.length > 0) {
        const outputConfigs = selectedOutputBlocks
          .map((outputId) => {
            const firstUnderscoreIndex = outputId.indexOf('_')
            // Only process IDs that have the correct blockId_path format
            if (firstUnderscoreIndex !== -1) {
              const blockId = outputId.substring(0, firstUnderscoreIndex)
              const path = outputId.substring(firstUnderscoreIndex + 1)

              // Additional validation to ensure both parts are non-empty
              if (blockId && path) {
                return { blockId, path } as OutputConfig
              }
              logger.warn(`Invalid output format: ${outputId}, missing blockId or path`)
              return null
            }
            logger.warn(
              `Invalid output ID format: ${outputId}, missing required format blockId_path`
            )
            return null
          })
          .filter(Boolean) as OutputConfig[] // Remove any null values

        // Only include output configurations if we have valid ones
        if (outputConfigs.length > 0) {
          payload.outputConfigs = outputConfigs

          logger.info('Added output configuration to payload:', {
            outputConfigsCount: outputConfigs.length,
            outputConfigs: outputConfigs,
          })
        } else {
          logger.warn('No valid output configurations found in selection')
          payload.outputConfigs = []
        }
      } else {
        // No output blocks selected - explicitly set to empty array
        payload.outputConfigs = []
      }

      // Pass the API key from workflow deployment
      if (deploymentInfo?.apiKey) {
        payload.apiKey = deploymentInfo.apiKey
      }

      // For existing chat updates, ensure API gets redeployed too
      if (existingChat?.id) {
        // First ensure the API deployment is up-to-date
        try {
          // Make a direct call to redeploy the API
          const redeployResponse = await fetch(`/api/workflows/${workflowId}/deploy`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              deployApiEnabled: true,
              deployChatEnabled: false,
            }),
          })

          if (!redeployResponse.ok) {
            logger.warn('API redeployment failed, continuing with chat update')
          } else {
            logger.info('API successfully redeployed alongside chat update')
          }
        } catch (error) {
          logger.warn('Error redeploying API, continuing with chat update:', error)
        }
      } else {
        // For new chat deployments, set the flag for API deployment
        payload.deployApiEnabled = true
      }

      // Log the final payload (minus sensitive data) for debugging
      logger.info('Submitting chat deployment with values:', {
        workflowId: payload.workflowId,
        subdomain: payload.subdomain,
        title: payload.title,
        authType: payload.authType,
        hasPassword: !!payload.password,
        emailCount: payload.allowedEmails?.length || 0,
        hasOutputConfig: !!payload.outputConfigs.length,
        deployApiEnabled: payload.deployApiEnabled,
      })

      // Make API request - different endpoints for create vs update
      let endpoint = '/api/chat'
      let method = 'POST'

      // If updating existing chat, use the edit/ID endpoint with PATCH method
      if (existingChat?.id) {
        endpoint = `/api/chat/edit/${existingChat.id}`
        method = 'PATCH'
        // Ensure deployApiEnabled is included in updates too
        payload.deployApiEnabled = true
      }

      // Validate with Zod
      try {
        chatSchema.parse(payload)
      } catch (validationError: any) {
        if (validationError instanceof z.ZodError) {
          const errorMessage = validationError.errors[0]?.message || 'Invalid form data'
          setErrorMessage(errorMessage)
          setChatSubmitting(false)
          return
        }
      }

      const response = await fetch(endpoint, {
        method,
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || `Failed to ${existingChat ? 'update' : 'deploy'} chat`)
      }

      const { chatUrl } = result

      if (chatUrl) {
        logger.info(`Chat ${existingChat ? 'updated' : 'deployed'} successfully:`, chatUrl)
        setDeployedChatUrl(chatUrl)

        if (onDeploymentComplete) {
          onDeploymentComplete()
        }

        if (onChatExistsChange) {
          onChatExistsChange(true)
        }
      } else {
        throw new Error('Response missing chatUrl')
      }
    } catch (error: any) {
      logger.error(`Failed to ${existingChat ? 'update' : 'deploy'} chat:`, error)
      setErrorMessage(error.message || 'An unexpected error occurred')
      logger.error(`Failed to deploy chat: ${error.message}`, workflowId)
    } finally {
      setChatSubmitting(false)
      setShowEditConfirmation(false)
    }
  }

  // Determine button label based on state
  const _getSubmitButtonLabel = () => {
    return existingChat ? 'Update Chat' : 'Deploy Chat'
  }

  // Check if form submission is possible
  const _isFormSubmitDisabled = () => {
    return (
      chatSubmitting ||
      isDeleting ||
      !subdomain ||
      !title ||
      !!subdomainError ||
      isCheckingSubdomain ||
      (authType === 'password' && !password && !existingChat) ||
      (authType === 'email' && emails.length === 0) ||
      (existingChat && !hasChanges)
    )
  }

  if (isLoading) {
    return (
      <div className='space-y-4 py-3'>
        {/* Subdomain section */}
        <div className='space-y-2'>
          <Skeleton className='h-5 w-24' />
          <Skeleton className='h-10 w-full' />
        </div>

        {/* Title section */}
        <div className='space-y-2'>
          <Skeleton className='h-5 w-20' />
          <Skeleton className='h-10 w-full' />
        </div>

        {/* Description section */}
        <div className='space-y-2'>
          <Skeleton className='h-5 w-32' />
          <Skeleton className='h-24 w-full' />
        </div>

        {/* Output configuration section */}
        <div className='space-y-2'>
          <Skeleton className='h-5 w-40' />
          <Skeleton className='h-32 w-full rounded-lg' />
        </div>

        {/* Access control section */}
        <div className='space-y-2'>
          <Skeleton className='h-5 w-28' />
          <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
            <Skeleton className='h-24 w-full rounded-lg' />
            <Skeleton className='h-24 w-full rounded-lg' />
            <Skeleton className='h-24 w-full rounded-lg' />
          </div>
          <Skeleton className='h-40 w-full rounded-lg' />
        </div>

        {/* Submit button */}
        <Skeleton className='h-10 w-32' />
      </div>
    )
  }

  if (deployedChatUrl) {
    const url = new URL(deployedChatUrl)
    const hostname = url.hostname
    const isDevelopmentUrl = hostname.includes('localhost')

    let domainSuffix
    if (isDevelopmentUrl) {
      const baseDomain = getBaseDomain()
      const baseHost = baseDomain.split(':')[0]
      const port = url.port || (baseDomain.includes(':') ? baseDomain.split(':')[1] : '3000')
      domainSuffix = `.${baseHost}:${port}`
    } else {
      domainSuffix = '.simstudio.ai'
    }

    const subdomainPart = isDevelopmentUrl
      ? hostname.split('.')[0]
      : hostname.split('.simstudio.ai')[0]

    // Success view - simplified with no buttons
    return (
      <div className='space-y-4'>
        <div className='space-y-2'>
          <Label className='font-medium text-sm'>
            Chat {existingChat ? 'Update' : 'Deployment'} Successful
          </Label>
          <div className='relative flex items-center rounded-md ring-offset-background'>
            <a
              href={deployedChatUrl}
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
              href={deployedChatUrl}
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

  if (errorMessage) {
    return (
      <div className='space-y-4'>
        <div className='rounded-md border border-destructive/30 bg-destructive/10 p-3 text-destructive text-sm'>
          <div className='font-semibold'>Chat Deployment Error</div>
          <div>{errorMessage}</div>
        </div>

        {/* Add button to try again */}
        <div className='flex justify-end'>
          <Button
            variant='outline'
            onClick={() => {
              setErrorMessage(null)
              setChatSubmitting(false)
            }}
          >
            Try Again
          </Button>
        </div>
      </div>
    )
  }

  // Form view
  return (
    <>
      <form
        ref={formRef}
        onSubmit={(e) => {
          e.preventDefault() // Prevent default form submission
          handleSubmit(e) // Call our submit handler directly
        }}
        className='chat-deploy-form -mx-1 space-y-4 overflow-y-auto px-1'
      >
        <div className='grid gap-4'>
          {errorMessage && (
            <Alert variant='destructive'>
              <AlertTriangle className='h-4 w-4' />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className='space-y-4'>
            <div className='space-y-4'>
              <div className='space-y-2'>
                <Label htmlFor='subdomain' className='font-medium text-sm'>
                  Subdomain
                </Label>
                <div className='relative flex items-center rounded-md ring-offset-background focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2'>
                  <Input
                    id='subdomain'
                    placeholder='company-name'
                    value={subdomain}
                    onChange={(e) => handleSubdomainChange(e.target.value)}
                    required
                    className={cn(
                      'rounded-r-none border-r-0 focus-visible:ring-0 focus-visible:ring-offset-0',
                      subdomainAvailable === true &&
                        'border-green-500 focus-visible:border-green-500',
                      subdomainAvailable === false &&
                        'border-destructive focus-visible:border-destructive'
                    )}
                    disabled={isDeploying}
                  />
                  <div className='flex h-10 items-center whitespace-nowrap rounded-r-md border border-l-0 bg-muted px-3 font-medium text-muted-foreground text-sm'>
                    {getDomainSuffix()}
                  </div>
                  {!isCheckingSubdomain && subdomainAvailable === true && subdomain && (
                    <div className='absolute right-14 flex items-center'>
                      <Check className='h-4 w-4 text-green-500' />
                    </div>
                  )}
                </div>
                {subdomainError && (
                  <p className='mt-1 text-destructive text-sm'>{subdomainError}</p>
                )}
                {!subdomainError && subdomainAvailable === true && subdomain && (
                  <p className='mt-1 text-green-500 text-sm'>Subdomain is available</p>
                )}
              </div>

              <div className='space-y-2'>
                <Label htmlFor='title' className='font-medium text-sm'>
                  Chat Title
                </Label>
                <Input
                  id='title'
                  placeholder='Customer Support Assistant'
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  disabled={isDeploying}
                />
              </div>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='description' className='font-medium text-sm'>
                Description (Optional)
              </Label>
              <Textarea
                id='description'
                placeholder='A brief description of what this chat does'
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isDeploying}
              />
            </div>
          </div>

          {/* Output Configuration */}
          <div className='space-y-2'>
            <div>
              <Label className='font-medium text-sm'>Chat Output</Label>
            </div>

            <Card className='rounded-md border-input shadow-none'>
              <CardContent className='p-1'>
                <OutputSelect
                  workflowId={workflowId}
                  selectedOutputs={selectedOutputBlocks}
                  onOutputSelect={(values) => {
                    logger.info(`Output block selection changed to: ${values}`)
                    setSelectedOutputBlocks(values)

                    // Mark as changed to enable update button
                    if (existingChat) {
                      setHasChanges(true)
                    }
                  }}
                  placeholder='Select which block outputs to use'
                  disabled={isDeploying}
                />
              </CardContent>
            </Card>
            <p className='mt-2 text-muted-foreground text-xs'>
              Select which block's output to return to the user in the chat interface
            </p>
          </div>

          {/* Authentication Options */}
          <div className='space-y-2'>
            <div>
              <Label className='font-medium text-sm'>Access Control</Label>
            </div>

            <div className='grid grid-cols-1 gap-3 md:grid-cols-3'>
              <Card
                className={cn(
                  'cursor-pointer overflow-hidden shadow-none transition-colors hover:bg-accent/30',
                  authType === 'public'
                    ? 'border border-muted-foreground hover:bg-accent/50'
                    : 'border border-input'
                )}
              >
                <CardContent className='relative flex flex-col items-center justify-center p-4 text-center'>
                  <button
                    type='button'
                    className='absolute inset-0 z-10 h-full w-full cursor-pointer'
                    onClick={() => !isDeploying && setAuthType('public')}
                    aria-label='Select public access'
                  />
                  <div className='justify-center text-center align-middle'>
                    <h3 className='font-medium text-sm'>Public Access</h3>
                    <p className='text-muted-foreground text-xs'>Anyone can access your chat</p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={cn(
                  'cursor-pointer overflow-hidden shadow-none transition-colors hover:bg-accent/30',
                  authType === 'password'
                    ? 'border border-muted-foreground hover:bg-accent/50'
                    : 'border border-input'
                )}
              >
                <CardContent className='relative flex flex-col items-center justify-center p-4 text-center'>
                  <button
                    type='button'
                    className='absolute inset-0 z-10 h-full w-full cursor-pointer'
                    onClick={() => !isDeploying && setAuthType('password')}
                    aria-label='Select password protected access'
                  />
                  <div className='justify-center text-center align-middle'>
                    <h3 className='font-medium text-sm'>Password Protected</h3>
                    <p className='text-muted-foreground text-xs'>Secure with a single password</p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={cn(
                  'cursor-pointer overflow-hidden shadow-none transition-colors hover:bg-accent/30',
                  authType === 'email'
                    ? 'border border-muted-foreground hover:bg-accent/50'
                    : 'border border-input'
                )}
              >
                <CardContent className='relative flex flex-col items-center justify-center p-4 text-center'>
                  <button
                    type='button'
                    className='absolute inset-0 z-10 h-full w-full cursor-pointer'
                    onClick={() => !isDeploying && setAuthType('email')}
                    aria-label='Select email access'
                  />
                  <div className='justify-center text-center align-middle'>
                    <h3 className='font-medium text-sm'>Email Access</h3>
                    <p className='text-muted-foreground text-xs'>Restrict to specific emails</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Auth settings */}
            <div>
              {authType === 'password' && (
                <Card className='shadow-none'>
                  <CardContent className='p-4'>
                    <div>
                      <h3 className='mb-2 font-medium text-sm'>Password Settings</h3>
                    </div>
                    <div className='relative'>
                      {/* Add visual password indicator for existing passwords */}
                      {existingChat && existingChat.authType === 'password' && !password && (
                        <div className='mb-2 flex items-center text-muted-foreground text-xs'>
                          <div className='mr-2 rounded-full bg-primary/10 px-2 py-0.5 font-medium text-primary'>
                            Password set
                          </div>
                          <span>Current password is securely stored</span>
                        </div>
                      )}
                      <div className='relative'>
                        <Input
                          type={showPassword ? 'text' : 'password'}
                          placeholder={
                            existingChat
                              ? 'Enter new password (leave empty to keep current)'
                              : 'Enter password'
                          }
                          value={password}
                          onChange={(e) => setPassword(e.target.value)}
                          disabled={isDeploying}
                          className='pr-28'
                          required={!existingChat && authType === 'password'}
                        />
                        <div className='absolute top-0 right-0 flex h-full'>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            onClick={generatePassword}
                            disabled={isDeploying}
                            className='px-2'
                          >
                            <RefreshCw className='h-4 w-4' />
                            <span className='sr-only'>Generate password</span>
                          </Button>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            onClick={() => copyToClipboard(password)}
                            disabled={!password || isDeploying}
                            className='px-2'
                          >
                            {copySuccess ? (
                              <Check className='h-4 w-4' />
                            ) : (
                              <Copy className='h-4 w-4' />
                            )}
                            <span className='sr-only'>Copy password</span>
                          </Button>
                          <Button
                            type='button'
                            variant='ghost'
                            size='icon'
                            onClick={() => setShowPassword(!showPassword)}
                            disabled={isDeploying}
                            className='px-2'
                          >
                            {showPassword ? (
                              <EyeOff className='h-4 w-4' />
                            ) : (
                              <Eye className='h-4 w-4' />
                            )}
                            <span className='sr-only'>
                              {showPassword ? 'Hide password' : 'Show password'}
                            </span>
                          </Button>
                        </div>
                      </div>
                    </div>
                    {/* Add helper text to explain password behavior */}
                    <p className='mt-2 text-muted-foreground text-xs'>
                      {existingChat && existingChat.authType === 'password'
                        ? 'Leaving this empty will keep the current password. Enter a new password to change it.'
                        : 'This password will be required to access your chat.'}
                    </p>
                  </CardContent>
                </Card>
              )}

              {authType === 'email' && (
                <Card className='shadow-none'>
                  <CardContent className='p-4'>
                    <div>
                      <h3 className='mb-2 font-medium text-sm'>Email Access Settings</h3>
                    </div>

                    <div className='flex gap-2'>
                      <Input
                        placeholder='user@example.com or @domain.com'
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        disabled={isDeploying}
                        className='flex-1'
                      />
                      <Button
                        type='button'
                        onClick={handleAddEmail}
                        disabled={!newEmail.trim() || isDeploying}
                        className='shrink-0'
                      >
                        <Plus className='h-4 w-4' />
                        Add
                      </Button>
                    </div>

                    {emailError && <p className='text-destructive text-sm'>{emailError}</p>}

                    {emails.length > 0 && (
                      <div className='mt-3 max-h-[150px] overflow-y-auto rounded-md border bg-background px-2 py-0 shadow-none'>
                        <ul className='divide-y divide-border'>
                          {emails.map((email) => (
                            <li key={email} className='relative'>
                              <div className='group my-1 flex items-center justify-between rounded-sm px-2 py-2 text-sm'>
                                <span className='font-medium text-foreground'>{email}</span>
                                <Button
                                  type='button'
                                  variant='ghost'
                                  size='icon'
                                  onClick={() => handleRemoveEmail(email)}
                                  disabled={isDeploying}
                                  className='h-7 w-7 opacity-70'
                                >
                                  <Trash2 className='h-4 w-4' />
                                </Button>
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className='mt-2 text-muted-foreground text-xs'>
                      Add specific emails or entire domains (@example.com)
                    </p>
                  </CardContent>
                </Card>
              )}

              {authType === 'public' && (
                <Card className='shadow-none'>
                  <CardContent className='p-4'>
                    <div>
                      <h3 className='mb-2 font-medium text-sm'>Public Access Settings</h3>
                      <p className='text-muted-foreground text-xs'>
                        This chat will be publicly accessible to anyone with the link.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>

          {/* Welcome Message Section - Add this before the form closing div */}
          <div className='space-y-2'>
            <Label htmlFor='welcomeMessage' className='font-medium text-sm'>
              Welcome Message
            </Label>
            <Textarea
              id='welcomeMessage'
              placeholder='Enter a welcome message for your chat'
              value={welcomeMessage}
              onChange={(e) => setWelcomeMessage(e.target.value)}
              rows={3}
              disabled={isDeploying}
            />
            <p className='text-muted-foreground text-xs'>
              This message will be displayed when users first open the chat
            </p>
          </div>
        </div>
      </form>

      {/* Edit Confirmation Dialog */}
      <AlertDialog open={showEditConfirmation} onOpenChange={setShowEditConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Active Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to change an active chat deployment. These changes will immediately
              affect all users of your chat.
              {subdomain !== existingChat?.subdomain && (
                <p className='mt-2 font-medium'>
                  The URL of your chat will change, and any links to the old URL will stop working.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeploying}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deployOrUpdateChat()} disabled={isDeploying}>
              {isDeploying ? (
                <span className='flex items-center'>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Updating...
                </span>
              ) : (
                'Update Chat'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your chat deployment at{' '}
              <span className='font-mono text-destructive'>{subdomain}.simstudio.ai</span>.
              <p className='mt-2'>
                All users will lose access immediately, and this action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className='bg-destructive hover:bg-destructive/90'
            >
              {isDeleting ? (
                <span className='flex items-center'>
                  <Loader2 className='mr-2 h-4 w-4 animate-spin' />
                  Deleting...
                </span>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
