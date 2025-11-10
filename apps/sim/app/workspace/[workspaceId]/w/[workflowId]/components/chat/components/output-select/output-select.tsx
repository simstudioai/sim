'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check } from 'lucide-react'
import {
  Badge,
  Popover,
  PopoverContent,
  PopoverItem,
  PopoverScrollArea,
  PopoverSection,
  PopoverTrigger,
} from '@/components/emcn'
import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import { getBlock } from '@/blocks'
import { useWorkflowDiffStore } from '@/stores/workflow-diff/store'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

interface OutputSelectProps {
  workflowId: string | null
  selectedOutputs: string[]
  onOutputSelect: (outputIds: string[]) => void
  disabled?: boolean
  placeholder?: string
  valueMode?: 'id' | 'label'
}

export function OutputSelect({
  workflowId,
  selectedOutputs = [],
  onOutputSelect,
  disabled = false,
  placeholder = 'Select outputs',
  valueMode = 'id',
}: OutputSelectProps) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLDivElement>(null)
  const popoverRef = useRef<HTMLDivElement>(null)
  const blocks = useWorkflowStore((state) => state.blocks)
  const { isShowingDiff, isDiffReady, diffWorkflow } = useWorkflowDiffStore()
  const subBlockValues = useSubBlockStore((state) =>
    workflowId ? state.workflowValues[workflowId] : null
  )

  /**
   * Uses diff blocks when in diff mode, otherwise main blocks
   */
  const workflowBlocks = isShowingDiff && isDiffReady && diffWorkflow ? diffWorkflow.blocks : blocks

  /**
   * Extracts all available workflow outputs for the dropdown
   */
  const workflowOutputs = useMemo(() => {
    const outputs: Array<{
      id: string
      label: string
      blockId: string
      blockName: string
      blockType: string
      path: string
    }> = []

    if (!workflowId || !workflowBlocks || typeof workflowBlocks !== 'object') {
      return outputs
    }

    const blockArray = Object.values(workflowBlocks)
    if (blockArray.length === 0) return outputs

    blockArray.forEach((block) => {
      if (block.type === 'starter' || !block?.id || !block?.type) return

      const blockName =
        block.name && typeof block.name === 'string'
          ? block.name.replace(/\s+/g, '').toLowerCase()
          : `block-${block.id}`

      const blockConfig = getBlock(block.type)
      const responseFormatValue =
        isShowingDiff && isDiffReady && diffWorkflow
          ? diffWorkflow.blocks[block.id]?.subBlocks?.responseFormat?.value
          : subBlockValues?.[block.id]?.responseFormat
      const responseFormat = parseResponseFormatSafely(responseFormatValue, block.id)

      let outputsToProcess: Record<string, any> = {}

      if (responseFormat) {
        const schemaFields = extractFieldsFromSchema(responseFormat)
        if (schemaFields.length > 0) {
          schemaFields.forEach((field) => {
            outputsToProcess[field.name] = { type: field.type }
          })
        } else {
          outputsToProcess = blockConfig?.outputs || {}
        }
      } else {
        outputsToProcess = blockConfig?.outputs || {}
      }

      if (Object.keys(outputsToProcess).length === 0) return

      const addOutput = (path: string, outputObj: any, prefix = '') => {
        const fullPath = prefix ? `${prefix}.${path}` : path
        const createOutput = () => ({
          id: `${block.id}_${fullPath}`,
          label: `${blockName}.${fullPath}`,
          blockId: block.id,
          blockName: block.name || `Block ${block.id}`,
          blockType: block.type,
          path: fullPath,
        })

        if (
          typeof outputObj !== 'object' ||
          outputObj === null ||
          ('type' in outputObj && typeof outputObj.type === 'string') ||
          Array.isArray(outputObj)
        ) {
          outputs.push(createOutput())
          return
        }

        Object.entries(outputObj).forEach(([key, value]) => {
          addOutput(key, value, fullPath)
        })
      }

      Object.entries(outputsToProcess).forEach(([key, value]) => {
        addOutput(key, value)
      })
    })

    return outputs
  }, [workflowBlocks, workflowId, isShowingDiff, isDiffReady, diffWorkflow, blocks, subBlockValues])

  /**
   * Checks if output is selected by id or label
   */
  const isSelectedValue = (o: { id: string; label: string }) =>
    selectedOutputs.includes(o.id) || selectedOutputs.includes(o.label)

  /**
   * Gets display text for selected outputs
   */
  const selectedOutputsDisplayText = useMemo(() => {
    if (!selectedOutputs || selectedOutputs.length === 0) {
      return placeholder
    }

    const validOutputs = selectedOutputs.filter((val) =>
      workflowOutputs.some((o) => o.id === val || o.label === val)
    )

    if (validOutputs.length === 0) {
      return placeholder
    }

    if (validOutputs.length === 1) {
      const output = workflowOutputs.find(
        (o) => o.id === validOutputs[0] || o.label === validOutputs[0]
      )
      return output?.label || placeholder
    }

    return `${validOutputs.length} outputs`
  }, [selectedOutputs, workflowOutputs, placeholder])

  /**
   * Groups outputs by block and sorts by distance from starter block
   */
  const groupedOutputs = useMemo(() => {
    const groups: Record<string, typeof workflowOutputs> = {}
    const blockDistances: Record<string, number> = {}
    const edges = useWorkflowStore.getState().edges

    const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')
    const starterBlockId = starterBlock?.id

    if (starterBlockId) {
      const adjList: Record<string, string[]> = {}
      edges.forEach((edge) => {
        if (!adjList[edge.source]) adjList[edge.source] = []
        adjList[edge.source].push(edge.target)
      })

      const visited = new Set<string>()
      const queue: Array<[string, number]> = [[starterBlockId, 0]]

      while (queue.length > 0) {
        const [currentNodeId, distance] = queue.shift()!
        if (visited.has(currentNodeId)) continue

        visited.add(currentNodeId)
        blockDistances[currentNodeId] = distance

        const outgoingNodeIds = adjList[currentNodeId] || []
        outgoingNodeIds.forEach((targetId) => {
          queue.push([targetId, distance + 1])
        })
      }
    }

    workflowOutputs.forEach((output) => {
      if (!groups[output.blockName]) groups[output.blockName] = []
      groups[output.blockName].push(output)
    })

    return Object.entries(groups)
      .map(([blockName, outputs]) => ({
        blockName,
        outputs,
        distance: blockDistances[outputs[0]?.blockId] || 0,
      }))
      .sort((a, b) => b.distance - a.distance)
      .reduce(
        (acc, { blockName, outputs }) => {
          acc[blockName] = outputs
          return acc
        },
        {} as Record<string, typeof workflowOutputs>
      )
  }, [workflowOutputs, blocks])

  /**
   * Gets block color for an output
   */
  const getOutputColor = (blockId: string, blockType: string) => {
    const blockConfig = getBlock(blockType)
    return blockConfig?.bgColor || '#2F55FF'
  }

  /**
   * Handles output selection - toggle selection
   */
  const handleOutputSelection = (value: string) => {
    const emittedValue =
      valueMode === 'label' ? value : workflowOutputs.find((o) => o.label === value)?.id || value
    const index = selectedOutputs.indexOf(emittedValue)

    const newSelectedOutputs =
      index === -1
        ? [...new Set([...selectedOutputs, emittedValue])]
        : selectedOutputs.filter((id) => id !== emittedValue)

    onOutputSelect(newSelectedOutputs)
  }

  /**
   * Closes popover when clicking outside
   */
  useEffect(() => {
    if (!open) return

    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node
      const insideTrigger = triggerRef.current?.contains(target)
      const insidePopover = popoverRef.current?.contains(target)

      if (!insideTrigger && !insidePopover) {
        setOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [open])

  return (
    <Popover open={open} variant='default'>
      <PopoverTrigger asChild>
        <div ref={triggerRef} className='min-w-0 max-w-full'>
          <Badge
            variant='outline'
            className='min-w-0 max-w-full cursor-pointer rounded-[6px]'
            title='Select outputs'
            aria-expanded={open}
            onMouseDown={(e) => {
              if (disabled || workflowOutputs.length === 0) return
              e.stopPropagation()
              setOpen((prev) => !prev)
            }}
          >
            <span className='min-w-0 flex-1 truncate'>{selectedOutputsDisplayText}</span>
          </Badge>
        </div>
      </PopoverTrigger>
      <PopoverContent
        ref={popoverRef}
        side='bottom'
        align='start'
        sideOffset={4}
        maxHeight={280}
        onOpenAutoFocus={(e) => e.preventDefault()}
        onCloseAutoFocus={(e) => e.preventDefault()}
      >
        <PopoverScrollArea className='space-y-[2px]'>
          {Object.entries(groupedOutputs).map(([blockName, outputs]) => (
            <div key={blockName}>
              <PopoverSection>{blockName}</PopoverSection>
              {outputs.map((output) => (
                <PopoverItem
                  key={output.id}
                  active={isSelectedValue(output)}
                  onClick={() => handleOutputSelection(output.label)}
                >
                  <div
                    className='flex h-[14px] w-[14px] flex-shrink-0 items-center justify-center rounded'
                    style={{
                      backgroundColor: getOutputColor(output.blockId, output.blockType),
                    }}
                  >
                    <span className='font-bold text-[10px] text-white'>
                      {blockName.charAt(0).toUpperCase()}
                    </span>
                  </div>
                  <span className='min-w-0 flex-1 truncate'>{output.path}</span>
                  {isSelectedValue(output) && <Check className='h-3 w-3 flex-shrink-0' />}
                </PopoverItem>
              ))}
            </div>
          ))}
        </PopoverScrollArea>
      </PopoverContent>
    </Popover>
  )
}
