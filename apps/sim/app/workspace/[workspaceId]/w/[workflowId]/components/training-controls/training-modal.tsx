'use client'

import { useState } from 'react'
import { Check, Clipboard, Download, Eye, Trash2, X } from 'lucide-react'
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from '@/components/ui/accordion'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { Textarea } from '@/components/ui/textarea'
import { formatEditSequence } from '@/lib/workflows/training/compute-edit-sequence'
import { useCopilotTrainingStore } from '@/stores/copilot-training/store'

/**
 * Modal for starting training sessions and viewing/exporting datasets
 */
export function TrainingModal() {
  const {
    isTraining,
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
  } = useCopilotTrainingStore()

  const [localPrompt, setLocalPrompt] = useState(currentPrompt)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [viewingDataset, setViewingDataset] = useState<string | null>(null)

  const handleStart = () => {
    if (localPrompt.trim()) {
      startTraining(localPrompt)
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

  return (
    <Dialog open={showModal} onOpenChange={toggleModal}>
      <DialogContent className='max-w-3xl'>
        <DialogHeader>
          <DialogTitle>Copilot Training Dataset Builder</DialogTitle>
          <DialogDescription>
            Record workflow editing sessions to create training datasets for the copilot
          </DialogDescription>
        </DialogHeader>

        <Tabs defaultValue={isTraining ? 'current' : 'new'} className='mt-4'>
          <TabsList className='grid w-full grid-cols-3'>
            <TabsTrigger value='new' disabled={isTraining}>
              New Session
            </TabsTrigger>
            <TabsTrigger value='current' disabled={!isTraining}>
              Current
            </TabsTrigger>
            <TabsTrigger value='datasets'>Datasets ({datasets.length})</TabsTrigger>
          </TabsList>

          {/* New Training Session Tab */}
          <TabsContent value='new' className='space-y-4'>
            {startSnapshot && (
              <div className='rounded-lg border bg-muted/50 p-3'>
                <p className='font-medium text-muted-foreground text-sm'>Current Workflow State</p>
                <p className='text-sm'>
                  {Object.keys(startSnapshot.blocks).length} blocks, {startSnapshot.edges.length}{' '}
                  edges
                </p>
              </div>
            )}

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
                Describe what the user wants to achieve with the workflow
              </p>
            </div>

            <Button onClick={handleStart} disabled={!localPrompt.trim()} className='w-full'>
              Start Training Session
            </Button>
          </TabsContent>

          {/* Current Training Session Tab */}
          <TabsContent value='current' className='space-y-4'>
            {isTraining && (
              <>
                <div className='rounded-lg border bg-orange-50 p-4 dark:bg-orange-950/30'>
                  <p className='mb-2 font-medium text-orange-700 dark:text-orange-300'>
                    Recording in Progress
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
                  <div className='rounded-lg border p-3'>
                    <p className='mb-2 font-medium text-sm'>Starting State</p>
                    <p className='text-muted-foreground text-xs'>
                      {Object.keys(startSnapshot.blocks).length} blocks,{' '}
                      {startSnapshot.edges.length} edges
                    </p>
                  </div>
                )}
              </>
            )}
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
                  <p className='text-muted-foreground text-sm'>
                    {datasets.length} dataset{datasets.length !== 1 ? 's' : ''} recorded
                  </p>
                  <div className='flex gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={handleExportAll}
                      disabled={datasets.length === 0}
                    >
                      <Download className='mr-2 h-4 w-4' />
                      Export All
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={clearDatasets}
                      disabled={datasets.length === 0}
                    >
                      <Trash2 className='mr-2 h-4 w-4' />
                      Clear All
                    </Button>
                  </div>
                </div>

                <ScrollArea className='h-[400px]'>
                  <Accordion type='single' collapsible className='w-full'>
                    {datasets.map((dataset, index) => (
                      <AccordionItem key={dataset.id} value={dataset.id}>
                        <AccordionTrigger className='hover:no-underline'>
                          <div className='flex w-full items-center justify-between pr-4'>
                            <div className='text-left'>
                              <p className='font-medium text-sm'>Dataset {index + 1}</p>
                              <p className='text-muted-foreground text-xs'>
                                {dataset.prompt.substring(0, 50)}
                                {dataset.prompt.length > 50 ? '...' : ''}
                              </p>
                            </div>
                            <div className='flex items-center gap-2'>
                              <span className='text-muted-foreground text-xs'>
                                {dataset.editSequence.length} ops
                              </span>
                            </div>
                          </div>
                        </AccordionTrigger>
                        <AccordionContent className='space-y-3'>
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
                              variant='outline'
                              size='sm'
                              onClick={() => setViewingDataset(dataset.id)}
                            >
                              <Eye className='mr-2 h-4 w-4' />
                              View JSON
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
                        </AccordionContent>
                      </AccordionItem>
                    ))}
                  </Accordion>
                </ScrollArea>
              </>
            )}
          </TabsContent>
        </Tabs>

        <DialogFooter>
          <Button variant='outline' onClick={toggleModal}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
