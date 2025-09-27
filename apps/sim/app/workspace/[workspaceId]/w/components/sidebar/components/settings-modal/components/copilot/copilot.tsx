import { useCallback, useEffect, useState } from 'react'
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
  Button,
  Input,
  Label,
  Skeleton,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotSettings')

interface CopilotKey {
  id: string
  displayKey: string
}

export function Copilot() {
  const [keys, setKeys] = useState<CopilotKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [searchTerm, setSearchTerm] = useState('')

  // Create flow state
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [isCreatingKey] = useState(false)
  const [newKeyCopySuccess, setNewKeyCopySuccess] = useState(false)

  // Delete flow state
  const [deleteKey, setDeleteKey] = useState<CopilotKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  // Filter keys based on search term (by masked display value)
  const filteredKeys = keys.filter((key) =>
    key.displayKey.toLowerCase().includes(searchTerm.toLowerCase())
  )

  const fetchKeys = useCallback(async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/copilot/api-keys')
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
      const data = await res.json()
      setKeys(Array.isArray(data.keys) ? (data.keys as CopilotKey[]) : [])
    } catch (error) {
      logger.error('Failed to fetch copilot keys', { error })
      setKeys([])
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchKeys()
  }, [fetchKeys])

  const onGenerate = async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/copilot/api-keys/generate', { method: 'POST' })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to generate API key')
      }
      const data = await res.json()
      if (data?.key?.apiKey) {
        setNewKey(data.key.apiKey)
        setShowNewKeyDialog(true)
      }

      await fetchKeys()
    } catch (error) {
      logger.error('Failed to generate copilot API key', { error })
    } finally {
      setIsLoading(false)
    }
  }

  const onDelete = async (id: string) => {
    try {
      setIsLoading(true)
      const res = await fetch(`/api/copilot/api-keys?id=${encodeURIComponent(id)}`, {
        method: 'DELETE',
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        throw new Error(body.error || 'Failed to delete API key')
      }
      await fetchKeys()
    } catch (error) {
      logger.error('Failed to delete copilot API key', { error })
    } finally {
      setIsLoading(false)
    }
  }

  const onCopy = async (value: string, keyId?: string) => {
    try {
      await navigator.clipboard.writeText(value)
      if (!keyId) {
        setNewKeyCopySuccess(true)
        setTimeout(() => setNewKeyCopySuccess(false), 1500)
      }
    } catch (error) {
      logger.error('Copy failed', { error })
    }
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
              <CopilotKeySkeleton />
              <CopilotKeySkeleton />
              <CopilotKeySkeleton />
            </div>
          ) : keys.length === 0 ? (
            <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
              Click "Generate Key" below to get started
            </div>
          ) : (
            <div className='space-y-2'>
              {filteredKeys.map((k) => (
                <div key={k.id} className='flex flex-col gap-2'>
                  <Label className='font-normal text-muted-foreground text-xs uppercase'>
                    Copilot API Key
                  </Label>
                  <div className='flex items-center justify-between gap-4'>
                    <div className='flex items-center gap-3'>
                      <div className='flex h-8 items-center rounded-[8px] bg-muted px-3'>
                        <code className='font-mono text-foreground text-xs'>{k.displayKey}</code>
                      </div>
                    </div>

                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        setDeleteKey(k)
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
              {searchTerm.trim() && filteredKeys.length === 0 && keys.length > 0 && (
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
                onClick={onGenerate}
                variant='ghost'
                className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                disabled={isLoading}
              >
                <Plus className='h-4 w-4 stroke-[2px]' />
                Create Key
              </Button>
            </>
          )}
        </div>
      </div>

      {/* New API Key Dialog */}
      <AlertDialog
        open={showNewKeyDialog}
        onOpenChange={(open) => {
          setShowNewKeyDialog(open)
          if (!open) {
            setNewKey(null)
            setNewKeyCopySuccess(false)
          }
        }}
      >
        <AlertDialogContent className='rounded-[10px] sm:max-w-lg'>
          <AlertDialogHeader>
            <AlertDialogTitle>Your API key has been created</AlertDialogTitle>
            <AlertDialogDescription>
              This is the only time you will see your API key.{' '}
              <span className='font-semibold'>Copy it now and store it securely.</span>
            </AlertDialogDescription>
          </AlertDialogHeader>

          {newKey && (
            <div className='relative'>
              <div className='flex h-9 items-center rounded-[6px] border-none bg-muted px-3 pr-8'>
                <code className='flex-1 truncate font-mono text-foreground text-sm'>{newKey}</code>
              </div>
              <Button
                variant='ghost'
                size='icon'
                className='-translate-y-1/2 absolute top-1/2 right-2 h-4 w-4 rounded-[4px] p-0 text-muted-foreground transition-colors hover:bg-transparent hover:text-foreground'
                onClick={() => onCopy(newKey)}
              >
                {newKeyCopySuccess ? (
                  <Check className='!h-3.5 !w-3.5' />
                ) : (
                  <Copy className='!h-3.5 !w-3.5' />
                )}
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

          <AlertDialogFooter className='flex'>
            <AlertDialogCancel
              className='h-9 w-full rounded-[8px]'
              onClick={() => setDeleteKey(null)}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteKey) {
                  onDelete(deleteKey.id)
                }
                setShowDeleteDialog(false)
                setDeleteKey(null)
              }}
              className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function CopilotKeySkeleton() {
  return (
    <div className='flex flex-col gap-2'>
      <Skeleton className='h-4 w-32' />
      <div className='flex items-center justify-between gap-4'>
        <div className='flex items-center gap-3'>
          <Skeleton className='h-8 w-20 rounded-[8px]' />
          <Skeleton className='h-4 w-24' />
        </div>
        <Skeleton className='h-8 w-16' />
      </div>
    </div>
  )
}
