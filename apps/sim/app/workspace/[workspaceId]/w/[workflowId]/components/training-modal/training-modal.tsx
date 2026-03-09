'use client'

import { useState } from 'react'
import { createLogger } from '@sim/logger'
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Clipboard,
  Download,
  Eye,
  Send,
  Trash2,
  X,
  XCircle,
} from 'lucide-react'
import {
  Button,
  Checkbox,
  Input,
  Label,
  Modal,
  ModalBody,
  ModalContent,
  ModalHeader,
  ModalTabs,
  ModalTabsContent,
  ModalTabsList,
  ModalTabsTrigger,
  Textarea,
} from '@/components/emcn'
import { cn } from '@/lib/core/utils/cn'
import { formatDuration } from '@/lib/core/utils/formatting'
import { sanitizeForCopilot } from '@/lib/workflows/sanitization/json-sanitizer'
import { formatEditSequence } from '@/lib/workflows/training/compute-edit-sequence'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'

const logger = createLogger('TrainingModal')

/**
 * Modal for starting training sessions and viewing/exporting datasets
 */
export function TrainingModal() {
  const {
    isTraining,
    currentTitle,
    currentPrompt,
    startSnapshot,
    datasets,
    showModal,
    setPrompt,
    startTraining,
    cancelTraining,
    toggleModal,
    clearDatasets,
    exportDatasets,
    markDatasetSent,
  } = useCopilotTrainingStore()

  const currentWorkflow = useCurrentWorkflow()

  const [localPrompt, setLocalPrompt] = useState(currentPrompt)
  const [localTitle, setLocalTitle] = useState(currentTitle)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [viewingDataset, setViewingDataset] = useState<string | null>(null)
  const [expandedDataset, setExpandedDataset] = useState<string | null>(null)
  const [sendingDatasets, setSendingDatasets] = useState<Set<string>>(new Set())
  const [sendingAll, setSendingAll] = useState(false)
  const [selectedDatasets, setSelectedDatasets] = useState<Set<string>>(new Set())
  const [sendingSelected, setSendingSelected] = useState(false)
  const [sentDatasets, setSentDatasets] = useState<Set<string>>(new Set())
  const [failedDatasets, setFailedDatasets] = useState<Set<string>>(new Set())
  const [sendingLiveWorkflow, setSendingLiveWorkflow] = useState(false)
  const [liveWorkflowSent, setLiveWorkflowSent] = useState(false)
  const [liveWorkflowFailed, setLiveWorkflowFailed] = useState(false)
  const [liveWorkflowTitle, setLiveWorkflowTitle] = useState('')
  const [liveWorkflowDescription, setLiveWorkflowDescription] = useState('')
  const [activeTab, setActiveTab] = useState(isTraining ? 'datasets' : 'new')

  const handleStart = () => {
    if (localTitle.trim() && localPrompt.trim()) {
      startTraining(localTitle, localPrompt)
      setLocalTitle('')
      setLocalPrompt('')
    }
  }

  const handleCopyDataset = (dataset: any) => {
    const dataStr = JSON.stringify(
      {
        prompt: dataset.prompt,
        startState: dataset.startState,
        endState: dataset.endState,
        editSequence: dataset.editSequence,
        metadata: dataset.metadata,
      },
      null,
      2
    )

    navigator.clipboard.writeText(dataStr)
    setCopiedId(dataset.id)
    setTimeout(() => setCopiedId(null), 2000)
  }

  const handleExportAll = () => {
    const dataStr = exportDatasets()
    const blob = new Blob([dataStr], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `copilot-training-${new Date().toISOString().split('T')[0]}.json`
    a.click()
    URL.revokeObjectURL(url)
  }

  const sendToIndexer = async (dataset: any) => {
    try {
      // Sanitize workflow states to remove UI-specific data (positions, lastSaved, etc)
      const sanitizedInput = sanitizeForCopilot(dataset.startState)
      const sanitizedOutput = sanitizeForCopilot(dataset.endState)

      // Send to the indexer with sanitized JSON workflow states
      const response = await fetch('/api/copilot/training', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: dataset.title,
          prompt: dataset.prompt,
          input: sanitizedInput,
          output: sanitizedOutput,
          operations: dataset.editSequence,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        throw new Error(result.error || 'Failed to send to indexer')
      }

      return result
    } catch (error) {
      logger.error('Failed to send dataset to indexer:', error)
      throw error
    }
  }

  const handleSendOne = (dataset: any) => {
    // Clear any previous status for this dataset
    setSentDatasets((prev) => {
      const newSet = new Set(prev)
      newSet.delete(dataset.id)
      return newSet
    })
    setFailedDatasets((prev) => {
      const newSet = new Set(prev)
      newSet.delete(dataset.id)
      return newSet
    })

    // Add to sending set
    setSendingDatasets((prev) => new Set(prev).add(dataset.id))

    // Fire and forget - handle async without blocking
    sendToIndexer(dataset)
      .then(() => {
        // Remove from sending and mark as sent
        setSendingDatasets((prev) => {
          const newSet = new Set(prev)
          newSet.delete(dataset.id)
          return newSet
        })
        setSentDatasets((prev) => new Set(prev).add(dataset.id))
        // Persist sent marker in store
        markDatasetSent(dataset.id)
        // Clear success indicator after 5 seconds
        setTimeout(() => {
          setSentDatasets((prev) => {
            const newSet = new Set(prev)
            newSet.delete(dataset.id)
            return newSet
          })
        }, 5000)
      })
      .catch((error) => {
        // Remove from sending and mark as failed
        setSendingDatasets((prev) => {
          const newSet = new Set(prev)
          newSet.delete(dataset.id)
          return newSet
        })
        setFailedDatasets((prev) => new Set(prev).add(dataset.id))
        // Clear failure indicator after 5 seconds
        setTimeout(() => {
          setFailedDatasets((prev) => {
            const newSet = new Set(prev)
            newSet.delete(dataset.id)
            return newSet
          })
        }, 5000)
      })
  }

  const handleSendAll = async () => {
    setSendingAll(true)
    try {
      const results = await Promise.allSettled(datasets.map((dataset) => sendToIndexer(dataset)))

      const successes = results.filter((r) => r.status === 'fulfilled')
      const failures = results.filter((r) => r.status === 'rejected')

      // Mark successes and failures visually
      const successfulIds = datasets
        .filter((_, i) => results[i].status === 'fulfilled')
        .map((d) => d.id)
      const failedIds = datasets.filter((_, i) => results[i].status === 'rejected').map((d) => d.id)

      setSentDatasets((prev) => new Set([...prev, ...successfulIds]))
      setFailedDatasets((prev) => new Set([...prev, ...failedIds]))

      // Persist sent markers for successes
      successfulIds.forEach((id) => markDatasetSent(id))

      // Auto-clear failure badges after 5s
      if (failedIds.length > 0) {
        setTimeout(() => {
          setFailedDatasets((prev) => {
            const newSet = new Set(prev)
            failedIds.forEach((id) => newSet.delete(id))
            return newSet
          })
        }, 5000)
      }
    } finally {
      setSendingAll(false)
    }
  }

  const handleSendSelected = async () => {
    if (selectedDatasets.size === 0) return

    setSendingSelected(true)
    try {
      const datasetsToSend = datasets.filter((d) => selectedDatasets.has(d.id))
      const results = await Promise.allSettled(
        datasetsToSend.map((dataset) => sendToIndexer(dataset))
      )

      const successfulIds = datasetsToSend
        .filter((_, i) => results[i].status === 'fulfilled')
        .map((d) => d.id)
      const failedIds = datasetsToSend
        .filter((_, i) => results[i].status === 'rejected')
        .map((d) => d.id)

      setSentDatasets((prev) => new Set([...prev, ...successfulIds]))
      setFailedDatasets((prev) => new Set([...prev, ...failedIds]))
      successfulIds.forEach((id) => markDatasetSent(id))

      // Remove successes from selection
      setSelectedDatasets((prev) => {
        const newSet = new Set(prev)
        successfulIds.forEach((id) => newSet.delete(id))
        return newSet
      })

      // Auto-clear failure badges after 5s
      if (failedIds.length > 0) {
        setTimeout(() => {
          setFailedDatasets((prev) => {
            const newSet = new Set(prev)
            failedIds.forEach((id) => newSet.delete(id))
            return newSet
          })
        }, 5000)
      }
    } finally {
      setSendingSelected(false)
    }
  }

  const toggleDatasetSelection = (datasetId: string) => {
    const newSelection = new Set(selectedDatasets)
    if (newSelection.has(datasetId)) {
      newSelection.delete(datasetId)
    } else {
      newSelection.add(datasetId)
    }
    setSelectedDatasets(newSelection)
  }

  const toggleSelectAll = () => {
    if (selectedDatasets.size === datasets.length) {
      setSelectedDatasets(new Set())
    } else {
      setSelectedDatasets(new Set(datasets.map((d) => d.id)))
    }
  }

  const handleSendLiveWorkflow = async () => {
    if (!liveWorkflowTitle.trim() || !liveWorkflowDescription.trim()) {
      return
    }

    setLiveWorkflowSent(false)
    setLiveWorkflowFailed(false)
    setSendingLiveWorkflow(true)

    try {
      const sanitizedWorkflow = sanitizeForCopilot(currentWorkflow.workflowState)

      const response = await fetch('/api/copilot/training/examples', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          json: JSON.stringify(sanitizedWorkflow),
          title: liveWorkflowTitle,
          tags: [],
          metadata: {
            summary: liveWorkflowDescription,
          },
        }),
      })

      if (!response.ok) {
        const error = await response.json()
        throw new Error(error.error || 'Failed to send live workflow')
      }

      setLiveWorkflowSent(true)
      setLiveWorkflowTitle('')
      setLiveWorkflowDescription('')
      setTimeout(() => setLiveWorkflowSent(false), 5000)
    } catch (error) {
      logger.error('Failed to send live workflow:', error)
      setLiveWorkflowFailed(true)
      setTimeout(() => setLiveWorkflowFailed(false), 5000)
    } finally {
      setSendingLiveWorkflow(false)
    }
  }

  return (
    <Modal open={showModal} onOpenChange={toggleModal}>
      <ModalContent size='lg'>
        <ModalHeader>Copilot Training Dataset Builder</ModalHeader>

        <ModalTabs value={activeTab} onValueChange={setActiveTab}>
          <ModalTabsList>
            <ModalTabsTrigger value='new' disabled={isTraining}>
              New Session
            </ModalTabsTrigger>
            <ModalTabsTrigger value='datasets'>Datasets ({datasets.length})</ModalTabsTrigger>
            <ModalTabsTrigger value='live'>Send Live State</ModalTabsTrigger>
          </ModalTabsList>

          <ModalBody className='flex min-h-[400px] flex-col overflow-hidden'>
            {/* Recording Banner */}
            {isTraining && (
              <div className='mb-[16px] rounded-[8px] border bg-orange-50 p-[12px] dark:bg-orange-950/30'>
                <p className='mb-[8px] font-medium text-[13px] text-orange-700 dark:text-orange-300'>
                  Recording: {currentTitle}
                </p>
                <p className='mb-[12px] text-[12px] text-[var(--text-secondary)]'>
                  {currentPrompt}
                </p>
                <div className='flex gap-[8px]'>
                  <Button variant='default' onClick={cancelTraining} className='flex-1'>
                    <X className='mr-[6px] h-[14px] w-[14px]' />
                    Cancel
                  </Button>
                  <Button
                    variant='tertiary'
                    onClick={() => {
                      useCopilotTrainingStore.getState().stopTraining()
                      setLocalPrompt('')
                    }}
                    className='flex-1'
                  >
                    <Check className='mr-[6px] h-[14px] w-[14px]' />
                    Save Dataset
                  </Button>
                </div>
                {startSnapshot && (
                  <div className='mt-[8px] flex items-center gap-[12px] text-[12px]'>
                    <span className='text-orange-600 dark:text-orange-400'>Starting state:</span>
                    <span className='text-[var(--text-primary)]'>
                      {Object.keys(startSnapshot.blocks).length} blocks
                    </span>
                    <span className='text-[var(--text-tertiary)]'>·</span>
                    <span className='text-[var(--text-primary)]'>
                      {startSnapshot.edges.length} edges
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* New Training Session Tab */}
            <ModalTabsContent value='new' className='flex flex-col gap-[16px]'>
              <div className='flex items-center gap-[16px] text-[13px]'>
                <span className='text-[var(--text-muted)]'>Current workflow:</span>
                <span className='text-[var(--text-primary)]'>
                  {currentWorkflow.getBlockCount()} blocks
                </span>
                <span className='text-[var(--text-tertiary)]'>·</span>
                <span className='text-[var(--text-primary)]'>
                  {currentWorkflow.getEdgeCount()} edges
                </span>
              </div>

              <div className='flex flex-col gap-[8px]'>
                <Label htmlFor='title'>Title</Label>
                <Input
                  id='title'
                  placeholder='Enter a title for this training dataset...'
                  value={localTitle}
                  onChange={(e) => setLocalTitle(e.target.value)}
                  className='h-9'
                />
              </div>

              <div className='flex flex-col gap-[8px]'>
                <Label htmlFor='prompt'>Training Prompt</Label>
                <Textarea
                  id='prompt'
                  placeholder='Enter the user intent/prompt for this workflow transformation...'
                  value={localPrompt}
                  onChange={(e) => setLocalPrompt(e.target.value)}
                  rows={3}
                />
                <p className='text-[12px] text-[var(--text-muted)]'>
                  Describe what the next sequence of edits aim to achieve
                </p>
              </div>

              <Button
                onClick={handleStart}
                disabled={!localTitle.trim() || !localPrompt.trim()}
                variant='tertiary'
                className='w-full'
              >
                Start Training Session
              </Button>
            </ModalTabsContent>

            {/* Datasets Tab */}
            <ModalTabsContent value='datasets' className='flex flex-col gap-[16px]'>
              {datasets.length === 0 ? (
                <div className='py-[32px] text-center text-[13px] text-[var(--text-muted)]'>
                  No training datasets yet. Start a new session to create one.
                </div>
              ) : (
                <>
                  <div className='flex items-center justify-between'>
                    <div className='flex items-center gap-[12px]'>
                      <Checkbox
                        checked={datasets.length > 0 && selectedDatasets.size === datasets.length}
                        onCheckedChange={toggleSelectAll}
                        disabled={datasets.length === 0}
                      />
                      <p className='text-[13px] text-[var(--text-muted)]'>
                        {selectedDatasets.size > 0
                          ? `${selectedDatasets.size} of ${datasets.length} selected`
                          : `${datasets.length} dataset${datasets.length !== 1 ? 's' : ''} recorded`}
                      </p>
                    </div>
                    <div className='flex gap-[8px]'>
                      {selectedDatasets.size > 0 && (
                        <Button
                          variant='tertiary'
                          onClick={handleSendSelected}
                          disabled={sendingSelected}
                        >
                          <Send className='mr-[6px] h-[12px] w-[12px]' />
                          {sendingSelected
                            ? 'Sending...'
                            : `Send ${selectedDatasets.size} Selected`}
                        </Button>
                      )}
                      <Button
                        variant='default'
                        onClick={handleSendAll}
                        disabled={datasets.length === 0 || sendingAll}
                      >
                        <Send className='mr-[6px] h-[12px] w-[12px]' />
                        {sendingAll ? 'Sending...' : 'Send All'}
                      </Button>
                      <Button
                        variant='default'
                        onClick={handleExportAll}
                        disabled={datasets.length === 0}
                      >
                        <Download className='mr-[6px] h-[12px] w-[12px]' />
                        Export
                      </Button>
                      <Button
                        variant='default'
                        onClick={clearDatasets}
                        disabled={datasets.length === 0}
                      >
                        <Trash2 className='mr-[6px] h-[12px] w-[12px]' />
                        Clear
                      </Button>
                    </div>
                  </div>

                  <div className='max-h-[320px] overflow-y-auto'>
                    <div className='flex flex-col gap-[8px]'>
                      {datasets.map((dataset, index) => (
                        <div
                          key={dataset.id}
                          className='rounded-[8px] border bg-[var(--surface-3)] transition-colors hover:bg-[var(--surface-4)]'
                        >
                          <div className='flex items-start p-[12px]'>
                            <Checkbox
                              checked={selectedDatasets.has(dataset.id)}
                              onCheckedChange={() => toggleDatasetSelection(dataset.id)}
                              className='mt-[2px] mr-[12px]'
                            />
                            <button
                              className='flex flex-1 items-center justify-between text-left'
                              onClick={() =>
                                setExpandedDataset(
                                  expandedDataset === dataset.id ? null : dataset.id
                                )
                              }
                            >
                              <div className='flex-1'>
                                <p className='font-medium text-[14px] text-[var(--text-primary)]'>
                                  {dataset.title}
                                </p>
                                <p className='text-[12px] text-[var(--text-muted)]'>
                                  {dataset.prompt.substring(0, 50)}
                                  {dataset.prompt.length > 50 ? '...' : ''}
                                </p>
                              </div>
                              <div className='flex items-center gap-[12px]'>
                                {dataset.sentAt && (
                                  <span className='inline-flex items-center rounded-full bg-green-50 px-[8px] py-[2px] text-[11px] text-green-700 ring-1 ring-green-600/20 ring-inset dark:bg-green-900/20 dark:text-green-300'>
                                    <CheckCircle2 className='mr-[4px] h-[10px] w-[10px]' /> Sent
                                  </span>
                                )}
                                <span className='text-[12px] text-[var(--text-muted)]'>
                                  {dataset.editSequence.length} ops
                                </span>
                                <ChevronDown
                                  className={cn(
                                    'h-[14px] w-[14px] text-[var(--text-muted)] transition-transform',
                                    expandedDataset === dataset.id && 'rotate-180'
                                  )}
                                />
                              </div>
                            </button>
                          </div>

                          {expandedDataset === dataset.id && (
                            <div className='flex flex-col gap-[12px] border-t px-[12px] pt-[12px] pb-[16px]'>
                              <div>
                                <p className='mb-[4px] font-medium text-[13px] text-[var(--text-primary)]'>
                                  Prompt
                                </p>
                                <p className='text-[13px] text-[var(--text-secondary)]'>
                                  {dataset.prompt}
                                </p>
                              </div>

                              <div>
                                <p className='mb-[4px] font-medium text-[13px] text-[var(--text-primary)]'>
                                  Statistics
                                </p>
                                <div className='grid grid-cols-2 gap-[8px] text-[13px]'>
                                  <div>
                                    <span className='text-[var(--text-muted)]'>Duration:</span>{' '}
                                    <span className='text-[var(--text-secondary)]'>
                                      {dataset.metadata?.duration
                                        ? formatDuration(dataset.metadata.duration, {
                                            precision: 1,
                                          })
                                        : 'N/A'}
                                    </span>
                                  </div>
                                  <div>
                                    <span className='text-[var(--text-muted)]'>Operations:</span>{' '}
                                    <span className='text-[var(--text-secondary)]'>
                                      {dataset.editSequence.length}
                                    </span>
                                  </div>
                                  <div>
                                    <span className='text-[var(--text-muted)]'>Final blocks:</span>{' '}
                                    <span className='text-[var(--text-secondary)]'>
                                      {dataset.metadata?.blockCount || 0}
                                    </span>
                                  </div>
                                  <div>
                                    <span className='text-[var(--text-muted)]'>Final edges:</span>{' '}
                                    <span className='text-[var(--text-secondary)]'>
                                      {dataset.metadata?.edgeCount || 0}
                                    </span>
                                  </div>
                                </div>
                              </div>

                              <div>
                                <p className='mb-[4px] font-medium text-[13px] text-[var(--text-primary)]'>
                                  Edit Sequence
                                </p>
                                <div className='max-h-[100px] overflow-y-auto rounded-[6px] border bg-[var(--surface-5)] p-[8px]'>
                                  <ul className='flex flex-col gap-[4px] font-mono text-[11px]'>
                                    {formatEditSequence(dataset.editSequence).map((desc, i) => (
                                      <li key={i} className='text-[var(--text-secondary)]'>
                                        {desc}
                                      </li>
                                    ))}
                                  </ul>
                                </div>
                              </div>

                              <div className='flex gap-[8px]'>
                                <Button
                                  variant={
                                    sentDatasets.has(dataset.id)
                                      ? 'default'
                                      : failedDatasets.has(dataset.id)
                                        ? 'default'
                                        : 'default'
                                  }
                                  onClick={() => handleSendOne(dataset)}
                                  disabled={sendingDatasets.has(dataset.id)}
                                  className={
                                    sentDatasets.has(dataset.id)
                                      ? '!border-green-500 !text-green-600 dark:!border-green-400 dark:!text-green-400'
                                      : failedDatasets.has(dataset.id)
                                        ? '!border-red-500 !text-red-600 dark:!border-red-400 dark:!text-red-400'
                                        : ''
                                  }
                                >
                                  {sendingDatasets.has(dataset.id) ? (
                                    'Sending...'
                                  ) : sentDatasets.has(dataset.id) ? (
                                    <>
                                      <CheckCircle2 className='mr-[6px] h-[12px] w-[12px]' />
                                      Sent
                                    </>
                                  ) : failedDatasets.has(dataset.id) ? (
                                    <>
                                      <XCircle className='mr-[6px] h-[12px] w-[12px]' />
                                      Failed
                                    </>
                                  ) : (
                                    <>
                                      <Send className='mr-[6px] h-[12px] w-[12px]' />
                                      Send
                                    </>
                                  )}
                                </Button>
                                <Button
                                  variant='default'
                                  onClick={() => setViewingDataset(dataset.id)}
                                >
                                  <Eye className='mr-[6px] h-[12px] w-[12px]' />
                                  View
                                </Button>
                                <Button
                                  variant='default'
                                  onClick={() => handleCopyDataset(dataset)}
                                >
                                  {copiedId === dataset.id ? (
                                    <>
                                      <Check className='mr-[6px] h-[12px] w-[12px]' />
                                      Copied!
                                    </>
                                  ) : (
                                    <>
                                      <Clipboard className='mr-[6px] h-[12px] w-[12px]' />
                                      Copy
                                    </>
                                  )}
                                </Button>
                              </div>

                              {viewingDataset === dataset.id && (
                                <div className='rounded-[6px] border bg-[var(--surface-5)] p-[12px]'>
                                  <pre className='max-h-[200px] overflow-auto text-[11px] text-[var(--text-secondary)]'>
                                    {JSON.stringify(
                                      {
                                        prompt: dataset.prompt,
                                        editSequence: dataset.editSequence,
                                        metadata: dataset.metadata,
                                      },
                                      null,
                                      2
                                    )}
                                  </pre>
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                </>
              )}
            </ModalTabsContent>

            {/* Send Live State Tab */}
            <ModalTabsContent value='live' className='flex flex-col gap-[16px]'>
              <div className='flex items-center gap-[16px] text-[13px]'>
                <span className='text-[var(--text-muted)]'>Current workflow:</span>
                <span className='text-[var(--text-primary)]'>
                  {currentWorkflow.getBlockCount()} blocks
                </span>
                <span className='text-[var(--text-tertiary)]'>·</span>
                <span className='text-[var(--text-primary)]'>
                  {currentWorkflow.getEdgeCount()} edges
                </span>
              </div>

              <div className='flex flex-col gap-[8px]'>
                <Label htmlFor='live-title'>Title</Label>
                <Input
                  id='live-title'
                  placeholder='e.g., Customer Onboarding Workflow'
                  value={liveWorkflowTitle}
                  onChange={(e) => setLiveWorkflowTitle(e.target.value)}
                  className='h-9'
                />
                <p className='text-[12px] text-[var(--text-muted)]'>
                  A short title identifying this workflow
                </p>
              </div>

              <div className='flex flex-col gap-[8px]'>
                <Label htmlFor='live-description'>Description</Label>
                <Textarea
                  id='live-description'
                  placeholder='Describe what this workflow does...'
                  value={liveWorkflowDescription}
                  onChange={(e) => setLiveWorkflowDescription(e.target.value)}
                  rows={3}
                />
                <p className='text-[12px] text-[var(--text-muted)]'>
                  Explain the purpose and functionality of this workflow
                </p>
              </div>

              <Button
                onClick={handleSendLiveWorkflow}
                disabled={
                  !liveWorkflowTitle.trim() ||
                  !liveWorkflowDescription.trim() ||
                  sendingLiveWorkflow ||
                  currentWorkflow.getBlockCount() === 0
                }
                variant='tertiary'
                className={cn(
                  'w-full',
                  liveWorkflowSent && '!bg-green-600 !text-white hover:!bg-green-700',
                  liveWorkflowFailed && '!bg-red-600 !text-white hover:!bg-red-700'
                )}
              >
                {sendingLiveWorkflow ? (
                  'Sending...'
                ) : liveWorkflowSent ? (
                  <>
                    <CheckCircle2 className='mr-[6px] h-[14px] w-[14px]' />
                    Sent Successfully
                  </>
                ) : liveWorkflowFailed ? (
                  <>
                    <XCircle className='mr-[6px] h-[14px] w-[14px]' />
                    Failed - Try Again
                  </>
                ) : (
                  <>
                    <Send className='mr-[6px] h-[14px] w-[14px]' />
                    Send Live Workflow State
                  </>
                )}
              </Button>

              {liveWorkflowSent && (
                <div className='rounded-[8px] border bg-green-50 p-[12px] dark:bg-green-950/30'>
                  <p className='text-[13px] text-green-700 dark:text-green-300'>
                    Workflow state sent successfully!
                  </p>
                </div>
              )}

              {liveWorkflowFailed && (
                <div className='rounded-[8px] border bg-red-50 p-[12px] dark:bg-red-950/30'>
                  <p className='text-[13px] text-red-700 dark:text-red-300'>
                    Failed to send workflow state. Please try again.
                  </p>
                </div>
              )}
            </ModalTabsContent>
          </ModalBody>
        </ModalTabs>
      </ModalContent>
    </Modal>
  )
}
