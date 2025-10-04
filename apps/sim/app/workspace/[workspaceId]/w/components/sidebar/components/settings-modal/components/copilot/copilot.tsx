import { useCallback, useEffect, useRef, useState } from 'react'
import { Brain, BrainCircuit, Check, Copy, Plus, Zap } from 'lucide-react'
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
  Skeleton,
  Switch,
} from '@/components/ui'
import { isHosted } from '@/lib/environment'
import { createLogger } from '@/lib/logs/console/logger'
import { useCopilotStore } from '@/stores/copilot/store'

const logger = createLogger('CopilotSettings')

interface CopilotKey {
  id: string
  displayKey: string
}

interface ModelOption {
  value: string
  label: string
  icon: 'brain' | 'brainCircuit' | 'zap'
}

const OPENAI_MODELS: ModelOption[] = [
  // Zap models first
  { value: 'gpt-4o', label: 'gpt-4o', icon: 'zap' },
  { value: 'gpt-4.1', label: 'gpt-4.1', icon: 'zap' },
  { value: 'gpt-5-fast', label: 'gpt-5-fast', icon: 'zap' },
  // Brain models
  { value: 'gpt-5', label: 'gpt-5', icon: 'brain' },
  { value: 'gpt-5-medium', label: 'gpt-5-medium', icon: 'brain' },
  // BrainCircuit models
  { value: 'gpt-5-high', label: 'gpt-5-high', icon: 'brainCircuit' },
  { value: 'o3', label: 'o3', icon: 'brainCircuit' },
]

const ANTHROPIC_MODELS: ModelOption[] = [
  // Brain models
  { value: 'claude-4-sonnet', label: 'claude-4-sonnet', icon: 'brain' },
  { value: 'claude-4.5-sonnet', label: 'claude-4.5-sonnet', icon: 'brain' },
  // BrainCircuit models
  { value: 'claude-4.1-opus', label: 'claude-4.1-opus', icon: 'brainCircuit' },
]

const ALL_MODELS: ModelOption[] = [...OPENAI_MODELS, ...ANTHROPIC_MODELS]

// Default enabled/disabled state for all models
const DEFAULT_ENABLED_MODELS: Record<string, boolean> = {
  'gpt-4o': false,
  'gpt-4.1': false,
  'gpt-5-fast': false,
  'gpt-5': true,
  'gpt-5-medium': true,
  'gpt-5-high': false,
  o3: true,
  'claude-4-sonnet': true,
  'claude-4.5-sonnet': true,
  'claude-4.1-opus': true,
}

const getModelIcon = (iconType: 'brain' | 'brainCircuit' | 'zap') => {
  switch (iconType) {
    case 'brainCircuit':
      return <BrainCircuit className='h-3.5 w-3.5 text-muted-foreground' />
    case 'brain':
      return <Brain className='h-3.5 w-3.5 text-muted-foreground' />
    case 'zap':
      return <Zap className='h-3.5 w-3.5 text-muted-foreground' />
  }
}

