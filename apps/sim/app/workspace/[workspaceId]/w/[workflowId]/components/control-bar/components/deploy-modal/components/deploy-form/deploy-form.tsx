'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Copy, Loader2, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import {
  AlertDialog,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

const logger = createLogger('DeployForm')

interface ApiKey {
  id: string
  name: string
  key: string
  displayKey?: string
  lastUsed?: string
  createdAt: string
  expiresAt?: string
  createdBy?: string
}

interface ApiKeysData {
  workspace: ApiKey[]
  personal: ApiKey[]
  conflicts: string[]
}

// Form schema for API key selection or creation
const deployFormSchema = z.object({
  apiKey: z.string().min(1, 'Please select an API key'),
  newKeyName: z.string().optional(),
})

type DeployFormValues = z.infer<typeof deployFormSchema>

interface DeployFormProps {
  apiKeys: ApiKey[] // Legacy prop for backward compatibility
  keysLoaded: boolean
  onSubmit: (data: DeployFormValues) => void
  onApiKeyCreated?: () => void
  // Optional id to bind an external submit button via the `form` attribute
  formId?: string
}

export function DeployForm({
  apiKeys,
  keysLoaded,
  onSubmit,
  onApiKeyCreated,
  formId,
}: DeployFormProps) {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const userPermissions = useUserPermissionsContext()
  const canCreateWorkspaceKeys = userPermissions.canEdit || userPermissions.canAdmin

  // State
  const [apiKeysData, setApiKeysData] = useState<ApiKeysData | null>(null)
  const [isCreatingKey, setIsCreatingKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [keyType, setKeyType] = useState<'personal' | 'workspace'>('personal')
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [keysLoaded2, setKeysLoaded2] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [justCreatedKeyId, setJustCreatedKeyId] = useState<string | null>(null)

  // Get all available API keys (workspace + personal)
  const allApiKeys = apiKeysData ? [...apiKeysData.workspace, ...apiKeysData.personal] : apiKeys

  // Initialize form with react-hook-form
  const form = useForm<DeployFormValues>({
    resolver: zodResolver(deployFormSchema),
    defaultValues: {
      apiKey: allApiKeys.length > 0 ? allApiKeys[0].id : '',
      newKeyName: '',
    },
  })

  // Fetch workspace and personal API keys
  const fetchApiKeys = async () => {
    if (!workspaceId) return

    try {
      setKeysLoaded2(false)
      const [workspaceResponse, personalResponse] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/api-keys`),
        fetch('/api/users/me/api-keys'),
      ])

      let workspaceKeys: ApiKey[] = []
      let personalKeys: ApiKey[] = []

      if (workspaceResponse.ok) {
        const workspaceData = await workspaceResponse.json()
        workspaceKeys = workspaceData.keys || []
      } else {
        logger.error('Error fetching workspace API keys:', { status: workspaceResponse.status })
      }

      if (personalResponse.ok) {
        const personalData = await personalResponse.json()
        personalKeys = personalData.keys || []
      } else {
        logger.error('Error fetching personal API keys:', { status: personalResponse.status })
      }

      // Client-side conflict detection
      const workspaceKeyNames = new Set(workspaceKeys.map((k) => k.name))
      const conflicts = personalKeys
        .filter((key) => workspaceKeyNames.has(key.name))
        .map((key) => key.name)

      setApiKeysData({
        workspace: workspaceKeys,
        personal: personalKeys,
        conflicts,
      })
      setKeysLoaded2(true)
    } catch (error) {
      logger.error('Error fetching API keys:', { error })
      setKeysLoaded2(true)
    }
  }

  // Update on dependency changes beyond the initial load
  useEffect(() => {
    if (workspaceId) {
      fetchApiKeys()
    }
  }, [workspaceId])

  useEffect(() => {
    if ((keysLoaded || keysLoaded2) && allApiKeys.length > 0) {
      const currentValue = form.getValues().apiKey

      // If we just created a key, prioritize selecting it
      if (justCreatedKeyId && allApiKeys.find((key) => key.id === justCreatedKeyId)) {
        form.setValue('apiKey', justCreatedKeyId)
        setJustCreatedKeyId(null) // Clear after setting
      }
      // Otherwise, ensure form has a value if it doesn't already
      else if (!currentValue || !allApiKeys.find((key) => key.id === currentValue)) {
        form.setValue('apiKey', allApiKeys[0].id)
      }
    }
  }, [keysLoaded, keysLoaded2, allApiKeys, form, justCreatedKeyId])

  // Generate a new API key
  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return

    // Client-side duplicate check for immediate feedback
    const trimmedName = newKeyName.trim()
    const isDuplicate =
      keyType === 'workspace'
        ? (apiKeysData?.workspace || []).some((k) => k.name === trimmedName)
        : (apiKeysData?.personal || apiKeys || []).some((k) => k.name === trimmedName)
    if (isDuplicate) {
      setCreateError(
        keyType === 'workspace'
          ? `A workspace API key named "${trimmedName}" already exists. Please choose a different name.`
          : `A personal API key named "${trimmedName}" already exists. Please choose a different name.`
      )
      return
    }

    setIsSubmittingCreate(true)
    setCreateError(null)
    try {
      const url =
        keyType === 'workspace'
          ? `/api/workspaces/${workspaceId}/api-keys`
          : '/api/users/me/api-keys'

      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: newKeyName.trim(),
        }),
      })

      if (response.ok) {
        const data = await response.json()
        // Show the new key dialog with the API key (only shown once)
        setNewKey(data.key)
        setShowNewKeyDialog(true)
        // Reset form and close the create dialog ONLY on success
        setNewKeyName('')
        setKeyType('personal')
        setCreateError(null)
        setIsCreatingKey(false)

        // Store the newly created key ID for auto-selection
        setJustCreatedKeyId(data.key.id)

        // Refresh the keys list - the useEffect will handle auto-selection
        await fetchApiKeys()

        // Trigger a refresh of the keys list in the parent component
        if (onApiKeyCreated) {
          onApiKeyCreated()
        }
      } else {
        let errorData
        try {
          errorData = await response.json()
        } catch (parseError) {
          errorData = { error: 'Server error' }
        }
        // Check for duplicate name error and prefer server message
        const serverMessage = typeof errorData?.error === 'string' ? errorData.error : null
        if (response.status === 409 || serverMessage?.toLowerCase().includes('already exists')) {
          setCreateError(
            serverMessage ||
              (keyType === 'workspace'
                ? `A workspace API key named "${trimmedName}" already exists. Please choose a different name.`
                : `A personal API key named "${trimmedName}" already exists. Please choose a different name.`)
          )
        } else {
          setCreateError(errorData.error || 'Failed to create API key. Please try again.')
        }
        logger.error('Failed to create API key:', errorData)
      }
    } catch (error) {
      setCreateError('Failed to create API key. Please check your connection and try again.')
      logger.error('Error creating API key:', { error })
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  // Copy API key to clipboard
  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  return (
    <Form {...form}>
      <form
        id={formId}
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(form.getValues())
        }}
        className='space-y-6'
      >
        {/* API Key selection */}
        <FormField
          control={form.control}
          name='apiKey'
          render={({ field }) => (
            <FormItem className='space-y-1.5'>
              <div className='flex items-center justify-between'>
                <FormLabel className='font-medium text-sm'>Select API Key</FormLabel>
                <Button
                  type='button'
                  variant='ghost'
                  size='sm'
                  className='h-7 gap-1 px-2 text-muted-foreground text-xs'
                  onClick={() => {
                    setIsCreatingKey(true)
                    setCreateError(null)
                  }}
                >
                  <Plus className='h-3.5 w-3.5' />
                  <span>Create new</span>
                </Button>
              </div>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className={!keysLoaded ? 'opacity-70' : ''}>
                    {!keysLoaded ? (
                      <div className='flex items-center space-x-2'>
                        <Loader2 className='h-3.5 w-3.5 animate-spin' />
                        <span>Loading API keys...</span>
                      </div>
                    ) : (
                      <SelectValue placeholder='Select an API key' className='text-sm' />
                    )}
                  </SelectTrigger>
                </FormControl>
                <SelectContent align='start' className='w-[var(--radix-select-trigger-width)] py-1'>
                  {apiKeysData && apiKeysData.workspace.length > 0 && (
                    <SelectGroup>
                      <SelectLabel className='px-3 py-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                        Workspace
                      </SelectLabel>
                      {apiKeysData.workspace.map((apiKey) => (
                        <SelectItem
                          key={apiKey.id}
                          value={apiKey.id}
                          className='my-0.5 flex cursor-pointer items-center rounded-sm px-3 py-2.5 data-[state=checked]:bg-muted [&>span.absolute]:hidden'
                        >
                          <div className='flex w-full items-center'>
                            <div className='flex w-full items-center justify-between'>
                              <span className='mr-2 truncate text-sm'>{apiKey.name}</span>
                              <span className='mt-[1px] flex-shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs'>
                                {apiKey.displayKey || apiKey.key}
                              </span>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {((apiKeysData && apiKeysData.personal.length > 0) ||
                    (!apiKeysData && apiKeys.length > 0)) && (
                    <SelectGroup>
                      <SelectLabel className='px-3 py-1.5 font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                        Personal
                      </SelectLabel>
                      {(apiKeysData ? apiKeysData.personal : apiKeys).map((apiKey) => (
                        <SelectItem
                          key={apiKey.id}
                          value={apiKey.id}
                          className='my-0.5 flex cursor-pointer items-center rounded-sm px-3 py-2.5 data-[state=checked]:bg-muted [&>span.absolute]:hidden'
                        >
                          <div className='flex w-full items-center'>
                            <div className='flex w-full items-center justify-between'>
                              <span className='mr-2 truncate text-sm'>{apiKey.name}</span>
                              <span className='mt-[1px] flex-shrink-0 rounded bg-muted px-1.5 py-0.5 font-mono text-muted-foreground text-xs'>
                                {apiKey.displayKey || apiKey.key}
                              </span>
                            </div>
                          </div>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  )}

                  {!apiKeysData && apiKeys.length === 0 && (
                    <div className='px-3 py-2 text-muted-foreground text-sm'>
                      No API keys available
                    </div>
                  )}

                  {apiKeysData &&
                    apiKeysData.workspace.length === 0 &&
                    apiKeysData.personal.length === 0 && (
                      <div className='px-3 py-2 text-muted-foreground text-sm'>
                        No API keys available
                      </div>
                    )}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Create API Key Dialog */}
        <AlertDialog open={isCreatingKey} onOpenChange={setIsCreatingKey}>
          <AlertDialogContent className='rounded-[10px] sm:max-w-md'>
            <AlertDialogHeader>
              <AlertDialogTitle>Create new API key</AlertDialogTitle>
              <AlertDialogDescription>
                {keyType === 'workspace'
                  ? "This key will have access to all workflows in this workspace. Make sure to copy it after creation as you won't be able to see it again."
                  : "This key will have access to your personal workflows. Make sure to copy it after creation as you won't be able to see it again."}
              </AlertDialogDescription>
            </AlertDialogHeader>

            <div className='space-y-4 py-2'>
              {canCreateWorkspaceKeys && (
                <div className='space-y-2'>
                  <p className='font-[360] text-sm'>API Key Type</p>
                  <div className='flex gap-2'>
                    <Button
                      type='button'
                      variant={keyType === 'personal' ? 'default' : 'outline'}
                      size='sm'
                      onClick={() => {
                        setKeyType('personal')
                        if (createError) setCreateError(null)
                      }}
                      className='h-8 data-[variant=outline]:border-border data-[variant=outline]:bg-background data-[variant=outline]:text-foreground data-[variant=outline]:hover:bg-muted dark:data-[variant=outline]:border-border dark:data-[variant=outline]:bg-background dark:data-[variant=outline]:text-foreground dark:data-[variant=outline]:hover:bg-muted/80'
                    >
                      Personal
                    </Button>
                    <Button
                      type='button'
                      variant={keyType === 'workspace' ? 'default' : 'outline'}
                      size='sm'
                      onClick={() => {
                        setKeyType('workspace')
                        if (createError) setCreateError(null)
                      }}
                      className='h-8 data-[variant=outline]:border-border data-[variant=outline]:bg-background data-[variant=outline]:text-foreground data-[variant=outline]:hover:bg-muted dark:data-[variant=outline]:border-border dark:data-[variant=outline]:bg-background dark:data-[variant=outline]:text-foreground dark:data-[variant=outline]:hover:bg-muted/80'
                    >
                      Workspace
                    </Button>
                  </div>
                </div>
              )}
              <div className='space-y-2'>
                <p className='font-[360] text-sm'>
                  Enter a name for your API key to help you identify it later.
                </p>
                <Input
                  value={newKeyName}
                  onChange={(e) => {
                    setNewKeyName(e.target.value)
                    if (createError) setCreateError(null) // Clear error when user types
                  }}
                  placeholder='e.g., Development, Production'
                  className='h-9 rounded-[8px]'
                  autoFocus
                />
                {createError && <div className='text-red-600 text-sm'>{createError}</div>}
              </div>
            </div>

            <AlertDialogFooter className='flex'>
              <AlertDialogCancel
                className='h-9 w-full rounded-[8px] border-border bg-background text-foreground hover:bg-muted dark:border-border dark:bg-background dark:text-foreground dark:hover:bg-muted/80'
                onClick={() => {
                  setNewKeyName('')
                  setKeyType('personal')
                  setCreateError(null)
                }}
              >
                Cancel
              </AlertDialogCancel>
              <Button
                type='button'
                onClick={handleCreateKey}
                className='h-9 w-full rounded-[8px] bg-primary text-white hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50'
                disabled={
                  !newKeyName.trim() ||
                  isSubmittingCreate ||
                  (keyType === 'workspace' && !canCreateWorkspaceKeys)
                }
              >
                {isSubmittingCreate ? (
                  <>
                    <Loader2 className='mr-1.5 h-3.5 w-3.5 animate-spin' />
                    Creating...
                  </>
                ) : (
                  `Create ${keyType === 'workspace' ? 'Workspace' : 'Personal'} Key`
                )}
              </Button>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        {/* New API Key Dialog */}
        <AlertDialog
          open={showNewKeyDialog}
          onOpenChange={(open) => {
            setShowNewKeyDialog(open)
            if (!open) {
              setNewKey(null)
              setCopySuccess(false)
            }
          }}
        >
          <AlertDialogContent className='rounded-[10px] sm:max-w-md'>
            <AlertDialogHeader>
              <AlertDialogTitle>Your API key has been created</AlertDialogTitle>
              <AlertDialogDescription>
                This is the only time you will see your API key.{' '}
                <span className='font-semibold'>Copy it now and store it securely.</span>
              </AlertDialogDescription>
            </AlertDialogHeader>

            {newKey && (
              <div className='relative'>
                <div className='flex h-9 items-center rounded-[6px] border-none bg-muted px-3 pr-10'>
                  <code className='flex-1 truncate font-mono text-foreground text-sm'>
                    {newKey.key}
                  </code>
                </div>
                <Button
                  variant='ghost'
                  size='icon'
                  className='-translate-y-1/2 absolute top-1/2 right-1 h-7 w-7 rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground'
                  onClick={() => copyToClipboard(newKey.key)}
                >
                  {copySuccess ? (
                    <Check className='h-3.5 w-3.5' />
                  ) : (
                    <Copy className='h-3.5 w-3.5' />
                  )}
                  <span className='sr-only'>Copy to clipboard</span>
                </Button>
              </div>
            )}
          </AlertDialogContent>
        </AlertDialog>
      </form>
    </Form>
  )
}
