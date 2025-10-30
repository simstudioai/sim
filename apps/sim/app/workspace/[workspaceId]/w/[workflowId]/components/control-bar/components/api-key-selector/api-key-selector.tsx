'use client'

import { useEffect, useState } from 'react'
import { Check, Copy, Info, Loader2, Plus } from 'lucide-react'
import { useParams } from 'next/navigation'
import { Tooltip } from '@/components/emcn'
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
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectTrigger,
  SelectValue,
} from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'

const logger = createLogger('ApiKeySelector')

export interface ApiKey {
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
}

interface ApiKeySelectorProps {
  value: string
  onChange: (keyId: string) => void
  disabled?: boolean
  apiKeys?: ApiKey[]
  onApiKeyCreated?: () => void
  showLabel?: boolean
  label?: string
  isDeployed?: boolean
  deployedApiKeyDisplay?: string
}

export function ApiKeySelector({
  value,
  onChange,
  disabled = false,
  apiKeys = [],
  onApiKeyCreated,
  showLabel = true,
  label = 'API Key',
  isDeployed = false,
  deployedApiKeyDisplay,
}: ApiKeySelectorProps) {
  const params = useParams()
  const workspaceId = (params?.workspaceId as string) || ''
  const userPermissions = useUserPermissionsContext()
  const canCreateWorkspaceKeys = userPermissions.canEdit || userPermissions.canAdmin

  const [apiKeysData, setApiKeysData] = useState<ApiKeysData | null>(null)
  const [isCreatingKey, setIsCreatingKey] = useState(false)
  const [newKeyName, setNewKeyName] = useState('')
  const [keyType, setKeyType] = useState<'personal' | 'workspace'>('personal')
  const [newKey, setNewKey] = useState<ApiKey | null>(null)
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [copySuccess, setCopySuccess] = useState(false)
  const [isSubmittingCreate, setIsSubmittingCreate] = useState(false)
  const [keysLoaded, setKeysLoaded] = useState(false)
  const [createError, setCreateError] = useState<string | null>(null)
  const [justCreatedKeyId, setJustCreatedKeyId] = useState<string | null>(null)

  useEffect(() => {
    fetchApiKeys()
  }, [workspaceId])

  const fetchApiKeys = async () => {
    try {
      setKeysLoaded(false)
      const [workspaceRes, personalRes] = await Promise.all([
        fetch(`/api/workspaces/${workspaceId}/api-keys`),
        fetch('/api/users/me/api-keys'),
      ])

      const workspaceData = workspaceRes.ok ? await workspaceRes.json() : { keys: [] }
      const personalData = personalRes.ok ? await personalRes.json() : { keys: [] }

      setApiKeysData({
        workspace: workspaceData.keys || [],
        personal: personalData.keys || [],
      })
      setKeysLoaded(true)
    } catch (error) {
      logger.error('Error fetching API keys:', { error })
      setKeysLoaded(true)
    }
  }

  const handleCreateKey = async () => {
    if (!newKeyName.trim()) {
      setCreateError('Please enter a name for the API key')
      return
    }

    try {
      setIsSubmittingCreate(true)
      setCreateError(null)

      const endpoint =
        keyType === 'workspace'
          ? `/api/workspaces/${workspaceId}/api-keys`
          : '/api/users/me/api-keys'

      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newKeyName }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to create API key')
      }

      const data = await response.json()
      setNewKey(data.key)
      setJustCreatedKeyId(data.key.id)
      setShowNewKeyDialog(true)
      setIsCreatingKey(false)
      setNewKeyName('')

      // Refresh API keys
      await fetchApiKeys()
      onApiKeyCreated?.()
    } catch (error: any) {
      setCreateError(error.message || 'Failed to create API key')
    } finally {
      setIsSubmittingCreate(false)
    }
  }

  const handleCopyKey = async () => {
    if (newKey?.key) {
      await navigator.clipboard.writeText(newKey.key)
      setCopySuccess(true)
      setTimeout(() => setCopySuccess(false), 2000)
    }
  }

  if (isDeployed && deployedApiKeyDisplay) {
    return (
      <div className='space-y-1.5'>
        {showLabel && (
          <div className='flex items-center gap-1.5'>
            <Label className='font-medium text-sm'>{label}</Label>

            <Tooltip.Root>
              <Tooltip.Trigger asChild>
                <Info className='h-3.5 w-3.5 text-muted-foreground' />
              </Tooltip.Trigger>
              <Tooltip.Content>
                <p>Owner is billed for usage</p>
              </Tooltip.Content>
            </Tooltip.Root>
          </div>
        )}
        <div className='rounded-md border bg-background'>
          <div className='flex items-center justify-between p-3'>
            <pre className='flex-1 overflow-x-auto whitespace-pre-wrap font-mono text-xs'>
              {(() => {
                const match = deployedApiKeyDisplay.match(/^(.*?)\s+\(([^)]+)\)$/)
                if (match) {
                  return match[1].trim()
                }
                return deployedApiKeyDisplay
              })()}
            </pre>
            {(() => {
              const match = deployedApiKeyDisplay.match(/^(.*?)\s+\(([^)]+)\)$/)
              if (match) {
                const type = match[2]
                return (
                  <div className='ml-2 flex-shrink-0'>
                    <span className='inline-flex items-center rounded-md bg-muted px-2 py-1 font-medium text-muted-foreground text-xs capitalize'>
                      {type}
                    </span>
                  </div>
                )
              }
              return null
            })()}
          </div>
        </div>
      </div>
    )
  }

  return (
    <>
      <div className='space-y-2'>
        {showLabel && (
          <div className='flex items-center justify-between'>
            <div className='flex items-center gap-1.5'>
              <Label className='font-medium text-sm'>{label}</Label>

              <Tooltip.Root>
                <Tooltip.Trigger asChild>
                  <Info className='h-3.5 w-3.5 text-muted-foreground' />
                </Tooltip.Trigger>
                <Tooltip.Content>
                  <p>Key Owner is Billed</p>
                </Tooltip.Content>
              </Tooltip.Root>
            </div>
            {!disabled && (
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
            )}
          </div>
        )}
        <Select value={value} onValueChange={onChange} disabled={disabled || !keysLoaded}>
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
              <div className='px-3 py-2 text-muted-foreground text-sm'>No API keys available</div>
            )}

            {apiKeysData &&
              apiKeysData.workspace.length === 0 &&
              apiKeysData.personal.length === 0 && (
                <div className='px-3 py-2 text-muted-foreground text-sm'>No API keys available</div>
              )}
          </SelectContent>
        </Select>
      </div>

      {/* Create Key Dialog */}
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
              <Label htmlFor='new-key-name'>API Key Name</Label>
              <Input
                id='new-key-name'
                placeholder='My API Key'
                value={newKeyName}
                onChange={(e) => {
                  setNewKeyName(e.target.value)
                  if (createError) setCreateError(null)
                }}
                disabled={isSubmittingCreate}
              />
              {createError && <p className='text-destructive text-sm'>{createError}</p>}
            </div>
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel
              disabled={isSubmittingCreate}
              onClick={() => {
                setNewKeyName('')
                setCreateError(null)
              }}
            >
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={isSubmittingCreate || !newKeyName.trim()}
              onClick={(e) => {
                e.preventDefault()
                handleCreateKey()
              }}
            >
              {isSubmittingCreate ? (
                <>
                  <Loader2 className='mr-1.5 h-3 w-3 animate-spin' />
                  Creating...
                </>
              ) : (
                'Create'
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* New Key Dialog */}
      <AlertDialog
        open={showNewKeyDialog}
        onOpenChange={(open) => {
          setShowNewKeyDialog(open)
          if (!open) {
            setNewKey(null)
            setCopySuccess(false)
            if (justCreatedKeyId) {
              onChange(justCreatedKeyId)
              setJustCreatedKeyId(null)
            }
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
                onClick={handleCopyKey}
              >
                {copySuccess ? <Check className='h-3.5 w-3.5' /> : <Copy className='h-3.5 w-3.5' />}
                <span className='sr-only'>Copy to clipboard</span>
              </Button>
            </div>
          )}
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
