import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Eye, EyeOff, KeySquare, Plus, Trash2 } from 'lucide-react'
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
  Card,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Skeleton,
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'

const logger = createLogger('CopilotSettings')

interface CopilotKey {
  id: string
  apiKey: string
}

export function Copilot() {
  const [keys, setKeys] = useState<CopilotKey[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [visible, setVisible] = useState<Record<string, boolean>>({})

  // Create flow state
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [newKey, setNewKey] = useState<CopilotKey | null>(null)
  const [copiedKeyIds, setCopiedKeyIds] = useState<Record<string, boolean>>({})
  const [newKeyCopySuccess, setNewKeyCopySuccess] = useState(false)

  // Delete flow state
  const [deleteKey, setDeleteKey] = useState<CopilotKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

  const hasKeys = keys.length > 0

  const maskedValue = useCallback((value: string, show: boolean) => {
    if (show) return value
    if (!value) return ''
    const last6 = value.slice(-6)
    return `••••••••••${last6}`
  }, [])

  const fetchKeys = useCallback(async () => {
    try {
      setIsLoading(true)
      const res = await fetch('/api/copilot/api-keys')
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
      const data = await res.json()
      setKeys(Array.isArray(data.keys) ? data.keys : [])
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
      // Show the new key dialog with the API key (only shown once)
      if (data?.key) {
        setNewKey(data.key)
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
      if (keyId) {
        setCopiedKeyIds((prev) => ({ ...prev, [keyId]: true }))
        setTimeout(() => {
          setCopiedKeyIds((prev) => ({ ...prev, [keyId]: false }))
        }, 1500)
      } else {
        setNewKeyCopySuccess(true)
        setTimeout(() => setNewKeyCopySuccess(false), 1500)
      }
    } catch (error) {
      logger.error('Copy failed', { error })
    }
  }

  // UI helpers
  const isFetching = isLoading && keys.length === 0

  return (
    <div className='space-y-6 p-6'>
      <h2 className='font-semibold text-xl'>Copilot API Keys</h2>

      <p className='text-muted-foreground text-sm leading-relaxed'>
        Copilot API keys let you authenticate requests to the Copilot endpoints. Keep keys secret
        and rotate them regularly.
      </p>
      <p className='text-muted-foreground text-xs italic'>
        For external deployments, set the <span className='font-mono'>COPILOT_API_KEY</span>{' '}
        environment variable on that instance to one of the keys generated here.
      </p>

      {isFetching ? (
        <div className='mt-6 space-y-3'>
          <Card className='p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <Skeleton className='mb-2 h-5 w-32' />
                <Skeleton className='h-4 w-48' />
              </div>
              <Skeleton className='h-8 w-8 rounded-md' />
            </div>
          </Card>
          <Card className='p-4'>
            <div className='flex items-center justify-between'>
              <div>
                <Skeleton className='mb-2 h-5 w-28' />
                <Skeleton className='h-4 w-40' />
              </div>
              <Skeleton className='h-8 w-8 rounded-md' />
            </div>
          </Card>
        </div>
      ) : !hasKeys ? (
        <div className='mt-6 rounded-md border border-dashed p-8'>
          <div className='flex flex-col items-center justify-center text-center'>
            <div className='flex h-12 w-12 items-center justify-center rounded-full bg-muted'>
              <KeySquare className='h-6 w-6 text-primary' />
            </div>
            <h3 className='mt-4 font-medium text-lg'>No Copilot keys yet</h3>
            <p className='mt-2 max-w-sm text-muted-foreground text-sm'>
              Generate a Copilot API key to authenticate requests to the Copilot SDK and methods.
            </p>
            <Button
              variant='default'
              className='mt-4'
              onClick={onGenerate}
              size='sm'
              disabled={isLoading}
            >
              <Plus className='mr-1.5 h-4 w-4' /> Generate Key
            </Button>
          </div>
        </div>
      ) : (
        <div className='mt-6 space-y-4'>
          {keys.map((k) => {
            const isVisible = !!visible[k.id]
            const value = maskedValue(k.apiKey, isVisible)
            return (
              <Card key={k.id} className='p-4 transition-shadow hover:shadow-sm'>
                <div className='flex items-center justify-between gap-4'>
                  <div className='min-w-0 flex-1'>
                    <div className='rounded bg-muted/50 px-2 py-1 font-mono text-sm'>{value}</div>
                    <p className='mt-1 text-muted-foreground text-xs'>
                      Key ID: <span className='font-mono'>{k.id}</span>
                    </p>
                  </div>
                  <div className='flex items-center gap-2'>
                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant='secondary'
                            size='icon'
                            onClick={() => setVisible((v) => ({ ...v, [k.id]: !isVisible }))}
                            className='h-8 w-8'
                          >
                            {isVisible ? (
                              <EyeOff className='h-4 w-4' />
                            ) : (
                              <Eye className='h-4 w-4' />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>{isVisible ? 'Hide' : 'Reveal'}</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant='secondary'
                            size='icon'
                            onClick={() => onCopy(k.apiKey, k.id)}
                            className='h-8 w-8'
                          >
                            {copiedKeyIds[k.id] ? (
                              <Check className='h-4 w-4 text-green-500' />
                            ) : (
                              <Copy className='h-4 w-4' />
                            )}
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Copy</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>

                    <TooltipProvider>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            variant='ghost'
                            size='icon'
                            onClick={() => {
                              setDeleteKey(k)
                              setShowDeleteDialog(true)
                            }}
                            className='h-8 w-8 text-destructive hover:bg-destructive/10'
                          >
                            <Trash2 className='h-4 w-4' />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent>Delete</TooltipContent>
                      </Tooltip>
                    </TooltipProvider>
                  </div>
                </div>
              </Card>
            )
          })}
        </div>
      )}

      {/* New Key Dialog */}
      <Dialog
        open={showNewKeyDialog}
        onOpenChange={(open) => {
          setShowNewKeyDialog(open)
          if (!open) setNewKey(null)
        }}
      >
        <DialogContent className='sm:max-w-md'>
          <DialogHeader>
            <DialogTitle>Your Copilot API key has been created</DialogTitle>
            <DialogDescription>
              This is the only time you will see the full key. Copy it now and store it securely.
            </DialogDescription>
          </DialogHeader>
          {newKey && (
            <div className='space-y-4 py-3'>
              <div className='space-y-2'>
                <Label>API Key</Label>
                <div className='relative'>
                  <Input
                    readOnly
                    value={newKey.apiKey}
                    className='border-slate-300 bg-muted/50 pr-10 font-mono text-sm'
                  />
                  <Button
                    variant='ghost'
                    size='sm'
                    className='-translate-y-1/2 absolute top-1/2 right-1 h-7 w-7'
                    onClick={() => onCopy(newKey.apiKey)}
                  >
                    {newKeyCopySuccess ? (
                      <Check className='h-4 w-4 text-green-500' />
                    ) : (
                      <Copy className='h-4 w-4' />
                    )}
                    <span className='sr-only'>Copy to clipboard</span>
                  </Button>
                </div>
                <p className='mt-1 text-muted-foreground text-xs'>
                  For security, we don't store the complete key. You won't be able to view it again.
                </p>
              </div>
            </div>
          )}
          <DialogFooter className='sm:justify-end'>
            <Button
              onClick={() => {
                setShowNewKeyDialog(false)
                setNewKey(null)
              }}
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete Confirmation Dialog */}
      <AlertDialog open={showDeleteDialog} onOpenChange={setShowDeleteDialog}>
        <AlertDialogContent className='sm:max-w-md'>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Copilot API Key</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteKey && (
                <>
                  Are you sure you want to delete this Copilot API key? This action cannot be
                  undone.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className='gap-2 sm:justify-end'>
            <AlertDialogCancel onClick={() => setDeleteKey(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (deleteKey) {
                  onDelete(deleteKey.id)
                }
                setShowDeleteDialog(false)
                setDeleteKey(null)
              }}
              className='bg-destructive text-destructive-foreground hover:bg-destructive/90'
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
