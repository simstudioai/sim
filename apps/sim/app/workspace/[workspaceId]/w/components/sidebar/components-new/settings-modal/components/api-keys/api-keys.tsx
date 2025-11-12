'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Info, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'
import { Tooltip } from '@/components/emcn/components/tooltip/tooltip'
import { Input, Label, Skeleton, Switch } from '@/components/ui'
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
  const canManageWorkspaceKeys = userPermissions.canAdmin

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

  const [billedAccountUserId, setBilledAccountUserId] = useState<string | null>(null)
  const [allowPersonalApiKeys, setAllowPersonalApiKeys] = useState<boolean>(true)
  const [workspaceAdmins, setWorkspaceAdmins] = useState<
    Array<{ userId: string; name: string; email: string; permissionType: string }>
  >([])
  const [workspaceSettingsLoading, setWorkspaceSettingsLoading] = useState<boolean>(true)
  const [workspaceSettingsUpdating, setWorkspaceSettingsUpdating] = useState<boolean>(false)

  const defaultKeyType = allowPersonalApiKeys ? 'personal' : 'workspace'
  const createButtonDisabled =
    workspaceSettingsLoading || (!allowPersonalApiKeys && !canManageWorkspaceKeys)

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

  const fetchWorkspaceSettings = async () => {
    if (!workspaceId) return

    setWorkspaceSettingsLoading(true)
    try {
      const [workspaceResponse, permissionsResponse] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}`),
        fetch(`/api/workspaces/${workspaceId}/permissions`),
      ])

      if (workspaceResponse.ok) {
        const data = await workspaceResponse.json()
        const workspaceData = data.workspace ?? {}
        setBilledAccountUserId(workspaceData.billedAccountUserId ?? null)
        setAllowPersonalApiKeys(
          workspaceData.allowPersonalApiKeys === undefined
            ? true
            : Boolean(workspaceData.allowPersonalApiKeys)
        )
      } else {
        logger.error('Failed to fetch workspace details', { status: workspaceResponse.status })
      }

      if (permissionsResponse.ok) {
        const data = await permissionsResponse.json()
        const users = Array.isArray(data.users) ? data.users : []
        const admins = users.filter((user: any) => user.permissionType === 'admin')
        setWorkspaceAdmins(admins)
      } else {
        logger.error('Failed to fetch workspace permissions', {
          status: permissionsResponse.status,
        })
      }
    } catch (error) {
      logger.error('Error fetching workspace settings:', { error })
    } finally {
      setWorkspaceSettingsLoading(false)
    }
  }

  const updateWorkspaceSettings = async (updates: {
    billedAccountUserId?: string
    allowPersonalApiKeys?: boolean
  }) => {
    if (!workspaceId) return
    setWorkspaceSettingsUpdating(true)
    try {
      const response = await fetch(`/api/workspaces/${workspaceId}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      })

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}))
        throw new Error(errorData.error || 'Failed to update workspace settings')
      }

      await fetchWorkspaceSettings()
    } catch (error) {
      logger.error('Error updating workspace settings:', { error })
      throw error
    } finally {
      setWorkspaceSettingsUpdating(false)
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

      if (isWorkspaceKey) {
        setWorkspaceKeys((prev) => prev.filter((k) => k.id !== deleteKey.id))
      } else {
        setPersonalKeys((prev) => prev.filter((k) => k.id !== deleteKey.id))
        setConflicts((prev) => prev.filter((name) => name !== deleteKey.name))
      }

      setShowDeleteDialog(false)
      setDeleteKey(null)
      setDeleteConfirmationName('')

      const response = await fetch(url, {
        method: 'DELETE',
      })

      if (!response.ok) {
        const errorData = await response.json()
        logger.error('Failed to delete API key:', errorData)
        fetchApiKeys()
      }
    } catch (error) {
      logger.error('Error deleting API key:', { error })
      fetchApiKeys()
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
    if (workspaceId) {
      fetchWorkspaceSettings()
    }
  }, [workspaceId])

  useEffect(() => {
    if (!allowPersonalApiKeys && keyType === 'personal') {
      setKeyType('workspace')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [allowPersonalApiKeys])

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
      <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto px-6'>
        <div className='space-y-2 pt-2 pb-6'>
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
              {/* Allow Personal API Keys Toggle */}
              {!searchTerm.trim() && (
                <Tooltip.Provider delayDuration={150}>
                  <div className='mb-6 flex items-center justify-between'>
                    <div className='flex items-center gap-2'>
                      <span className='font-medium text-[12px] text-foreground'>
                        Allow personal API keys
                      </span>
                      <Tooltip.Root>
                        <Tooltip.Trigger asChild>
                          <button
                            type='button'
                            className='rounded-full p-1 text-muted-foreground transition hover:text-foreground'
                          >
                            <Info className='h-3 w-3' strokeWidth={2} />
                          </button>
                        </Tooltip.Trigger>
                        <Tooltip.Content side='top' className='max-w-xs text-xs'>
                          Allow collaborators to create and use their own keys with billing charged
                          to them.
                        </Tooltip.Content>
                      </Tooltip.Root>
                    </div>
                    {workspaceSettingsLoading ? (
                      <Skeleton className='h-5 w-16 rounded-full' />
                    ) : (
                      <Switch
                        checked={allowPersonalApiKeys}
                        disabled={!canManageWorkspaceKeys || workspaceSettingsUpdating}
                        onCheckedChange={async (checked) => {
                          const previous = allowPersonalApiKeys
                          setAllowPersonalApiKeys(checked)
                          try {
                            await updateWorkspaceSettings({ allowPersonalApiKeys: checked })
                          } catch (error) {
                            setAllowPersonalApiKeys(previous)
                          }
                        }}
                      />
                    )}
                  </div>
                </Tooltip.Provider>
              )}

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
        <div className='flex w-full items-center px-6 py-4'>
          {isLoading ? (
            <Skeleton className='h-9 w-[117px] rounded-[8px]' />
          ) : (
            <Button
              onClick={(e) => {
                if (createButtonDisabled) {
                  return
                }
                // Remove focus from button before opening dialog to prevent focus trap
                e.currentTarget.blur()
                setIsCreateDialogOpen(true)
                setKeyType(defaultKeyType)
                setCreateError(null)
              }}
              variant='ghost'
              disabled={createButtonDisabled}
              className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60'
            >
              <Plus className='h-4 w-4 stroke-[2px]' />
              Create Key
            </Button>
          )}
        </div>
      </div>

      {/* Create API Key Dialog */}
      <Modal open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <ModalContent className='rounded-[10px] sm:max-w-md' showClose={false}>
          <ModalHeader>
            <ModalTitle>Create new API key</ModalTitle>
            <ModalDescription>
              {keyType === 'workspace'
                ? "This key will have access to all workflows in this workspace. Make sure to copy it after creation as you won't be able to see it again."
                : "This key will have access to your personal workflows. Make sure to copy it after creation as you won't be able to see it again."}
            </ModalDescription>
          </ModalHeader>

          <div className='space-y-4 py-2'>
            {canManageWorkspaceKeys && (
              <div className='space-y-2'>
                <p className='font-[360] text-sm'>API Key Type</p>
                <div className='flex gap-2'>
                  <Button
                    type='button'
                    variant={keyType === 'personal' ? 'outline' : 'default'}
                    onClick={() => {
                      setKeyType('personal')
                      if (createError) setCreateError(null)
                    }}
                    disabled={!allowPersonalApiKeys}
                    className='h-8 disabled:cursor-not-allowed disabled:opacity-60'
                  >
                    Personal
                  </Button>
                  <Button
                    type='button'
                    variant={keyType === 'workspace' ? 'outline' : 'default'}
                    onClick={() => {
                      setKeyType('workspace')
                      if (createError) setCreateError(null)
                    }}
                    className='h-8'
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
              {createError && (
                <div className='text-[#DC2626] text-[12px] leading-tight dark:text-[#F87171]'>
                  {createError}
                </div>
              )}
            </div>
          </div>

          <ModalFooter className='flex'>
            <Button
              className='h-9 w-full rounded-[8px] bg-background text-foreground hover:bg-muted dark:bg-background dark:text-foreground dark:hover:bg-muted/80'
              onClick={() => {
                setIsCreateDialogOpen(false)
                setNewKeyName('')
                setKeyType(defaultKeyType)
              }}
            >
              Cancel
            </Button>
            <Button
              type='button'
              variant='primary'
              onClick={handleCreateKey}
              className='h-9 w-full rounded-[8px] disabled:cursor-not-allowed disabled:opacity-50'
              disabled={
                !newKeyName.trim() ||
                isSubmittingCreate ||
                (keyType === 'workspace' && !canManageWorkspaceKeys)
              }
            >
              Create {keyType === 'workspace' ? 'Workspace' : 'Personal'} Key
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {/* New API Key Dialog */}
      <Modal
        open={showNewKeyDialog}
        onOpenChange={(open: boolean) => {
          setShowNewKeyDialog(open)
          if (!open) {
            setNewKey(null)
            setCopySuccess(false)
          }
        }}
      >
        <ModalContent className='rounded-[10px] sm:max-w-md' showClose={false}>
          <ModalHeader>
            <ModalTitle>Your API key has been created</ModalTitle>
            <ModalDescription>
              This is the only time you will see your API key.{' '}
              <span className='font-semibold'>Copy it now and store it securely.</span>
            </ModalDescription>
          </ModalHeader>

          {newKey && (
            <div className='relative'>
              <div className='flex h-9 items-center rounded-[6px] border-none bg-muted px-3 pr-10'>
                <code className='flex-1 truncate font-mono text-foreground text-sm'>
                  {newKey.key}
                </code>
              </div>
              <Button
                variant='ghost'
                className='-translate-y-1/2 absolute top-1/2 right-1 h-7 w-7 rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground'
                onClick={() => copyToClipboard(newKey.key)}
              >
                {copySuccess ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
                <span className='sr-only'>Copy to clipboard</span>
              </Button>
            </div>
          )}
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent className='rounded-[10px] sm:max-w-md' showClose={false}>
          <ModalHeader>
            <ModalTitle>Delete API key?</ModalTitle>
            <ModalDescription>
              Deleting this API key will immediately revoke access for any integrations using it.{' '}
              <span className='text-red-500 dark:text-red-500'>This action cannot be undone.</span>
            </ModalDescription>
          </ModalHeader>

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

          <ModalFooter className='flex'>
            <Button
              className='h-9 w-full rounded-[8px] bg-background text-foreground hover:bg-muted dark:bg-background dark:text-foreground dark:hover:bg-muted/80'
              onClick={() => {
                setShowDeleteDialog(false)
                setDeleteKey(null)
                setDeleteConfirmationName('')
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                handleDeleteKey()
                setDeleteConfirmationName('')
              }}
              className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
              disabled={!deleteKey || deleteConfirmationName !== deleteKey.name}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
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
