'use client'

import { useMemo, useState } from 'react'
// import { useParams } from 'next/navigation'
import { createLogger } from '@sim/logger'
import { formatDate } from '@sim/utils/formatting'
import { Plus, Search } from 'lucide-react'
import {
  Button,
  Input as EmcnInput,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  SecretReveal,
  // Switch,
} from '@/components/emcn'
import { Input } from '@/components/ui'
// import { useMcpServers, useUpdateMcpServer } from '@/hooks/queries/mcp'
import { CopilotKeySkeleton } from '@/app/workspace/[workspaceId]/settings/components/copilot/copilot-skeleton'
import {
  type CopilotKey,
  useCopilotKeys,
  useDeleteCopilotKey,
  useGenerateCopilotKey,
} from '@/hooks/queries/copilot-keys'

const logger = createLogger('CopilotSettings')

/**
 * Copilot Keys management component for handling API keys used with the Copilot feature.
 * Provides functionality to create, view, and delete copilot API keys.
 */
// function McpServerSkeleton() {
//   return (
//     <div className='flex items-center justify-between gap-3'>
//       <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
//         <Skeleton className='h-5 w-[120px]' />
//         <Skeleton className='h-5 w-[80px]' />
//       </div>
//       <Skeleton className='h-5 w-[36px] rounded-full' />
//     </div>
//   )
// }

