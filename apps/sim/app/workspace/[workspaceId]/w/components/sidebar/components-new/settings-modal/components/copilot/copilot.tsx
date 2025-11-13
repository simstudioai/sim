import { useState } from 'react'
import { Check, Copy, Plus } from 'lucide-react'
import {
  Modal,
  ModalContent,
  ModalDescription,
  ModalFooter,
  ModalHeader,
  ModalTitle,
} from '@/components/emcn'
import { Button, Input, Label } from '@/components/ui'
import { createLogger } from '@/lib/logs/console/logger'
import {
  type CopilotKey,
  useCopilotKeys,
  useDeleteCopilotKey,
  useGenerateCopilotKey,
} from '@/hooks/queries/copilot-keys'

const logger = createLogger('CopilotSettings')

// Commented out model-related code
// interface ModelOption {
//   value: string
//   label: string
//   icon: 'brain' | 'brainCircuit' | 'zap'
// }

// const OPENAI_MODELS: ModelOption[] = [
//   // Zap models first
//   { value: 'gpt-4o', label: 'gpt-4o', icon: 'zap' },
//   { value: 'gpt-4.1', label: 'gpt-4.1', icon: 'zap' },
//   { value: 'gpt-5-fast', label: 'gpt-5-fast', icon: 'zap' },
//   // Brain models
//   { value: 'gpt-5', label: 'gpt-5', icon: 'brain' },
//   { value: 'gpt-5-medium', label: 'gpt-5-medium', icon: 'brain' },
//   // BrainCircuit models
//   { value: 'gpt-5-high', label: 'gpt-5-high', icon: 'brainCircuit' },
//   { value: 'o3', label: 'o3', icon: 'brainCircuit' },
// ]

// const ANTHROPIC_MODELS: ModelOption[] = [
//   // Zap model (Haiku)
//   { value: 'claude-4.5-haiku', label: 'claude-4.5-haiku', icon: 'zap' },
//   // Brain models
//   { value: 'claude-4-sonnet', label: 'claude-4-sonnet', icon: 'brain' },
//   { value: 'claude-4.5-sonnet', label: 'claude-4.5-sonnet', icon: 'brain' },
//   // BrainCircuit models
//   { value: 'claude-4.1-opus', label: 'claude-4.1-opus', icon: 'brainCircuit' },
// ]

// const ALL_MODELS: ModelOption[] = [...OPENAI_MODELS, ...ANTHROPIC_MODELS]

// // Default enabled/disabled state for all models
// const DEFAULT_ENABLED_MODELS: Record<string, boolean> = {
//   'gpt-4o': false,
//   'gpt-4.1': false,
//   'gpt-5-fast': false,
//   'gpt-5': true,
//   'gpt-5-medium': true,
//   'gpt-5-high': false,
//   o3: true,
//   'claude-4-sonnet': false,
//   'claude-4.5-haiku': true,
//   'claude-4.5-sonnet': true,
//   'claude-4.1-opus': true,
// }

// const getModelIcon = (iconType: 'brain' | 'brainCircuit' | 'zap') => {
//   switch (iconType) {
//     case 'brainCircuit':
//       return <BrainCircuit className='h-3.5 w-3.5 text-muted-foreground' />
//     case 'brain':
//       return <Brain className='h-3.5 w-3.5 text-muted-foreground' />
//     case 'zap':
//       return <Zap className='h-3.5 w-3.5 text-muted-foreground' />
//   }
// }

