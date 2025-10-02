'use client'

import { useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { cn } from '@/lib/utils'
import { sanitizeForCopilot } from '@/lib/workflows/json-sanitizer'
import { formatEditSequence } from '@/lib/workflows/training/compute-edit-sequence'
import { useCurrentWorkflow } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-current-workflow'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'

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
      console.error('Failed to send dataset to indexer:', error)
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
          source_path: liveWorkflowTitle,
          summary: liveWorkflowDescription,
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
      console.error('Failed to send live workflow:', error)
      setLiveWorkflowFailed(true)
      setTimeout(() => setLiveWorkflowFailed(false), 5000)
    } finally {
      setSendingLiveWorkflow(false)
    }
  }

  return (
    <Dialog open={showModal} onOpenChange={toggleModal}>
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Copilot Training Dataset Builder</DialogTitle>
          <DialogDescription>
            Record workflow editing sessions to create training datasets for the copilot
          </DialogDescription>
        </DialogHeader>

        {isTraining && (
          <>
            <div className='mt-4 rounded-lg border bg-orange-50 p-4 dark:bg-orange-950/30'>
              <p className='mb-2 font-medium text-orange-700 dark:text-orange-300'>
                Recording: {currentTitle}
              </p>
              <p className='mb-3 text-sm'>{currentPrompt}</p>
              <div className='flex gap-2'>
                <Button variant='outline' size='sm' onClick={cancelTraining} className='flex-1'>
                  <X className='mr-2 h-4 w-4' />
                  Cancel
                </Button>
                <Button
                  variant='default'
                  size='sm'
                  onClick={() => {
                    useCopilotTrainingStore.getState().stopTraining()
                    setLocalPrompt('')
                  }}
                  className='flex-1'
                >
                  <Check className='mr-2 h-4 w-4' />
                  Save Dataset
                </Button>
              </div>
            </div>

            {startSnapshot && (
              <div className='mt-3 rounded-lg border p-3'>
                <p className='mb-2 font-medium text-sm'>Starting State</p>
                <p className='text-muted-foreground text-xs'>
                  {Object.keys(startSnapshot.blocks).length} blocks, {startSnapshot.edges.length}{' '}
                  edges
                </p>
              </div>
            )}
          </>
        )}

        <Tabs defaultValue={isTraining ? 'datasets' : 'new'} className='mt-4'>
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger value='new' disabled={isTraining}>
              New Session
            </TabsTrigger>
            <TabsTrigger value='datasets'>Datasets ({datasets.length})</TabsTrigger>
            <TabsTrigger value='live'>Send Live State</TabsTrigger>
          </TabsList>

          {/* New Training Session Tab */}
          <TabsContent value='new' className='space-y-4'>
            <div className='rounded-lg border bg-muted/50 p-3'>
              <p className='mb-2 font-medium text-muted-foreground text-sm'>
                Current Workflow State
              </p>
              <p className='text-sm'>
                {currentWorkflow.getBlockCount()} blocks, {currentWorkflow.getEdgeCount()} edges
              </p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='title'>Title</Label>
              <Input
                id='title'
                placeholder='Enter a title for this training dataset...'
                value={localTitle}
                onChange={(e) => setLocalTitle(e.target.value)}
              />
            </div>

            <div className='space-y-2'>
              <Label htmlFor='prompt'>Training Prompt</Label>
              <Textarea
                id='prompt'
                placeholder='Enter the user intent/prompt for this workflow transformation...'
                value={localPrompt}
                onChange={(e) => setLocalPrompt(e.target.value)}
                rows={3}
              />
              <p className='text-muted-foreground text-xs'>
                Describe what the next sequence of edits aim to achieve
              </p>
            </div>

            <Button
              onClick={handleStart}
              disabled={!localTitle.trim() || !localPrompt.trim()}
              className='w-full'
            >
              Start Training Session
            </Button>
          </TabsContent>

          {/* Datasets Tab */}
          <TabsContent value='datasets' className='space-y-4'>
            {datasets.length === 0 ? (
              <div className='py-8 text-center text-muted-foreground'>
                No training datasets yet. Start a new session to create one.
              </div>
            ) : (
              <>
                <div className='flex items-center justify-between'>
                  <div className='flex items-center gap-3'>
                    <Checkbox
                      checked={datasets.length > 0 && selectedDatasets.size === datasets.length}
                      onCheckedChange={toggleSelectAll}
                      disabled={datasets.length === 0}
                    />
                    <p className='text-muted-foreground text-sm'>
                      {selectedDatasets.size > 0
                        ? `${selectedDatasets.size} of ${datasets.length} selected`
                        : `${datasets.length} dataset${datasets.length !== 1 ? 's' : ''} recorded`}
                    </p>
                  </div>
                  <div className='flex gap-2'>
                    {selectedDatasets.size > 0 && (
                      <Button
                        variant='default'
                        size='sm'
                        onClick={handleSendSelected}
                        disabled={sendingSelected}
                      >
                        <Send className='mr-2 h-4 w-4' />
                        {sendingSelected ? 'Sending...' : `Send ${selectedDatasets.size} Selected`}
                      </Button>
                    )}
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleSendAll}
                      disabled={datasets.length === 0 || sendingAll}
                    >
                      <Send className='mr-2 h-4 w-4' />
                      {sendingAll ? 'Sending...' : 'Send All'}
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleExportAll}
                      disabled={datasets.length === 0}
                    >
                      <Download className='mr-2 h-4 w-4' />
                      Export
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={clearDatasets}
                      disabled={datasets.length === 0}
                    >
                      <Trash2 className='mr-2 h-4 w-4' />
                      Clear
                    </Button>
                  </div>
                </div>

                <ScrollArea className='h-[400px]'>
                  <div className='space-y-3'>
                    {datasets.map((dataset, index) => (
                      <div
                        key={dataset.id}
                        className='rounded-lg border bg-card transition-colors hover:bg-muted/50'
                      >
                        <div className='flex items-start p-4'>
                          <Checkbox
                            checked={selectedDatasets.has(dataset.id)}
                            onCheckedChange={() => toggleDatasetSelection(dataset.id)}
                            className='mt-0.5 mr-3'
                          />
                          <button
                            className='flex flex-1 items-center justify-between text-left'
                            onClick={() =>
                              setExpandedDataset(expandedDataset === dataset.id ? null : dataset.id)
                            }
                          >
                            <div className='flex-1'>
                              <p className='font-medium text-sm'>{dataset.title}</p>
                              <p className='text-muted-foreground text-xs'>
                                {dataset.prompt.substring(0, 50)}
                                {dataset.prompt.length > 50 ? '...' : ''}
                              </p>
                            </div>
                            <div className='flex items-center gap-3'>
                              {dataset.sentAt && (
                                <span className='inline-flex items-center rounded-full bg-green-50 px-2 py-0.5 text-green-700 text-xs ring-1 ring-green-600/20 ring-inset dark:bg-green-900/20 dark:text-green-300'>
                                  <CheckCircle2 className='mr-1 h-3 w-3' /> Sent
                                </span>
                              )}
                              <span className='text-muted-foreground text-xs'>
                                {dataset.editSequence.length} ops
                              </span>
                              <ChevronDown
                                className={cn(
                                  'h-4 w-4 text-muted-foreground transition-transform',
                                  expandedDataset === dataset.id && 'rotate-180'
                                )}
                              />
                            </div>
                          </button>
                        </div>

                        {expandedDataset === dataset.id && (
                          <div className='space-y-3 border-t px-4 pt-3 pb-4'>
                            <div>
                              <p className='mb-1 font-medium text-sm'>Prompt</p>
                              <p className='text-muted-foreground text-sm'>{dataset.prompt}</p>
                            </div>

                            <div>
                              <p className='mb-1 font-medium text-sm'>Statistics</p>
                              <div className='grid grid-cols-2 gap-2 text-sm'>
                                <div>
                                  <span className='text-muted-foreground'>Duration:</span>{' '}
                                  {dataset.metadata?.duration
                                    ? `${(dataset.metadata.duration / 1000).toFixed(1)}s`
                                    : 'N/A'}
                                </div>
                                <div>
                                  <span className='text-muted-foreground'>Operations:</span>{' '}
                                  {dataset.editSequence.length}
                                </div>
                                <div>
                                  <span className='text-muted-foreground'>Final blocks:</span>{' '}
                                  {dataset.metadata?.blockCount || 0}
                                </div>
                                <div>
                                  <span className='text-muted-foreground'>Final edges:</span>{' '}
                                  {dataset.metadata?.edgeCount || 0}
                                </div>
                              </div>
                            </div>

                            <div>
                              <p className='mb-1 font-medium text-sm'>Edit Sequence</p>
                              <div className='max-h-32 overflow-y-auto rounded border bg-muted/50 p-2'>
                                <ul className='space-y-1 font-mono text-xs'>
                                  {formatEditSequence(dataset.editSequence).map((desc, i) => (
                                    <li key={i}>{desc}</li>
                                  ))}
                                </ul>
                              </div>
                            </div>

                            <div className='flex gap-2'>
                              <Button
                                variant={
                                  sentDatasets.has(dataset.id)
                                    ? 'outline'
                                    : failedDatasets.has(dataset.id)
                                      ? 'destructive'
                                      : 'outline'
                                }
                                size='sm'
                                onClick={() => handleSendOne(dataset)}
                                disabled={sendingDatasets.has(dataset.id)}
                                className={
                                  sentDatasets.has(dataset.id)
                                    ? 'border-green-500 text-green-600 hover:bg-green-50 dark:border-green-400 dark:text-green-400 dark:hover:bg-green-950'
                                    : ''
                                }
                              >
                                {sendingDatasets.has(dataset.id) ? (
                                  <>
                                    <div className='mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
                                    Sending...
                                  </>
                                ) : sentDatasets.has(dataset.id) ? (
                                  <>
                                    <CheckCircle2 className='mr-2 h-4 w-4' />
                                    Sent
                                  </>
                                ) : failedDatasets.has(dataset.id) ? (
                                  <>
                                    <XCircle className='mr-2 h-4 w-4' />
                                    Failed
                                  </>
                                ) : (
                                  <>
                                    <Send className='mr-2 h-4 w-4' />
                                    Send
                                  </>
                                )}
                              </Button>
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() => setViewingDataset(dataset.id)}
                              >
                                <Eye className='mr-2 h-4 w-4' />
                                View
                              </Button>
                              <Button
                                variant='outline'
                                size='sm'
                                onClick={() => handleCopyDataset(dataset)}
                              >
                                {copiedId === dataset.id ? (
                                  <>
                                    <Check className='mr-2 h-4 w-4' />
                                    Copied!
                                  </>
                                ) : (
                                  <>
                                    <Clipboard className='mr-2 h-4 w-4' />
                                    Copy
                                  </>
                                )}
                              </Button>
                            </div>

                            {viewingDataset === dataset.id && (
                              <div className='rounded border bg-muted/50 p-3'>
                                <pre className='max-h-64 overflow-auto text-xs'>
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
                </ScrollArea>
              </>
            )}
          </TabsContent>

          {/* Send Live State Tab */}
          <TabsContent value='live' className='space-y-4'>
            <div className='rounded-lg border bg-muted/50 p-3'>
              <p className='mb-2 font-medium text-muted-foreground text-sm'>
                Current Workflow State
              </p>
              <p className='text-sm'>
                {currentWorkflow.getBlockCount()} blocks, {currentWorkflow.getEdgeCount()} edges
              </p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='live-title'>Title</Label>
              <Input
                id='live-title'
                placeholder='e.g., Customer Onboarding Workflow'
                value={liveWorkflowTitle}
                onChange={(e) => setLiveWorkflowTitle(e.target.value)}
              />
              <p className='text-muted-foreground text-xs'>
                A short title identifying this workflow
              </p>
            </div>

            <div className='space-y-2'>
              <Label htmlFor='live-description'>Description</Label>
              <Textarea
                id='live-description'
                placeholder='Describe what this workflow does...'
                value={liveWorkflowDescription}
                onChange={(e) => setLiveWorkflowDescription(e.target.value)}
                rows={3}
              />
              <p className='text-muted-foreground text-xs'>
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
              className='w-full'
            >
              {sendingLiveWorkflow ? (
                <>
                  <div className='mr-2 h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
                  Sending...
                </>
              ) : liveWorkflowSent ? (
                <>
                  <CheckCircle2 className='mr-2 h-4 w-4' />
                  Sent Successfully
                </>
              ) : liveWorkflowFailed ? (
                <>
                  <XCircle className='mr-2 h-4 w-4' />
                  Failed - Try Again
                </>
              ) : (
                <>
                  <Send className='mr-2 h-4 w-4' />
                  Send Live Workflow State
                </>
              )}
            </Button>

            {liveWorkflowSent && (
              <div className='rounded-lg border bg-green-50 p-3 dark:bg-green-950/30'>
                <p className='text-green-700 text-sm dark:text-green-300'>
                  Workflow state sent successfully!
                </p>
              </div>
            )}

            {liveWorkflowFailed && (
              <div className='rounded-lg border bg-red-50 p-3 dark:bg-red-950/30'>
                <p className='text-red-700 text-sm dark:text-red-300'>
                  Failed to send workflow state. Please try again.
                </p>
              </div>
            )}
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}