export function Copilot() {
  // const params = useParams()
  // const workspaceId = params.workspaceId as string

  const { data: keys = [], isLoading } = useCopilotKeys()
  const generateKey = useGenerateCopilotKey()
  const deleteKeyMutation = useDeleteCopilotKey()

  // const { data: mcpServers = [], isLoading: mcpLoading } = useMcpServers(workspaceId)
  // const updateServer = useUpdateMcpServer()

  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<string | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [deleteKey, setDeleteKey] = useState<CopilotKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [createError, setCreateError] = useState<string | null>(null)

  // const enabledServers = mcpServers.filter((s) => s.enabled)

  // const handleToggleCopilot = async (serverId: string, enabled: boolean) => {
  //   try {
  //     await updateServer.mutateAsync({
  //       workspaceId,
  //       serverId,
  //       updates: { copilotEnabled: enabled },
  //     })
  //   } catch (error) {
  //     logger.error('Failed to toggle MCP server for Mothership', { error })
  //   }
  // }

  const filteredKeys = useMemo(() => {
    if (!searchTerm.trim()) return keys
    const term = searchTerm.toLowerCase()
    return keys.filter(
      (key) =>
        key.name?.toLowerCase().includes(term) || key.displayKey?.toLowerCase().includes(term)
    )
  }, [keys, searchTerm])

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return

    const trimmedName = newKeyName.trim()
    const isDuplicate = keys.some((k) => k.name === trimmedName)
    if (isDuplicate) {
      setCreateError(
        `A Copilot API key named "${trimmedName}" already exists. Please choose a different name.`
      )
      return
    }

    setCreateError(null)
    try {
      const data = await generateKey.mutateAsync({ name: trimmedName })
      if (data?.key?.apiKey) {
        setNewKey(data.key.apiKey)
        setShowNewKeyDialog(true)
        setNewKeyName('')
        setCreateError(null)
        setIsCreateDialogOpen(false)
      }
    } catch (error) {
      logger.error('Failed to generate copilot API key', { error })
      setCreateError('Failed to create API key. Please check your connection and try again.')
    }
  }

  const handleDeleteKey = async () => {
    if (!deleteKey) return
    try {
      setShowDeleteDialog(false)
      const keyToDelete = deleteKey
      setDeleteKey(null)

      await deleteKeyMutation.mutateAsync({ keyId: keyToDelete.id })
    } catch (error) {
      logger.error('Failed to delete copilot API key', { error })
    }
  }

  const formatLastUsed = (dateString?: string | null) => {
    if (!dateString) return 'Never'
    return formatDate(new Date(dateString))
  }

  const hasKeys = keys.length > 0
  const showEmptyState = !hasKeys
  const showNoResults = searchTerm.trim() && filteredKeys.length === 0 && keys.length > 0

  return (
    <>
      <div className='flex h-full flex-col gap-4.5'>
        {/* MCP Tools Section — uncomment when ready to allow users to toggle MCP servers for Mothership
        <div className='flex flex-col gap-2'>
          <div className='font-medium text-sm text-[var(--text-secondary)]'>
            MCP Tools
          </div>
          {mcpLoading ? (
            <div className='flex flex-col gap-2'>
              <McpServerSkeleton />
              <McpServerSkeleton />
            </div>
          ) : enabledServers.length === 0 ? (
            <div className='text-sm text-[var(--text-muted)]'>
              No MCP servers configured. Add servers in the MCP Tools tab.
            </div>
          ) : (
            <div className='flex flex-col gap-2'>
              {enabledServers.map((server) => (
                <div key={server.id} className='flex items-center justify-between gap-3'>
                  <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                    <span className='truncate font-medium text-base'>{server.name}</span>
                    <p className='truncate text-sm text-[var(--text-muted)]'>
                      {server.toolCount ?? 0} tool{server.toolCount === 1 ? '' : 's'}
                    </p>
                  </div>
                  <Switch
                    checked={server.copilotEnabled ?? false}
                    onCheckedChange={(checked) => handleToggleCopilot(server.id, checked)}
                  />
                </div>
              ))}
            </div>
          )}
        </div>
        */}

        {/* Search Input and Create Button */}
        <div className='flex items-center gap-2'>
          <div className='flex flex-1 items-center gap-2 rounded-lg border border-[var(--border)] bg-transparent px-2 py-1.5 transition-colors duration-100 dark:bg-[var(--surface-4)] dark:hover-hover:border-[var(--border-1)] dark:hover-hover:bg-[var(--surface-5)]'>
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
            onClick={() => {
              setIsCreateDialogOpen(true)
              setCreateError(null)
            }}
            variant='primary'
            disabled={isLoading}
          >
            <Plus className='mr-1.5 h-[13px] w-[13px]' />
            Create
          </Button>
        </div>

        {/* Scrollable Content */}
        <div className='min-h-0 flex-1 overflow-y-auto'>
          {isLoading ? (
            <div className='flex flex-col gap-2'>
              <CopilotKeySkeleton />
              <CopilotKeySkeleton />
              <CopilotKeySkeleton />
            </div>
          ) : showEmptyState ? (
            <div className='flex h-full items-center justify-center text-[var(--text-muted)] text-sm'>
              Click "Create" above to get started
            </div>
          ) : (
            <div className='flex flex-col gap-2'>
              {filteredKeys.map((key) => (
                <div key={key.id} className='flex items-center justify-between gap-3'>
                  <div className='flex min-w-0 flex-col justify-center gap-[1px]'>
                    <div className='flex items-center gap-1.5'>
                      <span className='max-w-[280px] truncate font-medium text-base'>
                        {key.name || 'Unnamed Key'}
                      </span>
                      <span className='text-[var(--text-secondary)] text-sm'>
                        (last used: {formatLastUsed(key.lastUsed).toLowerCase()})
                      </span>
                    </div>
                    <p className='truncate text-[var(--text-muted)] text-sm'>{key.displayKey}</p>
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
              ))}
              {showNoResults && (
                <div className='py-4 text-center text-[var(--text-muted)] text-sm'>
                  No API keys found matching "{searchTerm}"
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Create API Key Dialog */}
      <Modal open={isCreateDialogOpen} onOpenChange={setIsCreateDialogOpen}>
        <ModalContent size='sm'>
          <ModalHeader>Create new API key</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              This key will allow access to Copilot features. Make sure to copy it after creation as
              you won't be able to see it again.
            </p>

            <div className='mt-4 flex flex-col gap-2'>
              <p className='font-medium text-[var(--text-secondary)] text-sm'>
                Enter a name for your API key to help you identify it later.
              </p>
              <EmcnInput
                value={newKeyName}
                onChange={(e) => {
                  setNewKeyName(e.target.value)
                  if (createError) setCreateError(null)
                }}
                placeholder='e.g., Development, Production'
                className='h-9'
              />
              {createError && (
                <p className='text-[var(--text-error)] text-small leading-tight'>{createError}</p>
              )}
            </div>
          </ModalBody>

          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setIsCreateDialogOpen(false)
                setNewKeyName('')
                setCreateError(null)
              }}
            >
              Cancel
            </Button>
            <Button
              type='button'
              variant='primary'
              onClick={handleCreateKey}
              disabled={!newKeyName.trim() || generateKey.isPending}
            >
              {generateKey.isPending ? 'Creating...' : 'Create'}
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
          }
        }}
      >
        <ModalContent size='sm'>
          <ModalHeader>Your API key has been created</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              This is the only time you will see your API key.{' '}
              <span className='font-semibold text-[var(--text-primary)]'>
                Copy it now and store it securely.
              </span>
            </p>

            {newKey && <SecretReveal value={newKey} className='mt-2.5' />}
          </ModalBody>
        </ModalContent>
      </Modal>

      {/* Delete Confirmation Dialog */}
      <Modal open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <ModalContent size='sm'>
          <ModalHeader>Delete API key</ModalHeader>
          <ModalBody>
            <p className='text-[var(--text-secondary)]'>
              Deleting{' '}
              <span className='font-medium text-[var(--text-primary)]'>
                {deleteKey?.name || 'Unnamed Key'}
              </span>{' '}
              <span className='text-[var(--text-error)]'>
                will immediately revoke access for any integrations using it.
              </span>{' '}
              This action cannot be undone.
            </p>
          </ModalBody>
          <ModalFooter>
            <Button
              variant='default'
              onClick={() => {
                setShowDeleteDialog(false)
                setDeleteKey(null)
              }}
              disabled={deleteKeyMutation.isPending}
            >
              Cancel
            </Button>
            <Button
              variant='destructive'
              onClick={handleDeleteKey}
              disabled={deleteKeyMutation.isPending}
            >
              {deleteKeyMutation.isPending ? 'Deleting...' : 'Delete'}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </>
  )
}
