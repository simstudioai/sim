'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { createLogger } from '@sim/logger'
import { Info, Plus, Search } from 'lucide-react'
import { useParams } from 'next/navigation'
import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  Switch,
  Tooltip,
} from '@/components/emcn'
import { Input, Skeleton } from '@/components/ui'
import { useSession } from '@/lib/auth/auth-client'
import { formatDate } from '@/lib/core/utils/formatting'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import {
  type ApiKey,
  useApiKeys,
  useDeleteApiKey,
  useUpdateWorkspaceApiKeySettings,
} from '@/hooks/queries/api-keys'
import { useWorkspaceSettings } from '@/hooks/queries/workspace'
import { CreateApiKeyModal } from './components'

const logger = createLogger('ApiKeys')

interface ApiKeysProps {
  onOpenChange?: (open: boolean) => void
  registerCloseHandler?: (handler: (open: boolean) => void) => void
}

export function ApiKeys({ onOpenChange, registerCloseHandler }: ApiKeysProps) {
  const { data: session } = useSession()
  const userId = session?.user?.id
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const userPermissions = useUserPermissionsContext()
  const canManageWorkspaceKeys = userPermissions.canAdmin

  // React Query hooks
  const {
    data: apiKeysData,
    isLoading: isLoadingKeys,
    refetch: refetchApiKeys,
  } = useApiKeys(workspaceId)
  const { data: workspaceSettingsData, isLoading: isLoadingSettings } =
    useWorkspaceSettings(workspaceId)
  const deleteApiKeyMutation = useDeleteApiKey()
  const updateSettingsMutation = useUpdateWorkspaceApiKeySettings()

  // Extract data from queries
  const workspaceKeys = apiKeysData?.workspaceKeys || []
  const personalKeys = apiKeysData?.personalKeys || []
  const conflicts = apiKeysData?.conflicts || []
  const isLoading = isLoadingKeys || isLoadingSettings

  const allowPersonalApiKeys =
    workspaceSettingsData?.settings?.workspace?.allowPersonalApiKeys ?? true

  // Local UI state
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [shouldScrollToBottom, setShouldScrollToBottom] = useState(false)

  const defaultKeyType = allowPersonalApiKeys ? 'personal' : 'workspace'
  const createButtonDisabled = isLoading || (!allowPersonalApiKeys && !canManageWorkspaceKeys)

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

  const handleDeleteKey = async () => {
    if (!userId || !deleteKey) return

    try {
      const isWorkspaceKey = workspaceKeys.some((k) => k.id === deleteKey.id)
      const keyTypeToDelete = isWorkspaceKey ? 'workspace' : 'personal'

      setShowDeleteDialog(false)
      setDeleteKey(null)

      await deleteApiKeyMutation.mutateAsync({
        workspaceId,
        keyId: deleteKey.id,
        keyType: keyTypeToDelete,
      })
    } catch (error) {
      logger.error('Error deleting API key:', { error })
      // Refetch to restore correct state in case of error
      refetchApiKeys()
    }
  }

  const handleModalClose = (open: boolean) => {
    onOpenChange?.(open)
  }

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

  const formatLastUsed = (dateString?: string) => {
    if (!dateString) return 'Never'
    return formatDate(new Date(dateString))
  }

  return (
    <div className='flex h-full flex-col gap-[16px]'>
      {/* Search Input and Create Button */}
      <div className='flex items-center gap-[8px]'>
        <div className='flex flex-1 items-center gap-[8px] rounded-[8px] border border-[var(--border)] bg-transparent px-[8px] py-[5px] transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover:border-[var(--border-1)] dark:hover:bg-[var(--surface-5)]'>
          <Search
            className='h-[14px] w-[14px] flex-shrink-0 text-[var(--text-tertiary)]'
            strokeWidth={2}
          />
          <Input
            placeholder='Search API keys...'
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className='h-auto flex-1 border-0 bg-transparent p-0 font-base leading-none placeholder:text-[var(--text-tertiary)] focus-visible:ring-0 focus-visible:ring-offset-0'
          />
        </div>
        <Button
          onClick={(e) => {
            if (createButtonDisabled) {
              return
            }
            e.currentTarget.blur()
            setIsCreateDialogOpen(true)
          }}
          variant='tertiary'
          disabled={createButtonDisabled}
        >
          <Plus className='mr-[6px] h-[13px] w-[13px]' />
          Create
        </Button>
      </div>

      {/* Scrollable Content */}
      <div ref={scrollContainerRef} className='min-h-0 flex-1 overflow-y-auto'>
        {isLoading ? (
          <div className='flex flex-col gap-[16px]'>
            <div className='flex flex-col gap-[8px]'>
              <Skeleton className='h-5 w-[70px]' />
              <div className='text-[13px] text-[var(--text-muted)]'>
                <Skeleton className='h-5 w-[140px]' />
              </div>
            </div>
            <div className='flex flex-col gap-[8px]'>
              <Skeleton className='h-5 w-[55px]' />
              <ApiKeySkeleton />
              <ApiKeySkeleton />
            </div>
          </div>
        ) : personalKeys.length === 0 && workspaceKeys.length === 0 ? (
          <div className='flex h-full items-center justify-center text-[13px] text-[var(--text-muted)]'>
            Click "Create" above to get started
          </div>
        ) : (
          <div className='flex flex-col gap-[16px]'>
            <>
              {/* Workspace section */}
              {!searchTerm.trim() ? (
                <div className='flex flex-col gap-[8px]'>
                  <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                    Workspace
                  </div>
                  {workspaceKeys.length === 0 ? (
                    <div className='text-[13px] text-[var(--text-muted)]'>
                      No workspace API keys yet
                    </div>
                  ) : (
                    workspaceKeys.map((key) => (
                      <div key={key.id} className='flex items-center justify-between gap-[12px]'>
                        <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                          <div className='flex items-center gap-[6px]'>
                            <span className='max-w-[280px] truncate font-medium text-[14px]'>
                              {key.name}
                            </span>
                            <span className='text-[13px] text-[var(--text-secondary)]'>
                              (last used: {formatLastUsed(key.lastUsed).toLowerCase()})
                            </span>
                          </div>
                          <p className='truncate text-[13px] text-[var(--text-muted)]'>
                            {key.displayKey || key.key}
                          </p>
                        </div>
                        <Button
                          variant='ghost'
                          className='flex-shrink-0'
                          onClick={() => {
                            setDeleteKey(key)
                            setShowDeleteDialog(true)
                          }}
                          disabled={!canManageWorkspaceKeys}
                        >
                          Delete
                        </Button>
                      </div>
                    ))
                  )}
                </div>
              ) : filteredWorkspaceKeys.length > 0 ? (
                <div className='flex flex-col gap-[8px]'>
                  <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                    Workspace
                  </div>
                  {filteredWorkspaceKeys.map(({ key }) => (
                    <div key={key.id} className='flex items-center justify-between gap-[12px]'>
                      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                        <div className='flex items-center gap-[6px]'>
                          <span className='max-w-[280px] truncate font-medium text-[14px]'>
                            {key.name}
                          </span>
                          <span className='text-[13px] text-[var(--text-secondary)]'>
                            (last used: {formatLastUsed(key.lastUsed).toLowerCase()})
                          </span>
                        </div>
                        <p className='truncate text-[13px] text-[var(--text-muted)]'>
                          {key.displayKey || key.key}
                        </p>
                      </div>
                      <Button
                        variant='ghost'
                        className='flex-shrink-0'
                        onClick={() => {
                          setDeleteKey(key)
                          setShowDeleteDialog(true)
                        }}
                        disabled={!canManageWorkspaceKeys}
                      >
                        Delete
                      </Button>
                    </div>
                  ))}
                </div>
              ) : null}

              {/* Personal section */}
              {(!searchTerm.trim() || filteredPersonalKeys.length > 0) && (
                <div className='flex flex-col gap-[8px]'>
                  <div className='font-medium text-[13px] text-[var(--text-secondary)]'>
                    Personal
                  </div>
                  {filteredPersonalKeys.map(({ key }) => {
                    const isConflict = conflicts.includes(key.name)
                    return (
                      <div key={key.id} className='flex flex-col gap-[8px]'>
                        <div className='flex items-center justify-between gap-[12px]'>
                          <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                            <div className='flex items-center gap-[6px]'>
                              <span className='max-w-[280px] truncate font-medium text-[14px]'>
                                {key.name}
                              </span>
                              <span className='text-[13px] text-[var(--text-secondary)]'>
                                (last used: {formatLastUsed(key.lastUsed).toLowerCase()})
                              </span>
                            </div>
                            <p className='truncate text-[13px] text-[var(--text-muted)]'>
                              {key.displayKey || key.key}
                            </p>
                          </div>
                          <Button
                            variant='ghost'
                            className='flex-shrink-0'
                            onClick={() => {
                              setDeleteKey(key)
                              setShowDeleteDialog(true)
                            }}
                          >
                            Delete
                          </Button>
                        </div>
                        {isConflict && (
                          <div className='text-[12px] text-[var(--text-error)] leading-tight'>
                            Workspace API key with the same name overrides this. Rename your
                            personal key to use it.
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}

              {/* Show message when search has no results across both sections */}
              {searchTerm.trim() &&
                filteredPersonalKeys.length === 0 &&
                filteredWorkspaceKeys.length === 0 &&
                (personalKeys.length > 0 || workspaceKeys.length > 0) && (
                  <div className='py-[16px] text-center text-[13px] text-[var(--text-muted)]'>
                    No API keys found matching "{searchTerm}"
                  </div>
                )}
            </>
          </div>
        )}
      </div>

      {/* Allow Personal API Keys Toggle - Fixed at bottom */}
      {!isLoading && canManageWorkspaceKeys && (
        <Tooltip.Provider delayDuration={150}>
          <div className='mt-auto flex items-center justify-between'>
            <div className='flex items-center gap-[8px]'>
              <span className='font-medium text-[13px] text-[var(--text-secondary)]'>
                Allow personal API keys
              </span>
              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <button
                    type='button'
                    className='rounded-full p-[4px] text-[var(--text-muted)] transition hover:text-[var(--text-primary)]'
                  >
                    <Info className='h-[12px] w-[12px]' strokeWidth={2} />
                  </button>
                </Tooltip.Trigger>
                <Tooltip.Content side='top' className='max-w-xs text-[12px]'>
                  Allow collaborators to create and use their own keys with billing charged to them.
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
            {isLoadingSettings ? (
              <Skeleton className='h-5 w-16 rounded-full' />
            ) : (
              <Switch
                checked={allowPersonalApiKeys}
                disabled={!canManageWorkspaceKeys || updateSettingsMutation.isPending}
                onCheckedChange={async (checked) => {
                  try {
                    await updateSettingsMutation.mutateAsync({
                      workspaceId,
                      allowPersonalApiKeys: checked,
                    })
                  } catch (error) {
                    logger.error('Error updating workspace settings:', { error })
                  }
                }}
              />
            )}
          </div>
        </Tooltip.Provider>
      )}

      {/* Create API Key Modal */}
      <CreateApiKeyModal
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        workspaceId={workspaceId}
        existingKeyNames={[...workspaceKeys, ...personalKeys].map((k) => k.name)}
        allowPersonalApiKeys={allowPersonalApiKeys}
        canManageWorkspaceKeys={canManageWorkspaceKeys}
        defaultKeyType={defaultKeyType}
      />

      {/* Delete Confirmation Dialog */}
      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete API key</ModalHeader>
          <ModalBody>
            <p className='text-[12px] text-[var(--text-secondary)]'>
              Deleting{' '}
              <span className='font-medium text-[var(--text-primary)]'>{deleteKey?.name}</span> will
              immediately revoke access for any integrations using it.{' '}
              <span className='text-[var(--text-error)]'>This action cannot be undone.</span>
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setShowDeleteDialog(false)
                setDeleteKey(null)
              }}
              disabled={deleteApiKeyMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDeleteKey}
              disabled={deleteApiKeyMutation.isPending}
            >
              {deleteApiKeyMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}

function ApiKeySkeleton() {
  return (
    <div className='flex items-center justify-between gap-[12px]'>
      <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
        <div className='flex items-center gap-[6px]'>
          <Skeleton className='h-5 w-[80px]' />
          <Skeleton className='h-5 w-[140px]' />
        </div>
        <Skeleton className='h-5 w-[100px]' />
      </div>
      <Skeleton className='h-[26px] w-[48px] rounded-[6px]' />
    </div>
  )
}
