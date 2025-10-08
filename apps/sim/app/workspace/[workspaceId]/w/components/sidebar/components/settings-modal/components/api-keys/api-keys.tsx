'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
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
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

const logger = createLogger('ApiKeys')

interface ApiKeysProps {
  onOpenChange?: (open: boolean) => void
  registerCloseHandler?: (handler: (open: boolean) => void) => void
}

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

interface ApiKeyDisplayProps {
  apiKey: ApiKey
}

function ApiKeyDisplay({ apiKey }: ApiKeyDisplayProps) {
  const displayValue = apiKey.displayKey || apiKey.key
  return (
    <div className='flex h-8 items-center rounded-[8px] bg-muted px-3'>
      <code className='font-mono text-foreground text-xs'>{displayValue}</code>
    </div>
  )
}

export function ApiKeys({ onOpenChange, registerCloseHandler }: ApiKeysProps) {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canEdit || userPermissions.canAdmin

  // State for both workspace and personal keys
  const [workspaceKeys, setWorkspaceKeys] = useState<ApiKey[]>([])
  const [personalKeys, setPersonalKeys] = useState<ApiKey[]>([])
  const [conflicts, setConflicts] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')
  const [keyType, setKeyType] = useState<'personal' | 'workspace'>('personal')
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)

  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const filteredWorkspaceKeys = useMemo(() => {
    if (!searchTerm.trim()) {
      return workspaceKeys.map((key, index) => ({ key, originalIndex: index }))
    }
    return workspaceKeys
      .map((key, index) => ({ key, originalIndex: index }))
      .filter(({ key }) => key.name.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [workspaceKeys, searchTerm])

  const filteredPersonalKeys = useMemo(() => {
    if (!searchTerm.trim()) {
      return personalKeys.map((key, index) => ({ key, originalIndex: index }))
    }
    return personalKeys
      .map((key, index) => ({ key, originalIndex: index }))
      .filter(({ key }) => key.name.toLowerCase().includes(searchTerm.toLowerCase()))
  }, [personalKeys, searchTerm])

  const personalHeaderMarginClass = useMemo(() => {
    if (!searchTerm.trim()) return 'mt-8'
    return filteredWorkspaceKeys.length > 0 ? 'mt-8' : 'mt-0'
  }, [searchTerm, filteredWorkspaceKeys])

  const fetchApiKeys = async () => {
    if (!userId || !workspaceId) return

    setIsLoading(true)
    try {
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
        logger.error('Failed to fetch workspace API keys:', { status: workspaceResponse.status })
      }

      if (personalResponse.ok) {
        const personalData = await personalResponse.json()
        personalKeys = personalData.keys || []
      } else {
        logger.error('Failed to fetch personal API keys:', { status: personalResponse.status })
      }

      // Client-side conflict detection
      const workspaceKeyNames = new Set(workspaceKeys.map((k) => k.name))
      const conflicts = personalKeys
        .filter((key) => workspaceKeyNames.has(key.name))
        .map((key) => key.name)

      setWorkspaceKeys(workspaceKeys)
      setPersonalKeys(personalKeys)
      setConflicts(conflicts)
    } catch (error) {
      logger.error('Error fetching API keys:', { error })
    } finally {
      setIsLoading(false)
    }
  }

  const handleCreateKey = async () => {
    if (!userId || !newKeyName.trim()) return

    const trimmedName = newKeyName.trim()
    const isDuplicate =
      keyType === 'workspace'
        ? workspaceKeys.some((k) => k.name === trimmedName)
        : personalKeys.some((k) => k.name === trimmedName)
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
        setNewKey(data.key)
        setShowNewKeyDialog(true)
        fetchApiKeys()
        setNewKeyName('')
        setKeyType('personal')
        setCreateError(null)
        setIsSubmittingCreate(false)
        setIsCreateDialogOpen(false)
      } else {
        let errorData
        try {
          errorData = await response.json()
        } catch (parseError) {
          logger.error('Error parsing API response:', parseError)
          errorData = { error: 'Server error' }
        }

        logger.error('API key creation failed:', { status: response.status, errorData })

        const serverMessage = typeof errorData?.error === 'string' ? errorData.error : null
        if (response.status === 409 || serverMessage?.toLowerCase().includes('already exists')) {
          const errorMessage =
            serverMessage ||
            (keyType === 'workspace'
              ? `A workspace API key named "${trimmedName}" already exists. Please choose a different name.`
              : `A personal API key named "${trimmedName}" already exists. Please choose a different name.`)
          logger.error('Setting error message:', errorMessage)
          setCreateError(errorMessage)
        } else {
          setCreateError(errorData.error || 'Failed to create API key. Please try again.')
        }
      }
    } catch (error) {
      setCreateError('Failed to create API key. Please check your connection and try again.')
      logger.error('Error creating API key:', { error })
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  const handleDeleteKey = async () => {
    if (!userId || !deleteKey) return

    try {
      const isWorkspaceKey = workspaceKeys.some((k) => k.id === deleteKey.id)
      const url = isWorkspaceKey
        ? `/api/workspaces/${workspaceId}/api-keys/${deleteKey.id}`
        : `/api/users/me/api-keys/${deleteKey.id}`

      const response = await fetch(url, {
        method: 'DELETE',
      })

      if (response.ok) {
        fetchApiKeys()
        setShowDeleteDialog(false)
        setDeleteKey(null)
        setDeleteConfirmationName('')
      } else {
        const errorData = await response.json()
        logger.error('Failed to delete API key:', errorData)
      }
    } catch (error) {
      logger.error('Error deleting API key:', { error })
    }
  }

  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  const handleModalClose = (open: boolean) => {
    onOpenChange?.(open)
  }

  useEffect(() => {
    if (userId && workspaceId) {
      fetchApiKeys()
    }
  }, [userId, workspaceId])

  useEffect(() => {
    if (registerCloseHandler) {
      registerCloseHandler(handleModalClose)
    }
  }, [registerCloseHandler])

  useEffect(() => {
    if (shouldScrollToBottom && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTo({
        top: scrollContainerRef.current.scrollHeight,
        behavior: 'smooth',
      })
      setShouldScrollToBottom(false)
    }
  }, [shouldScrollToBottom])

  const formatDate = (dateString?: string) => {
    if (!dateString) return 'Never'
    return new Date(dateString).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  }

  return (
    <div className='relative flex h-full flex-col'>
      {/* Fixed Header */}
      <div className='px-6 pt-4 pb-2'>
        {/* Search Input */}
        {isLoading ? (
          <Skeleton className='h-9 w-56 rounded-lg' />
        ) : (
          <div className='flex h-9 w-56 items-center gap-2 rounded-lg border bg-transparent pr-2 pl-3'>
            <Search className='h-4 w-4 flex-shrink-0 text-muted-foreground' strokeWidth={2} />
            <Input
              placeholder='Search API keys...'
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className='flex-1 border-0 bg-transparent px-0 font-[380] font-sans text-base text-foreground leading-none placeholder:text-muted-foreground focus-visible:ring-0 focus-visible:ring-offset-0'
            />
          </div>
        )}
      </div>

      {/* Scrollable Content */}
      <div
        ref={scrollContainerRef}
        className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'
      >
        <div className='h-full space-y-2 py-2'>
          {isLoading ? (
            <div className='space-y-2'>
              <ApiKeySkeleton />
              <ApiKeySkeleton />
              <ApiKeySkeleton />
            </div>
          ) : personalKeys.length === 0 && workspaceKeys.length === 0 ? (
            <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
              Click "Create Key" below to get started
            </div>
          ) : (
            <>
              {/* Workspace section */}
              {!searchTerm.trim() ? (
                <div className='mb-6 space-y-2'>
                  <div className='font-medium text-[13px] text-foreground'>Workspace</div>
                  {workspaceKeys.length === 0 ? (
                    <div className='text-muted-foreground text-sm'>No workspace API keys yet.</div>
                  ) : (
                    workspaceKeys.map((key) => (
                      <div key={key.id} className='flex flex-col gap-2'>
                        <Label className='font-normal text-muted-foreground text-xs uppercase'>
                          {key.name}
                        </Label>
                        <div className='flex items-center justify-between gap-4'>
                          <div className='flex items-center gap-3'>
                            <ApiKeyDisplay apiKey={key} />
                            <p className='text-muted-foreground text-xs'>
                              Last used: {formatDate(key.lastUsed)}
                            </p>
                          </div>
                          <div className='flex items-center gap-2'>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() => {
                                setDeleteKey(key)
                                setShowDeleteDialog(true)
                              }}
                              className='h-8 text-muted-foreground hover:text-foreground'
                              disabled={!canManageWorkspaceKeys}
                            >
                              Delete
                            </Button>
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              ) : filteredWorkspaceKeys.length > 0 ? (
                <div className='mb-6 space-y-2'>
                  <div className='font-medium text-[13px] text-foreground'>Workspace</div>
                  {filteredWorkspaceKeys.map(({ key }) => (
                    <div key={key.id} className='flex flex-col gap-2'>
                      <Label className='font-normal text-muted-foreground text-xs uppercase'>
                        {key.name}
                      </Label>
                      <div className='flex items-center justify-between gap-4'>
                        <div className='flex items-center gap-3'>
                          <ApiKeyDisplay apiKey={key} />
                          <p className='text-muted-foreground text-xs'>
                            Last used: {formatDate(key.lastUsed)}
                          </p>
                        </div>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            setDeleteKey(key)
                            setShowDeleteDialog(true)
                          }}
                          className='h-8 text-muted-foreground hover:text-foreground'
                          disabled={!canManageWorkspaceKeys}
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Personal section */}
              <div
                className={`${personalHeaderMarginClass} mb-2 font-medium text-[13px] text-foreground`}
              >
                Personal
              </div>
              {filteredPersonalKeys.map(({ key }) => {
                const isConflict = conflicts.includes(key.name)
                return (
                  <div key={key.id} className='flex flex-col gap-2'>
                    <Label className='font-normal text-muted-foreground text-xs uppercase'>
                      {key.name}
                    </Label>
                    <div className='flex items-center justify-between gap-4'>
                      <div className='flex items-center gap-3'>
                        <ApiKeyDisplay apiKey={key} />
                        <p className='text-muted-foreground text-xs'>
                          Last used: {formatDate(key.lastUsed)}
                        </p>
                      </div>
                      <div className='flex items-center gap-2'>
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => {
                            setDeleteKey(key)
                            setShowDeleteDialog(true)
                          }}
                          className='h-8 text-muted-foreground hover:text-foreground'
                        >
                          Delete
                        </Button>
                      </div>
                    </div>
                    {isConflict && (
                      <div className='col-span-3 mt-1 text-[#DC2626] text-[12px] leading-tight dark:text-[#F87171]'>
                        Workspace API key with the same name overrides this. Rename your personal
                        key to use it.
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Show message when search has no results across both sections */}
              {searchTerm.trim() &&
                filteredPersonalKeys.length === 0 &&
                filteredWorkspaceKeys.length === 0 &&
                (personalKeys.length > 0 || workspaceKeys.length > 0) && (
                  <div className='py-8 text-center text-muted-foreground text-sm'>
                    No API keys found matching "{searchTerm}"
                  </div>
                )}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className='bg-background'>
        <div className='flex w-full items-center justify-between px-6 py-4'>
          {isLoading ? (
            <>
              <Skeleton className='h-9 w-[117px] rounded-[8px]' />
              <div className='w-[108px]' />
            </>
          ) : (
            <>
              <Button
                onClick={() => {
                  setIsCreateDialogOpen(true)
                  setKeyType('personal')
                  setCreateError(null)
                }}
                variant='ghost'
                className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              >
                <Plus className='h-4 w-4 stroke-[2px]' />
                Create Key
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Create API Key Dialog */}
      <AlertDialog open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
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
            {canManageWorkspaceKeys && (
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
                (keyType === 'workspace' && !canManageWorkspaceKeys)
              }
            >
              Create {keyType === 'workspace' ? 'Workspace' : 'Personal'} Key
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
                {copySuccess ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
                <span className='sr-only'>Copy to clipboard</span>
              </Button>
            </div>
          )}
        </AlertDialogContent>
      </AlertDialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className='rounded-[10px] sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API key?</AlertDialogTitle>
            <AlertDialogDescription>
              Deleting this API key will immediately revoke access for any integrations using it.{' '}
              <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {deleteKey && (
            <div className='py-2'>
              <p className='mb-2 font-[360] text-sm'>
                Enter the API key name <span className='font-semibold'>{deleteKey.name}</span> to
                confirm.
              </p>
              <Input
                value={deleteConfirmationName}
                onChange={(e) => setDeleteConfirmationName(e.target.value)}
                placeholder='Type key name to confirm'
                className='h-9 rounded-[8px]'
                autoFocus
              />
            </div>
          )}

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='h-9 w-full rounded-[8px]'
              onClick={() => {
                setDeleteKey(null)
                setDeleteConfirmationName('')
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleDeleteKey()
                setDeleteConfirmationName('')
              }}
              className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
              disabled={!deleteKey || deleteConfirmationName !== deleteKey.name}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function ApiKeySkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <Skeleton className='h-4 w-32' /> {/* API key name */}
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-8 w-20 rounded-[8px]' /> {/* Key preview */}
          <Skeleton className='h-4 w-24' /> {/* Last used */}
        </div>
        <Skeleton className='h-8 w-16' /> {/* Delete button */}
      </div>
    </div>
  )
}
