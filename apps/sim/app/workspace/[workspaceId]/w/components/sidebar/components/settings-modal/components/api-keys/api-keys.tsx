'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Plus, Search } from 'lucide-react'
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

const logger = createLogger('ApiKeys')

interface ApiKeysProps {
  onOpenChange?: (open: boolean) => void
}

interface ApiKey {
  id: string
  name: string
  key: string
  lastUsed?: string
  createdAt: string
  expiresAt?: string
}

export function ApiKeys({ onOpenChange }: ApiKeysProps) {
  const { data: session } = useSession()
  const userId = session?.user?.id

  const [apiKeys, setApiKeys] = useState<ApiKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [isCreating, setIsCreating] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [deleteKey, setDeleteKey] = useState<ApiKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [deleteConfirmationName, setDeleteConfirmationName] = useState('')

  // Filter API keys based on search term
  const filteredApiKeys = apiKeys.filter((key) =>
    key.name.toLowerCase().includes(searchTerm.toLowerCase())
  )

  // Fetch API keys
  const fetchApiKeys = async () => {
    if (!userId) return

    setIsLoading(true)
    try {
      const response = await fetch('/api/users/me/api-keys')
      if (response.ok) {
        const data = await response.json()
        setApiKeys(data.keys || [])
      }
    } catch (error) {
      logger.error('Error fetching API keys:', { error })
    } finally {
      setIsLoading(false)
    }
  }

  // Generate a new API key
  const handleCreateKey = async () => {
    if (!userId || !newKeyName.trim()) return

    setIsCreating(true)
    try {
      const response = await fetch('/api/users/me/api-keys', {
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
        // Refresh the keys list
        fetchApiKeys()
        // Close the create dialog
        setIsCreating(false)
      }
    } catch (error) {
      logger.error('Error creating API key:', { error })
    } finally {
      setIsCreating(false)
    }
  }

  // Delete an API key
  const handleDeleteKey = async () => {
    if (!userId || !deleteKey) return

    try {
      const response = await fetch(`/api/users/me/api-keys/${deleteKey.id}`, {
        method: 'DELETE',
      })

      if (response.ok) {
        // Refresh the keys list
        fetchApiKeys()
        // Close the dialog
        setShowDeleteDialog(false)
        setDeleteKey(null)
      }
    } catch (error) {
      logger.error('Error deleting API key:', { error })
    }
  }

  // Copy API key to clipboard
  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  // Load API keys on mount
  useEffect(() => {
    if (userId) {
      fetchApiKeys()
    }
  }, [userId])

  // Format date
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
      <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent min-h-0 flex-1 overflow-y-auto px-6'>
        <div className='h-full space-y-2 py-2'>
          {isLoading ? (
            <div className='space-y-2'>
              <ApiKeySkeleton />
              <ApiKeySkeleton />
              <ApiKeySkeleton />
            </div>
          ) : apiKeys.length === 0 ? (
            <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
              Click "Create Key" below to get started
            </div>
          ) : (
            <div className='space-y-2'>
              {filteredApiKeys.map((key) => (
                <div key={key.id} className='flex flex-col gap-2'>
                  <Label className='font-normal text-muted-foreground text-xs uppercase'>
                    {key.name}
                  </Label>
                  <div className='flex items-center justify-between gap-4'>
                    <div className='flex items-center gap-3'>
                      <div className='flex h-8 items-center rounded-[8px] bg-muted px-3'>
                        <code className='font-mono text-foreground text-xs'>
                          •••••{key.key.slice(-6)}
                        </code>
                      </div>
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
                    >
                      Delete
                    </Button>
                  </div>
                </div>
              ))}
              {/* Show message when search has no results but there are keys */}
              {searchTerm.trim() && filteredApiKeys.length === 0 && apiKeys.length > 0 && (
                <div className='py-8 text-center text-muted-foreground text-sm'>
                  No API keys found matching "{searchTerm}"
                </div>
              )}
            </div>
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
                onClick={() => setIsCreating(true)}
                variant='ghost'
                className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
              >
                <Plus className='h-4 w-4 stroke-[2px]' />
                Create Key
              </Button>
              <div className='text-muted-foreground text-xs'>Keep your API keys secure</div>
            </>
          )}
        </div>
      </div>

      {/* Create API Key Dialog */}
      <AlertDialog open={isCreating} onOpenChange={setIsCreating}>
        <AlertDialogContent className='rounded-[10px] sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>Create new API key</AlertDialogTitle>
            <AlertDialogDescription>
              This key will have access to your account and workflows. Make sure to copy it after
              creation as you won't be able to see it again.
            </AlertDialogDescription>
          </AlertDialogHeader>

          <div className='py-2'>
            <p className='mb-2 font-[360] text-sm'>
              Enter a name for your API key to help you identify it later.
            </p>
            <Input
              value={newKeyName}
              onChange={(e) => setNewKeyName(e.target.value)}
              placeholder='e.g., Development, Production'
              className='h-9 rounded-[8px]'
              autoFocus
            />
          </div>

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='h-9 w-full rounded-[8px]'
              onClick={() => setNewKeyName('')}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                handleCreateKey()
                setNewKeyName('')
              }}
              className='h-9 w-full rounded-[8px] bg-primary text-muted-foreground transition-all duration-200 hover:bg-primary/90'
              disabled={!newKeyName.trim()}
            >
              Create Key
            </AlertDialogAction>
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

// Loading skeleton for API keys
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
