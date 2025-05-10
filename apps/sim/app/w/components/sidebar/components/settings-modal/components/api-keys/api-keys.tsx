'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, KeySquare, Plus, Trash2 } from 'lucide-react'
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
import { Card } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import { useSession } from '@/lib/auth-client'
import { createLogger } from '@/lib/logs/console-logger'

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

  // Fetch API keys
  const fetchApiKeys = async () => {
    if (!userId) return

    setIsLoading(true)
    try {
      const response = await fetch('/api/user/api-keys')
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
      const response = await fetch('/api/user/api-keys', {
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
        // Reset form
        setNewKeyName('')
        // Refresh the keys list
        fetchApiKeys()
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
      const response = await fetch(`/api/user/api-keys/${deleteKey.id}`, {
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
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-xl font-semibold">API Keys</h2>
        <Button
          onClick={() => setIsCreating(true)}
          disabled={isLoading}
          size="sm"
          className="gap-1.5"
        >
          <Plus className="h-4 w-4" />
          Create Key
        </Button>
      </div>

      <p className="text-sm text-muted-foreground leading-relaxed">
        API keys allow you to authenticate and trigger workflows. Keep your API keys secure. They
        have access to your account and workflows.
      </p>

      {isLoading ? (
        <div className="space-y-3 mt-6">
          <KeySkeleton />
          <KeySkeleton />
        </div>
      ) : apiKeys.length === 0 ? (
        <div className="rounded-md border border-dashed p-8 mt-6">
          <div className="flex flex-col items-center justify-center text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-muted">
              <KeySquare className="h-6 w-6 text-primary" />
            </div>
            <h3 className="mt-4 text-lg font-medium">No API keys yet</h3>
            <p className="mt-2 text-sm text-muted-foreground max-w-sm">
              You don&apos;t have any API keys yet. Create one to get started with the Sim SDK.
            </p>
            <Button
              variant="default"
              className="mt-4"
              onClick={() => setIsCreating(true)}
              size="sm"
            >
              <Plus className="h-4 w-4 mr-1.5" /> Create API Key
            </Button>
          </div>
        </div>
      ) : (
        <div className="space-y-4 mt-6">
          {apiKeys.map((key) => (
            <Card key={key.id} className="p-4 hover:shadow-sm transition-shadow">
              <div className="flex items-center justify-between">
                <div className="space-y-1">
                  <h3 className="font-medium text-base">{key.name}</h3>
                  <div className="flex items-center space-x-1">
                    <p className="text-xs text-muted-foreground">
                      Created: {formatDate(key.createdAt)} • Last used: {formatDate(key.lastUsed)}
                    </p>
                    <div className="text-xs px-1.5 py-0.5 bg-muted/50 rounded font-mono">
                      •••••{key.key.slice(-6)}
                    </div>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={() => {
                    setDeleteKey(key)
                    setShowDeleteDialog(true)
                  }}
                  className="text-destructive hover:bg-destructive/10 h-8 w-8"
                >
                  <Trash2 className="h-4 w-4" />
                  <span className="sr-only">Delete key</span>
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {/* Create API Key Dialog */}
      <Dialog open={isCreating} onOpenChange={setIsCreating}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Create new API key</DialogTitle>
            <DialogDescription>
              Name your API key to help you identify it later. This key will have access to your
              account and workflows.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-3">
            <div className="space-y-2">
              <Label htmlFor="keyName">API Key Name</Label>
              <Input
                id="keyName"
                placeholder="e.g., Development, Production, etc."
                value={newKeyName}
                onChange={(e) => setNewKeyName(e.target.value)}
                className="focus-visible:ring-primary"
              />
            </div>
          </div>
          <DialogFooter className="sm:justify-end gap-2">
            <Button variant="outline" onClick={() => setIsCreating(false)}>
              Cancel
            </Button>
            <Button onClick={handleCreateKey} disabled={!newKeyName.trim()}>
              Create
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* New API Key Dialog */}
      <Dialog
        open={showNewKeyDialog}
        onOpenChange={(open) => {
          setShowNewKeyDialog(open)
          if (!open) setNewKey(null)
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Your API key has been created</DialogTitle>
            <DialogDescription>
              This is the only time you will see your API key. Copy it now and store it securely.
            </DialogDescription>
          </DialogHeader>
          {newKey && (
            <div className="space-y-4 py-3">
              <div className="space-y-2">
                <Label>API Key</Label>
                <div className="relative">
                  <Input
                    readOnly
                    value={newKey.key}
                    className="font-mono text-sm pr-10 bg-muted/50 border-slate-300"
                  />
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute right-1 top-1/2 -translate-y-1/2 h-7 w-7"
                    onClick={() => copyToClipboard(newKey.key)}
                  >
                    {copySuccess ? (
                      <Check className="h-4 w-4 text-green-500" />
                    ) : (
                      <Copy className="h-4 w-4" />
                    )}
                    <span className="sr-only">Copy to clipboard</span>
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground mt-1">
                  For security, we don&apos;t store the complete key. You won&apos;t be able to view
                  it again.
                </p>
              </div>
            </div>
          )}
          <DialogFooter className="sm:justify-end">
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
        <AlertDialogContent className="sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete API Key</AlertDialogTitle>
            <AlertDialogDescription>
              {deleteKey && (
                <>
                  Are you sure you want to delete the API key{' '}
                  <span className="font-semibold">{deleteKey.name}</span>? This action cannot be
                  undone and any integrations using this key will no longer work.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="sm:justify-end gap-2">
            <AlertDialogCancel onClick={() => setDeleteKey(null)}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDeleteKey}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}

function KeySkeleton() {
  return (
    <Card className="p-4">
      <div className="flex items-center justify-between">
        <div>
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-8 w-8 rounded-md" />
      </div>
    </Card>
  )
}