export function Copilot() {
  const [keys, setKeys] = useState<CopilotKey[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [enabledModelsMap, setEnabledModelsMap] = useState<Record<string, boolean>>({})
  const [isModelsLoading, setIsModelsLoading] = useState(true)
  const hasFetchedModels = useRef(false)

  const { setEnabledModels: setStoreEnabledModels } = useCopilotStore()

  // Create flow state
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [newKeyCopySuccess, setNewKeyCopySuccess] = useState(false)

  // Delete flow state
  const [deleteKey, setDeleteKey] = useState<CopilotKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)

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

  const fetchEnabledModels = useCallback(async () => {
    if (hasFetchedModels.current) return
    hasFetchedModels.current = true

    try {
      setIsModelsLoading(true)
      const res = await fetch('/api/copilot/user-models')
      if (!res.ok) throw new Error(`Failed to fetch: ${res.status}`)
      const data = await res.json()
      const modelsMap = data.enabledModels || DEFAULT_ENABLED_MODELS

      setEnabledModelsMap(modelsMap)

      // Convert to array for store (API already merged with defaults)
      const enabledArray = Object.entries(modelsMap)
        .filter(([_, enabled]) => enabled)
        .map(([modelId]) => modelId)
      setStoreEnabledModels(enabledArray)
    } catch (error) {
      logger.error('Failed to fetch enabled models', { error })
      setEnabledModelsMap(DEFAULT_ENABLED_MODELS)
      setStoreEnabledModels(
        Object.keys(DEFAULT_ENABLED_MODELS).filter((key) => DEFAULT_ENABLED_MODELS[key])
      )
    } finally {
      setIsModelsLoading(false)
    }
  }, [setStoreEnabledModels])

  useEffect(() => {
    if (isHosted) {
      fetchKeys()
    }
    fetchEnabledModels()
  }, [])

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

  const onCopy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value)
      setNewKeyCopySuccess(true)
      setTimeout(() => setNewKeyCopySuccess(false), 1500)
    } catch (error) {
      logger.error('Copy failed', { error })
    }
  }

  const toggleModel = async (modelValue: string, enabled: boolean) => {
    const newModelsMap = { ...enabledModelsMap, [modelValue]: enabled }
    setEnabledModelsMap(newModelsMap)

    // Convert to array for store
    const enabledArray = Object.entries(newModelsMap)
      .filter(([_, isEnabled]) => isEnabled)
      .map(([modelId]) => modelId)
    setStoreEnabledModels(enabledArray)

    try {
      const res = await fetch('/api/copilot/user-models', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabledModels: newModelsMap }),
      })

      if (!res.ok) {
        throw new Error('Failed to update models')
      }
    } catch (error) {
      logger.error('Failed to update enabled models', { error })
      // Revert on error
      setEnabledModelsMap(enabledModelsMap)
      const revertedArray = Object.entries(enabledModelsMap)
        .filter(([_, isEnabled]) => isEnabled)
        .map(([modelId]) => modelId)
      setStoreEnabledModels(revertedArray)
    }
  }

  const enabledCount = Object.values(enabledModelsMap).filter(Boolean).length
  const totalCount = ALL_MODELS.length

  return (
    <div className='relative flex h-full flex-col'>
      {/* Sticky Header with API Keys (only for hosted) */}
      {isHosted && (
        <div className='sticky top-0 z-10 border-b bg-background px-6 py-4'>
          <div className='space-y-3'>
            {/* API Keys Header */}
            <div className='flex items-center justify-between'>
              <div>
                <h3 className='font-semibold text-foreground text-sm'>API Keys</h3>
                <p className='text-muted-foreground text-xs'>
                  Generate keys for programmatic access
                </p>
              </div>
              <Button
                onClick={onGenerate}
                variant='ghost'
                size='sm'
                className='h-8 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0'
                disabled={isLoading}
              >
                <Plus className='h-3.5 w-3.5 stroke-[2px]' />
                Create
              </Button>
            </div>

            {/* API Keys List */}
            <div className='space-y-2'>
              {isLoading ? (
                <>
                  <CopilotKeySkeleton />
                  <CopilotKeySkeleton />
                </>
              ) : keys.length === 0 ? (
                <div className='py-3 text-center text-muted-foreground text-xs'>
                  No API keys yet
                </div>
              ) : (
                keys.map((k) => (
                  <div
                    key={k.id}
                    className='flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-3 py-2'
                  >
                    <div className='flex min-w-0 items-center gap-3'>
                      <code className='truncate font-mono text-foreground text-xs'>
                        {k.displayKey}
                      </code>
                    </div>

                    <Button
                      variant='ghost'
                      size='sm'
                      onClick={() => {
                        setDeleteKey(k)
                        setShowDeleteDialog(true)
                      }}
                      className='h-7 flex-shrink-0 text-muted-foreground text-xs hover:text-foreground'
                    >
                      Delete
                    </Button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}

      {/* Scrollable Content - Models Section */}
      <div className='scrollbar-thin scrollbar-thumb-muted scrollbar-track-transparent flex-1 overflow-y-auto px-6 py-4'>
        <div className='space-y-3'>
          {/* Models Header */}
          <div>
            <h3 className='font-semibold text-foreground text-sm'>Models</h3>
            <div className='text-muted-foreground text-xs'>
              {isModelsLoading ? (
                <Skeleton className='mt-0.5 h-3 w-32' />
              ) : (
                <span>
                  {enabledCount} of {totalCount} enabled
                </span>
              )}
            </div>
          </div>

          {/* Models List */}
          {isModelsLoading ? (
            <div className='space-y-2'>
              {[1, 2, 3, 4, 5].map((i) => (
                <div key={i} className='flex items-center justify-between py-1.5'>
                  <Skeleton className='h-4 w-32' />
                  <Skeleton className='h-5 w-9 rounded-full' />
                </div>
              ))}
            </div>
          ) : (
            <div className='space-y-4'>
              {/* OpenAI Models */}
              <div>
                <div className='mb-2 px-2 font-medium text-[10px] text-muted-foreground uppercase'>
                  OpenAI
                </div>
                <div className='space-y-1'>
                  {OPENAI_MODELS.map((model) => {
                    const isEnabled = enabledModelsMap[model.value] ?? false
                    return (
                      <div
                        key={model.value}
                        className='-mx-2 flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted/50'
                      >
                        <div className='flex items-center gap-2'>
                          {getModelIcon(model.icon)}
                          <span className='text-foreground text-sm'>{model.label}</span>
                        </div>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) => toggleModel(model.value, checked)}
                          className='scale-90'
                        />
                      </div>
                    )
                  })}
                </div>
              </div>

              {/* Anthropic Models */}
              <div>
                <div className='mb-2 px-2 font-medium text-[10px] text-muted-foreground uppercase'>
                  Anthropic
                </div>
                <div className='space-y-1'>
                  {ANTHROPIC_MODELS.map((model) => {
                    const isEnabled = enabledModelsMap[model.value] ?? false
                    return (
                      <div
                        key={model.value}
                        className='-mx-2 flex items-center justify-between rounded px-2 py-1.5 hover:bg-muted/50'
                      >
                        <div className='flex items-center gap-2'>
                          {getModelIcon(model.icon)}
                          <span className='text-foreground text-sm'>{model.label}</span>
                        </div>
                        <Switch
                          checked={isEnabled}
                          onCheckedChange={(checked) => toggleModel(model.value, checked)}
                          className='scale-90'
                        />
                      </div>
                    )
                  })}
                </div>
              </div>
            </div>
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
    <div className='flex items-center justify-between gap-4 rounded-lg border bg-muted/30 px-3 py-2'>
      <Skeleton className='h-4 w-48' />
      <Skeleton className='h-7 w-14' />
    </div>
  )
}
