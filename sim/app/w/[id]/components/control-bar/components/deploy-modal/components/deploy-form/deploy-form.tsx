'use client'

import { useEffect, useState } from 'react'
import { zodResolver } from '@hookform/resolvers/zod'
import { Check, Copy, KeySquare, Loader2, Plus, X } from 'lucide-react'
import { useForm } from 'react-hook-form'
import { z } from 'zod'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { createLogger } from '@/lib/logs/console-logger'

const logger = createLogger('DeployForm')

interface ApiKey {
  id: string
  name: string
  key: string
  lastUsed?: string
  createdAt: string
  expiresAt?: string
}

// Form schema for API key selection or creation
const deployFormSchema = z.object({
  apiKey: z.string().min(1, 'Please select an API key'),
  newKeyName: z.string().optional(),
})

type DeployFormValues = z.infer<typeof deployFormSchema>

interface DeployFormProps {
  apiKeys: ApiKey[]
  keysLoaded: boolean
  endpointUrl: string
  workflowId: string
  onSubmit: (data: DeployFormValues) => void
  getInputFormatExample: () => string
  onApiKeyCreated?: () => void
}

export function DeployForm({
  apiKeys,
  keysLoaded,
  endpointUrl,
  workflowId,
  onSubmit,
  getInputFormatExample,
  onApiKeyCreated,
}: DeployFormProps) {
  // State
  const [isCreatingKey, setIsCreatingKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [isCreating, setIsCreating] = useState(false)

  // Initialize form with react-hook-form
  const form = useForm<DeployFormValues>({
    resolver: zodResolver(deployFormSchema),
    defaultValues: {
      apiKey: apiKeys.length > 0 ? apiKeys[0].key : '',
      newKeyName: '',
    },
  })

  // Update on dependency changes beyond the initial load
  useEffect(() => {
    if (keysLoaded && apiKeys.length > 0) {
      // Ensure that form has a value after loading
      form.setValue('apiKey', form.getValues().apiKey || apiKeys[0].key)
    }
  }, [keysLoaded, apiKeys, form])

  // Generate a new API key
  const handleCreateKey = async () => {
    if (!newKeyName.trim()) return

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

      if (!response.ok) {
        throw new Error('Failed to create new API key')
      }

      const data = await response.json()
      // Show the new key dialog with the API key (only shown once)
      setNewKey(data.key)
      setShowNewKeyDialog(true)
      // Reset form
      setNewKeyName('')
      // Close the create dialog
      setIsCreatingKey(false)

      // Update the form with the new key
      form.setValue('apiKey', data.key.key)

      // Trigger a refresh of the keys list in the parent component
      if (onApiKeyCreated) {
        onApiKeyCreated()
      }
    } catch (error) {
      logger.error('Error creating API key:', { error })
    } finally {
      setIsCreating(false)
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
        onSubmit={(e) => {
          e.preventDefault()
          onSubmit(form.getValues())
        }}
        className="space-y-6"
      >
        {/* API Key selection */}
        <FormField
          control={form.control}
          name="apiKey"
          render={({ field }) => (
            <FormItem className="space-y-1.5">
              <div className="flex items-center justify-between">
                <FormLabel className="font-medium text-sm">Select API Key</FormLabel>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-xs gap-1 text-primary"
                  onClick={() => setIsCreatingKey(true)}
                >
                  <Plus className="h-3.5 w-3.5" />
                  <span>Create new</span>
                </Button>
              </div>
              <Select onValueChange={field.onChange} value={field.value}>
                <FormControl>
                  <SelectTrigger className={!keysLoaded ? 'opacity-70' : ''}>
                    {!keysLoaded ? (
                      <div className="flex items-center space-x-2">
                        <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        <span>Loading API keys...</span>
                      </div>
                    ) : (
                      <SelectValue placeholder="Select an API key" className="text-sm" />
                    )}
                  </SelectTrigger>
                </FormControl>
                <SelectContent align="start" className="w-[var(--radix-select-trigger-width)] py-1">
                  {apiKeys.map((apiKey) => (
                    <SelectItem
                      key={apiKey.id}
                      value={apiKey.key}
                      className="flex items-center px-3 py-2.5 my-0.5 rounded-sm cursor-pointer data-[state=checked]:bg-muted [&>span.absolute]:hidden"
                    >
                      <div className="flex items-center w-full">
                        <div className="flex items-center justify-between w-full">
                          <span className="text-sm truncate mr-2">{apiKey.name}</span>
                          <span className="text-xs text-muted-foreground font-mono flex-shrink-0 bg-muted px-1.5 py-0.5 mt-[1px] rounded">
                            {apiKey.key.slice(-5)}
                          </span>
                        </div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <FormMessage />
            </FormItem>
          )}
        />

        {/* Create API Key Dialog */}
        <Dialog open={isCreatingKey} onOpenChange={setIsCreatingKey}>
          <DialogContent className="sm:max-w-md flex flex-col p-0 gap-0" hideCloseButton>
            <DialogHeader className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-lg font-medium">Create new API key</DialogTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 p-0"
                  onClick={() => setIsCreatingKey(false)}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </div>
            </DialogHeader>

            <div className="pt-4 px-6 pb-6 flex-1">
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

            <div className="border-t px-6 py-4 flex justify-end gap-2">
              <Button variant="outline" onClick={() => setIsCreatingKey(false)}>
                Cancel
              </Button>
              <Button onClick={handleCreateKey} disabled={!newKeyName.trim() || isCreating}>
                {isCreating ? (
                  <>
                    <Loader2 className="h-3.5 w-3.5 animate-spin mr-1.5" />
                    Creating...
                  </>
                ) : (
                  'Create'
                )}
              </Button>
            </div>
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
          <DialogContent className="sm:max-w-md flex flex-col p-0 gap-0" hideCloseButton>
            <DialogHeader className="px-6 py-4 border-b">
              <div className="flex items-center justify-between">
                <DialogTitle className="text-lg font-medium">
                  Your API key has been created
                </DialogTitle>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 p-0"
                  onClick={() => {
                    setShowNewKeyDialog(false)
                    setNewKey(null)
                  }}
                >
                  <X className="h-4 w-4" />
                  <span className="sr-only">Close</span>
                </Button>
              </div>
              <DialogDescription className="pt-2">
                This is the only time you will see your API key. Copy it now and store it securely.
              </DialogDescription>
            </DialogHeader>

            {newKey && (
              <div className="pt-4 px-6 pb-6 flex-1">
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
                    For security, we don&apos;t store the complete key. You won&apos;t be able to
                    view it again.
                  </p>
                </div>
              </div>
            )}

            <div className="border-t px-6 py-4 flex justify-end">
              <Button
                onClick={() => {
                  setShowNewKeyDialog(false)
                  setNewKey(null)
                }}
              >
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </form>
    </Form>
  )
}
