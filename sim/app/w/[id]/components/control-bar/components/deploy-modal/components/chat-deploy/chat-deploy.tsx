'use client'

import { FormEvent, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Circle,
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
import { Textarea } from '@/components/ui/textarea'
import { createLogger } from '@/lib/logs/console-logger'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { OutputSelect } from '@/app/w/[id]/components/panel/components/chat/components/output-select/output-select'

const logger = createLogger('ChatDeploy')

interface ChatDeployProps {
  workflowId: string
  onClose: () => void
  deploymentInfo: {
    apiKey: string
  } | null
}

type AuthType = 'public' | 'password' | 'email'

const isDevelopment = process.env.NODE_ENV === 'development'

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
  outputBlockId: z.string().nullish(),
  outputPath: z.string().nullish(),
})

export function ChatDeploy({ workflowId, onClose, deploymentInfo }: ChatDeployProps) {
  // Store hooks
  const { addNotification } = useNotificationStore()

  // Form state
  const [subdomain, setSubdomain] = useState('')
  const [title, setTitle] = useState('')
  const [description, setDescription] = useState('')
  const [isDeploying, setIsDeploying] = useState(false)
  const [subdomainError, setSubdomainError] = useState('')
  const [deployedChatUrl, setDeployedChatUrl] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  // Authentication options
  const [authType, setAuthType] = useState<AuthType>('public')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [emails, setEmails] = useState<string[]>([])
  const [newEmail, setNewEmail] = useState('')
  const [emailError, setEmailError] = useState('')

  // Existing chat state
  const [existingChat, setExistingChat] = useState<any | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [dataFetched, setDataFetched] = useState(false)

  // Track original values to detect changes
  const [originalValues, setOriginalValues] = useState<{
    subdomain: string
    title: string
    description: string
    authType: AuthType
    emails: string[]
    outputBlockId: string | null
  } | null>(null)

  // State to track if any changes have been made
  const [hasChanges, setHasChanges] = useState(false)

  // Confirmation dialogs
  const [showEditConfirmation, setShowEditConfirmation] = useState(false)
  const [showDeleteConfirmation, setShowDeleteConfirmation] = useState(false)

  // Inside the component - add state for output block selection
  const [selectedOutputBlock, setSelectedOutputBlock] = useState<string | null>(null)

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
      const outputBlockChanged = selectedOutputBlock !== originalValues.outputBlockId

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
        outputBlockChanged

      setHasChanges(changed)
    }
  }, [subdomain, title, description, authType, emails, password, selectedOutputBlock, originalValues])

  // Set up event listener for manual form submission
  useEffect(() => {
    const handleManualSubmit = () => {
      // Log current state
      logger.info('Manual submit triggered with output selection:', {
        selectedOutputBlock,
        hasSelection: !!selectedOutputBlock
      })
      
      // Delay to ensure all state updates are processed
      setTimeout(() => {
        // Pass the current state values directly to handleSubmit
        handleSubmit()
      }, 100)
    }

    // Add event listener to document for manual-submit
    document.addEventListener('manual-submit', handleManualSubmit)

    // Clean up the event listener when component unmounts
    return () => {
      document.removeEventListener('manual-submit', handleManualSubmit)
    }
  }, [selectedOutputBlock]) // Add selectedOutputBlock to dependencies

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
              outputBlockId: chatDetail.outputBlockId || null
            })

            // Set emails if using email auth
            if (chatDetail.authType === 'email' && Array.isArray(chatDetail.allowedEmails)) {
              setEmails(chatDetail.allowedEmails)
            }

            // For security, we don't populate password - user will need to enter a new one if changing it

            // Inside the fetchExistingChat function - after loading other form values
            if (chatDetail.outputBlockId && chatDetail.outputPath) {
              const combinedOutputId = `${chatDetail.outputBlockId}_${chatDetail.outputPath}`
              setSelectedOutputBlock(combinedOutputId)
            }
          } else {
            logger.error('Failed to fetch chat details')
          }
        } else {
          setExistingChat(null)
          setOriginalValues(null)
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

  // Validate subdomain format on input change
  const handleSubdomainChange = (value: string) => {
    const lowercaseValue = value.toLowerCase()
    setSubdomain(lowercaseValue)

    // Validate subdomain format
    if (lowercaseValue && !/^[a-z0-9-]+$/.test(lowercaseValue)) {
      setSubdomainError('Subdomain can only contain lowercase letters, numbers, and hyphens')
    } else {
      setSubdomainError('')
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
    setShowPassword(false)
  }

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(text)
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

    // Log all relevant values to debug
    logger.info('Form submission triggered with values:', { 
      subdomain,
      title,
      authType,
      hasOutputBlockSelection: !!selectedOutputBlock,
      selectedOutputBlock,
      hasSelectedOutput: selectedOutputBlock !== null && selectedOutputBlock !== undefined && selectedOutputBlock.length > 0,
      outputBlockDetails: selectedOutputBlock ? {
        firstUnderscoreIndex: selectedOutputBlock.indexOf('_'),
        blockId: selectedOutputBlock.includes('_') ? selectedOutputBlock.split('_')[0] : null,
        path: selectedOutputBlock.includes('_') ? selectedOutputBlock.split('_')[1] : null
      } : null
    })

    if (!workflowId || !subdomain.trim() || !title.trim()) {
      logger.error('Missing required fields', { workflowId, subdomain, title })
      return
    }

    // Verify output selection if it's set
    if (selectedOutputBlock) {
      const firstUnderscoreIndex = selectedOutputBlock.indexOf('_')
      if (firstUnderscoreIndex === -1) {
        logger.error('Invalid output block format', { selectedOutputBlock })
        setErrorMessage('Invalid output block format. Please select a valid output.')
        return
      }
    }

    if (subdomainError) {
      return
    }

    // Validate authentication options
    if (authType === 'password' && !password.trim() && !existingChat) {
      setErrorMessage('Password is required when using password protection')
      return
    }

    if (authType === 'email' && emails.length === 0) {
      setErrorMessage('At least one email or domain is required when using email access control')
      return
    }

    // If editing an existing chat, check if we should show confirmation
    if (existingChat && existingChat.isActive) {
      const majorChanges =
        subdomain !== existingChat.subdomain ||
        authType !== existingChat.authType ||
        (authType === 'email' &&
          JSON.stringify(emails) !== JSON.stringify(existingChat.allowedEmails))

      if (majorChanges) {
        setShowEditConfirmation(true)
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
      setIsDeploying(true)

      // Create request payload
      const payload: any = {
        workflowId,
        subdomain: subdomain.trim(),
        title: title.trim(),
        description: description.trim(),
        customizations: {
          primaryColor: '#802FFF',
          welcomeMessage: 'Hi there! How can I help you today?',
        },
        authType,
      }

      // Add authentication options based on type
      if (authType === 'password' && password) {
        payload.password = password
      }

      if (authType === 'email') {
        payload.allowedEmails = emails
      }

      // Add output block configuration if selected
      if (selectedOutputBlock) {
        const firstUnderscoreIndex = selectedOutputBlock.indexOf('_')
        if (firstUnderscoreIndex !== -1) {
          const blockId = selectedOutputBlock.substring(0, firstUnderscoreIndex)
          const path = selectedOutputBlock.substring(firstUnderscoreIndex + 1)
          
          // Make sure to set these as explicit strings, not undefined
          payload.outputBlockId = blockId || ""
          payload.outputPath = path || ""
          
          // Debug log to verify output configuration
          logger.info('Added output configuration to payload:', { 
            selectedOutput: selectedOutputBlock,
            outputBlockId: blockId, 
            outputPath: path,
            payloadBlockId: payload.outputBlockId,
            payloadPath: payload.outputPath
          })
        } else {
          logger.warn('Selected output block has invalid format:', selectedOutputBlock)
          // Even with invalid format, ensure fields are set
          payload.outputBlockId = ""
          payload.outputPath = ""
        }
      } else if (existingChat && existingChat.outputBlockId && existingChat.outputPath) {
        // If editing and there was previously an output block but it's now unselected,
        // explicitly set to null (not undefined) to clear the values
        payload.outputBlockId = null
        payload.outputPath = null
        logger.info('Clearing existing output configuration')
      } else {
        // No output block selected and none existed before
        payload.outputBlockId = null
        payload.outputPath = null
        logger.info('No output block selected')
      }

      // Pass the API key from workflow deployment
      if (deploymentInfo?.apiKey) {
        payload.apiKey = deploymentInfo.apiKey
      }

      // Make API request - different endpoints for create vs update
      let endpoint = '/api/chat'
      let method = 'POST'

      // If updating existing chat, use the edit/ID endpoint with PATCH method
      if (existingChat && existingChat.id) {
        endpoint = `/api/chat/edit/${existingChat.id}`
        method = 'PATCH'
      }

      // Validate with Zod
      try {
        chatSchema.parse(payload)
      } catch (validationError: any) {
        if (validationError instanceof z.ZodError) {
          const errorMessage = validationError.errors[0]?.message || 'Invalid form data'
          setErrorMessage(errorMessage)
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
      } else {
        throw new Error('Response missing chatUrl')
      }
    } catch (error: any) {
      logger.error(`Failed to ${existingChat ? 'update' : 'deploy'} chat:`, error)
      setErrorMessage(error.message || 'An unexpected error occurred')
      addNotification('error', `Failed to deploy chat: ${error.message}`, workflowId)
    } finally {
      setIsDeploying(false)
      setShowEditConfirmation(false)
    }
  }

  // Determine button label based on state
  const getSubmitButtonLabel = () => {
    if (isDeploying) {
      return existingChat ? 'Updating...' : 'Deploying...'
    }
    return existingChat ? 'Update Chat' : 'Deploy Chat'
  }

  // Check if form submission is possible
  const isFormSubmitDisabled = () => {
    return (
      isDeploying ||
      isDeleting ||
      !subdomain ||
      !title ||
      !!subdomainError ||
      (authType === 'password' && !password && !existingChat) ||
      (authType === 'email' && emails.length === 0) ||
      (existingChat && !hasChanges)
    )
  }

  if (isLoading) {
    return (
      <div className="py-4 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Loading chat information...</p>
      </div>
    )
  }

  if (deployedChatUrl) {
    // Success view
    return (
      <div className="space-y-4">
        <Card className="border-green-200 bg-green-50 dark:border-green-900 dark:bg-green-900/20">
          <CardContent className="p-6 text-green-800 dark:text-green-400">
            <h3 className="text-base font-medium mb-2">
              Chat {existingChat ? 'Update' : 'Deployment'} Successful
            </h3>
            <p className="mb-3">Your chat is now available at:</p>
            <div className="bg-white/50 dark:bg-gray-900/50 p-3 rounded-md border border-green-200 dark:border-green-900/50">
              <a
                href={deployedChatUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-sm font-medium text-primary underline break-all block"
              >
                {deployedChatUrl}
              </a>
            </div>
          </CardContent>
        </Card>

        <div className="space-y-3 p-4 bg-muted/30 rounded-lg">
          <h4 className="font-medium">Next Steps</h4>
          <ul className="space-y-2 list-disc list-inside text-muted-foreground">
            <li>Share this URL with your users</li>
            <li>Visit the URL to test your chat</li>
            <li>Manage your chats from the Deployments page</li>
          </ul>
        </div>
      </div>
    )
  }

  // Form view
  return (
    <>
      <form onSubmit={(e) => {
        e.preventDefault() // Prevent default form submission
        handleSubmit(e)
      }} className="space-y-4 chat-deploy-form">
        <div className="grid gap-4">
          {errorMessage && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>{errorMessage}</AlertDescription>
            </Alert>
          )}

          <div className="space-y-4">
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="subdomain" className="text-sm font-medium">
                  Subdomain
                </Label>
                <div className="flex items-center">
                  <Input
                    id="subdomain"
                    placeholder="company-name"
                    value={subdomain}
                    onChange={(e) => handleSubdomainChange(e.target.value)}
                    required
                    className="rounded-r-none border-r-0"
                    disabled={isDeploying}
                  />
                  <div className="h-10 px-3 flex items-center border rounded-r-md bg-muted text-muted-foreground text-sm font-medium whitespace-nowrap">
                    {isDevelopment ? '.localhost:3000' : '.simstudio.ai'}
                  </div>
                </div>
                {subdomainError && (
                  <p className="text-sm text-destructive mt-1">{subdomainError}</p>
                )}
              </div>

              <div className="space-y-2">
                <Label htmlFor="title" className="text-sm font-medium">
                  Chat Title
                </Label>
                <Input
                  id="title"
                  placeholder="Customer Support Assistant"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                  disabled={isDeploying}
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="description" className="text-sm font-medium">
                Description (Optional)
              </Label>
              <Textarea
                id="description"
                placeholder="A brief description of what this chat does"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                rows={3}
                disabled={isDeploying}
              />
            </div>
          </div>

          {/* Output Configuration - moved above Access Control */}
          <div className="space-y-3">
            <div>
              <Label className="text-sm font-medium">Output Configuration</Label>
            </div>
            
            <Card className="border-border/40">
              <CardContent className="p-4 space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Output Block</h3>
                  <p className="text-xs text-muted-foreground mb-2">
                    Select which block's output to return to the user in the chat interface.
                  </p>
                  <div className="block w-full">
                    <OutputSelect
                      workflowId={workflowId}
                      selectedOutput={selectedOutputBlock}
                      onOutputSelect={(value) => {
                        // Just update the state, don't trigger form submission
                        logger.info(`Output block selection changed to: ${value}`)
                        
                        if (value) {
                          const firstUnderscoreIndex = value.indexOf('_')
                          if (firstUnderscoreIndex !== -1) {
                            const blockId = value.substring(0, firstUnderscoreIndex)
                            const path = value.substring(firstUnderscoreIndex + 1)
                            logger.info(`Parsed output selection - blockId: ${blockId}, path: ${path}`)
                          }
                        }
                        
                        setSelectedOutputBlock(value)
                        
                        // Mark as changed to enable update button
                        if (existingChat) {
                          setHasChanges(true)
                        }
                      }}
                      placeholder="Select which block output to use"
                      disabled={isDeploying}
                    />
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Authentication Options */}
          <div className="space-y-3">
            <div>
              <Label className="text-sm font-medium">Access Control</Label>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Card
                className={cn(
                  'cursor-pointer overflow-hidden border transition-colors hover:border-primary/50',
                  authType === 'public' ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                <CardContent className="p-4 flex flex-col items-center text-center space-y-2 relative">
                  <button 
                    type="button" 
                    className="w-full h-full absolute inset-0 cursor-pointer z-10" 
                    onClick={() => !isDeploying && setAuthType('public')}
                    aria-label="Select public access"
                  />
                  <div className="h-5 w-5 flex items-center justify-center mb-1 relative z-0">
                    {authType === 'public' ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="relative z-0">
                    <h3 className="font-medium text-sm">Public Access</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Anyone can access your chat
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={cn(
                  'cursor-pointer overflow-hidden border transition-colors hover:border-primary/50',
                  authType === 'password' ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                <CardContent className="p-4 flex flex-col items-center text-center space-y-2 relative">
                  <button 
                    type="button" 
                    className="w-full h-full absolute inset-0 cursor-pointer z-10" 
                    onClick={() => !isDeploying && setAuthType('password')}
                    aria-label="Select password protected access"
                  />
                  <div className="h-5 w-5 flex items-center justify-center mb-1 relative z-0">
                    {authType === 'password' ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="relative z-0">
                    <h3 className="font-medium text-sm">Password Protected</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Secure with a single password
                    </p>
                  </div>
                </CardContent>
              </Card>

              <Card
                className={cn(
                  'cursor-pointer overflow-hidden border transition-colors hover:border-primary/50',
                  authType === 'email' ? 'border-primary bg-primary/5' : 'border-border'
                )}
              >
                <CardContent className="p-4 flex flex-col items-center text-center space-y-2 relative">
                  <button 
                    type="button" 
                    className="w-full h-full absolute inset-0 cursor-pointer z-10" 
                    onClick={() => !isDeploying && setAuthType('email')}
                    aria-label="Select email access"
                  />
                  <div className="h-5 w-5 flex items-center justify-center mb-1 relative z-0">
                    {authType === 'email' ? (
                      <Check className="h-4 w-4 text-primary" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                  </div>
                  <div className="relative z-0">
                    <h3 className="font-medium text-sm">Email Access</h3>
                    <p className="text-xs text-muted-foreground mt-1">
                      Restrict to specific emails
                    </p>
                  </div>
                </CardContent>
              </Card>
            </div>

            {/* Auth settings */}
            <div className="min-h-[180px]">
              {authType === 'password' && (
                <Card className="border-border/40">
                  <CardContent className="p-4 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-sm font-medium">Password Settings</h3>
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={generatePassword}
                        disabled={isDeploying}
                        className="h-8"
                      >
                        <RefreshCw className="h-3.5 w-3.5 mr-1.5" />
                        Generate Password
                      </Button>
                    </div>
                    <div className="relative">
                      {/* Add visual password indicator for existing passwords */}
                      {existingChat && existingChat.authType === 'password' && !password && (
                        <div className="mb-2 text-xs flex items-center text-muted-foreground">
                          <div className="mr-2 bg-primary/10 text-primary font-medium rounded-full px-2 py-0.5">
                            Password set
                          </div>
                          <span>Current password is securely stored</span>
                        </div>
                      )}
                      <div className="relative">
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
                          className="pr-20"
                          required={!existingChat && authType === 'password'}
                        />
                        <div className="absolute right-0 top-0 h-full flex">
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => copyToClipboard(password)}
                            disabled={!password || isDeploying}
                            className="px-2"
                          >
                            <Copy className="h-4 w-4" />
                            <span className="sr-only">Copy password</span>
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => setShowPassword(!showPassword)}
                            disabled={isDeploying}
                            className="px-2"
                          >
                            {showPassword ? (
                              <EyeOff className="h-4 w-4" />
                            ) : (
                              <Eye className="h-4 w-4" />
                            )}
                            <span className="sr-only">
                              {showPassword ? 'Hide password' : 'Show password'}
                            </span>
                          </Button>
                        </div>
                      </div>
                    </div>
                    {/* Add helper text to explain password behavior */}
                    <p className="text-xs text-muted-foreground italic mt-1">
                      {existingChat && existingChat.authType === 'password'
                        ? 'Leaving this empty will keep the current password. Enter a new password to change it.'
                        : 'This password will be required to access your chat.'}
                    </p>
                  </CardContent>
                </Card>
              )}

              {authType === 'email' && (
                <Card className="border-border/40">
                  <CardContent className="p-4 space-y-4">
                    <div>
                      <h3 className="text-sm font-medium mb-2">Email Access Settings</h3>
                      <p className="text-xs text-muted-foreground">
                        Add specific emails or entire domains (@example.com)
                      </p>
                    </div>

                    <div className="flex gap-2">
                      <Input
                        placeholder="user@example.com or @domain.com"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                        disabled={isDeploying}
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        size="sm"
                        onClick={handleAddEmail}
                        disabled={!newEmail.trim() || isDeploying}
                        className="shrink-0"
                      >
                        <Plus className="h-4 w-4 mr-1" />
                        Add
                      </Button>
                    </div>

                    {emailError && <p className="text-sm text-destructive">{emailError}</p>}

                    {emails.length > 0 && (
                      <div className="bg-muted/50 rounded-lg border border-muted p-3 max-h-[100px] overflow-y-auto">
                        <ul className="space-y-2 divide-y divide-border/40">
                          {emails.map((email) => (
                            <li
                              key={email}
                              className="flex justify-between items-center py-1.5 text-sm"
                            >
                              <span className="font-medium">{email}</span>
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                onClick={() => handleRemoveEmail(email)}
                                disabled={isDeploying}
                                className="h-6 w-6 text-muted-foreground hover:text-destructive"
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </CardContent>
                </Card>
              )}

              {authType === 'public' && (
                <Card className="border-border/40">
                  <CardContent className="p-4 space-y-4">
                    <div>
                      <h3 className="text-sm font-medium mb-2">Public Access Settings</h3>
                      <p className="text-xs text-muted-foreground">
                        This chat will be publicly accessible to anyone with the link.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </div>
      </form>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteConfirmation} onOpenChange={setShowDeleteConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently delete your chat deployment at{' '}
              <span className="font-mono text-destructive">{subdomain}.simstudio.ai</span>.
              <p className="mt-2">
                All users will lose access immediately, and this action cannot be undone.
              </p>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeleting}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              disabled={isDeleting}
              className="bg-destructive hover:bg-destructive/90"
            >
              {isDeleting ? (
                <span className="flex items-center">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Deleting...
                </span>
              ) : (
                'Delete'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Edit Confirmation Dialog */}
      <AlertDialog open={showEditConfirmation} onOpenChange={setShowEditConfirmation}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Update Active Chat?</AlertDialogTitle>
            <AlertDialogDescription>
              You are about to change an active chat deployment. These changes will immediately
              affect all users of your chat.
              {subdomain !== existingChat?.subdomain && (
                <p className="mt-2 font-medium">
                  The URL of your chat will change, and any links to the old URL will stop working.
                </p>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={isDeploying}>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => deployOrUpdateChat()} disabled={isDeploying}>
              {isDeploying ? (
                <span className="flex items-center">
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Updating...
                </span>
              ) : (
                'Update Chat'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