export function Copilot() {
  // React Query hooks
  const { data: keys = [] } = useCopilotKeys()
  const generateKey = useGenerateCopilotKey()
  const deleteKeyMutation = useDeleteCopilotKey()

  // Create flow state
  const [showNewKeyDialog, setShowNewKeyDialog] = useState(false)
  const [newKey, setNewKey] = useState<string | null>(null)
  const [copySuccess, setCopySuccess] = useState(false)

  // Delete flow state
  const [deleteKey, setDeleteKey] = useState<CopilotKey | null>(null)
  const [showDeleteDialog, setShowDeleteDialog] = useState(false)
  const [deleteConfirmationKey, setDeleteConfirmationKey] = useState('')

  const onGenerate = async () => {
    try {
      const data = await generateKey.mutateAsync()
      if (data?.key?.apiKey) {
        setNewKey(data.key.apiKey)
        setShowNewKeyDialog(true)
      }
    } catch (error) {
      logger.error('Failed to generate copilot API key', { error })
    }
  }

  const copyToClipboard = (key: string) => {
    navigator.clipboard.writeText(key)
    setCopySuccess(true)
    setTimeout(() => setCopySuccess(false), 2000)
  }

  const handleDeleteKey = async () => {
    if (!deleteKey) return
    try {
      // Close dialog and clear state immediately for optimistic update
      setShowDeleteDialog(false)
      const keyToDelete = deleteKey
      setDeleteKey(null)
      setDeleteConfirmationKey('')

      await deleteKeyMutation.mutateAsync({ keyId: keyToDelete.id })
    } catch (error) {
      logger.error('Failed to delete copilot API key', { error })
    }
  }

  // Commented out model-related functions
  // const toggleModel = async (modelValue: string, enabled: boolean) => {
  //   const newModelsMap = { ...enabledModelsMap, [modelValue]: enabled }
  //   setEnabledModelsMap(newModelsMap)

  //   // Convert to array for store
  //   const enabledArray = Object.entries(newModelsMap)
  //     .filter(([_, isEnabled]) => isEnabled)
  //     .map(([modelId]) => modelId)
  //   setStoreEnabledModels(enabledArray)

  //   try {
  //     const res = await fetch('/api/copilot/user-models', {
  //       method: 'PUT',
  //       headers: { 'Content-Type': 'application/json' },
  //       body: JSON.stringify({ enabledModels: newModelsMap }),
  //     })

  //     if (!res.ok) {
  //       throw new Error('Failed to update models')
  //     }
  //   } catch (error) {
  //     logger.error('Failed to update enabled models', { error })
  //     // Revert on error
  //     setEnabledModelsMap(enabledModelsMap)
  //     const revertedArray = Object.entries(enabledModelsMap)
  //       .filter(([_, isEnabled]) => isEnabled)
  //       .map(([modelId]) => modelId)
  //     setStoreEnabledModels(revertedArray)
  //   }
  // }

  // const enabledCount = Object.values(enabledModelsMap).filter(Boolean).length
  // const totalCount = ALL_MODELS.length

  return (
    <div className='relative flex h-full flex-col'>
      {/* Scrollable Content */}
      <div className='min-h-0 flex-1 overflow-y-auto px-6'>
        <div className='space-y-2 pt-2 pb-6'>
          {keys.length === 0 ? (
            <div className='flex h-full items-center justify-center text-muted-foreground text-sm'>
              Click "Create Key" below to get started
            </div>
          ) : (
            <>
              <div className='mb-2 font-medium text-[13px] text-foreground'>Copilot API Keys</div>
              {keys.map((key) => (
                <div key={key.id} className='flex flex-col gap-2'>
                  <Label className='font-normal text-muted-foreground text-xs uppercase'>
                    API KEY
                  </Label>
                  <div className='flex items-center justify-between gap-4'>
                    <div className='flex items-center gap-3'>
                      <div className='flex h-8 items-center rounded-[8px] bg-muted px-3'>
                        <code className='font-mono text-foreground text-xs'>{key.displayKey}</code>
                      </div>
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
                </div>
              ))}
            </>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className='bg-background'>
        <div className='flex w-full items-center px-6 py-4'>
          <Button
            onClick={onGenerate}
            variant='ghost'
            disabled={generateKey.isPending}
            className='h-9 rounded-[8px] border bg-background px-3 shadow-xs hover:bg-muted focus:outline-none focus-visible:ring-0 focus-visible:ring-offset-0 disabled:cursor-not-allowed disabled:opacity-60'
          >
            <Plus className='h-4 w-4 stroke-[2px]' />
            Create Key
          </Button>
        </div>
      </div>

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
                <code className='flex-1 truncate font-mono text-foreground text-sm'>{newKey}</code>
              </div>
              <Button
                variant='ghost'
                className='-translate-y-1/2 absolute top-1/2 right-1 h-7 w-7 rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground'
                onClick={() => copyToClipboard(newKey)}
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
                Enter <span className='font-semibold'>{deleteKey.displayKey}</span> to confirm.
              </p>
              <Input
                value={deleteConfirmationKey}
                onChange={(e) => setDeleteConfirmationKey(e.target.value)}
                placeholder='Type key to confirm'
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
                setDeleteConfirmationKey('')
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleDeleteKey}
              className='h-9 w-full rounded-[8px] bg-red-500 text-white transition-all duration-200 hover:bg-red-600 dark:bg-red-500 dark:hover:bg-red-600'
              disabled={!deleteKey || deleteConfirmationKey !== deleteKey.displayKey}
            >
              Delete
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  )
}
