'use client'

import { useCallback, useEffect, useState } from 'react'
import { X } from 'lucide-react'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { getBlock } from '@/blocks'
import type { SubBlockConfig } from '@/blocks/types'
import { useDesignStore } from '@/stores/design/store'
import { usePanelStore } from '@/stores/panel/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { mergeSubblockState } from '@/stores/workflows/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { SubBlock } from '../workflow-block/components/sub-block/sub-block'

export function Design() {
  const [isResizing, setIsResizing] = useState(false)
  const [resizeStartX, setResizeStartX] = useState(0)
  const [resizeStartWidth, setResizeStartWidth] = useState(0)

  // Store selectors
  const isOpen = useDesignStore((state) => state.isOpen)
  const selectedBlockId = useDesignStore((state) => state.selectedBlockId)
  const designWidth = useDesignStore((state) => state.designWidth)
  const setDesignWidth = useDesignStore((state) => state.setDesignWidth)
  const closeDesign = useDesignStore((state) => state.closeDesign)

  // Panel state to calculate position
  const panelIsOpen = usePanelStore((state) => state.isOpen)
  const panelWidth = usePanelStore((state) => state.panelWidth)

  // Get the selected block data
  const selectedBlock = useWorkflowStore((state) =>
    selectedBlockId ? state.blocks[selectedBlockId] : null
  )
  const activeWorkflowId = useWorkflowRegistry((state) => state.activeWorkflowId)

  const userPermissions = useUserPermissionsContext()

  // Get block configuration
  const blockConfig = selectedBlock ? getBlock(selectedBlock.type) : null

  // Calculate right position based on panel state
  const rightPosition = panelIsOpen ? panelWidth + 16 + 16 : 16 // panel width + panel margin + design margin

  // Resize functionality
  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      if (!isOpen) return
      e.preventDefault()
      setIsResizing(true)
      setResizeStartX(e.clientX)
      setResizeStartWidth(designWidth)
    },
    [isOpen, designWidth]
  )

  const handleResize = useCallback(
    (e: MouseEvent) => {
      if (!isResizing) return
      const deltaX = resizeStartX - e.clientX // Subtract because we're expanding left
      const newWidth = resizeStartWidth + deltaX
      setDesignWidth(newWidth)
    },
    [isResizing, resizeStartX, resizeStartWidth, setDesignWidth]
  )

  const handleResizeEnd = useCallback(() => {
    setIsResizing(false)
  }, [])

  // Add global mouse event listeners for resize
  useEffect(() => {
    if (isResizing) {
      document.addEventListener('mousemove', handleResize)
      document.addEventListener('mouseup', handleResizeEnd)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'

      return () => {
        document.removeEventListener('mousemove', handleResize)
        document.removeEventListener('mouseup', handleResizeEnd)
        document.body.style.cursor = ''
        document.body.style.userSelect = ''
      }
    }
  }, [isResizing, handleResize, handleResizeEnd])

  // SubBlock layout management (copied from WorkflowBlock)
  function groupSubBlocks(subBlocks: SubBlockConfig[], blockId: string) {
    const rows: SubBlockConfig[][] = []
    let currentRow: SubBlockConfig[] = []
    let currentRowWidth = 0

    // Get the merged state
    const blocks = useWorkflowStore.getState().blocks
    const mergedState = mergeSubblockState(blocks, activeWorkflowId || undefined, blockId)[blockId]
    const stateToUse = mergedState?.subBlocks || {}

    const isAdvancedMode = blocks[blockId]?.advancedMode ?? false
    const isTriggerMode = blocks[blockId]?.triggerMode ?? false

    // Filter visible blocks and those that meet their conditions
    const visibleSubBlocks = subBlocks.filter((block) => {
      if (block.hidden) return false

      // Special handling for trigger mode
      if (block.type === ('trigger-config' as any)) {
        const isPureTriggerBlock =
          blockConfig?.triggers?.enabled && blockConfig.category === 'triggers'
        return isTriggerMode || isPureTriggerBlock
      }

      if (isTriggerMode && block.type !== ('trigger-config' as any)) {
        return false
      }

      // Filter by mode if specified
      if (block.mode) {
        if (block.mode === 'basic' && isAdvancedMode) return false
        if (block.mode === 'advanced' && !isAdvancedMode) return false
      }

      // If there's no condition, the block should be shown
      if (!block.condition) return true

      // If condition is a function, call it to get the actual condition object
      const actualCondition =
        typeof block.condition === 'function' ? block.condition() : block.condition

      // Get the values of the fields this block depends on from the appropriate state
      const fieldValue = stateToUse[actualCondition.field]?.value
      const andFieldValue = actualCondition.and
        ? stateToUse[actualCondition.and.field]?.value
        : undefined

      // Check if the condition value is an array
      const isValueMatch = Array.isArray(actualCondition.value)
        ? fieldValue != null &&
          (actualCondition.not
            ? !actualCondition.value.includes(fieldValue as string | number | boolean)
            : actualCondition.value.includes(fieldValue as string | number | boolean))
        : actualCondition.not
          ? fieldValue !== actualCondition.value
          : fieldValue === actualCondition.value

      // Check both conditions if 'and' is present
      const isAndValueMatch =
        !actualCondition.and ||
        (Array.isArray(actualCondition.and.value)
          ? andFieldValue != null &&
            (actualCondition.and.not
              ? !actualCondition.and.value.includes(andFieldValue as string | number | boolean)
              : actualCondition.and.value.includes(andFieldValue as string | number | boolean))
          : actualCondition.and.not
            ? andFieldValue !== actualCondition.and.value
            : andFieldValue === actualCondition.and.value)

      return isValueMatch && isAndValueMatch
    })

    visibleSubBlocks.forEach((block) => {
      const blockWidth = block.layout === 'half' ? 0.5 : 1
      if (currentRowWidth + blockWidth > 1) {
        if (currentRow.length > 0) {
          rows.push([...currentRow])
        }
        currentRow = [block]
        currentRowWidth = blockWidth
      } else {
        currentRow.push(block)
        currentRowWidth += blockWidth
      }
    })

    if (currentRow.length > 0) {
      rows.push(currentRow)
    }

    return rows
  }

  if (!isOpen || !selectedBlockId || !selectedBlock || !blockConfig) {
    return null
  }

  const subBlockRows = groupSubBlocks(blockConfig.subBlocks, selectedBlockId)
  const BlockIcon = blockConfig.icon

  return (
    <div
      className='fixed top-[124px] bottom-4 z-10 flex flex-col rounded-[10px] border bg-card shadow-xs'
      style={{
        width: `${designWidth}px`,
        right: `${rightPosition}px`,
      }}
    >
      {/* Invisible resize handle */}
      <div
        className='-left-1 absolute top-0 bottom-0 w-2 cursor-col-resize'
        onMouseDown={handleResizeStart}
      />

      {/* Header */}
      <div className='flex items-center justify-between px-3 pt-3 pb-1'>
        <div className='flex items-center gap-1.5'>
          <div
            className='flex h-4 w-4 items-center justify-center rounded'
            style={{ backgroundColor: blockConfig.bgColor }}
          >
            <BlockIcon className='h-2.5 w-2.5 text-white' />
          </div>
          <h2 className='font-[450] text-base text-card-foreground capitalize'>
            {selectedBlock.name || 'Block Config'}
          </h2>
        </div>
        <button
          onClick={closeDesign}
          className='font-medium text-md leading-normal transition-[filter] hover:brightness-75 focus:outline-none focus-visible:outline-none active:outline-none dark:hover:brightness-125'
          style={{ color: 'var(--base-muted-foreground)' }}
        >
          <X className='h-4 w-4' strokeWidth={2} />
        </button>
      </div>

      {/* Content Area */}
      <div className='flex-1 overflow-hidden px-3'>
        <ScrollArea className='h-full' hideScrollbar={false}>
          <div className='space-y-4 pt-3 pb-4'>
            {subBlockRows.length > 0 ? (
              subBlockRows.map((row, rowIndex) => (
                <div key={`row-${rowIndex}`} className='flex gap-4'>
                  {row.map((subBlock, blockIndex) => (
                    <div
                      key={`${selectedBlockId}-${rowIndex}-${blockIndex}`}
                      className={cn('space-y-1', subBlock.layout === 'half' ? 'flex-1' : 'w-full')}
                    >
                      <SubBlock
                        blockId={selectedBlockId}
                        config={subBlock}
                        isConnecting={false}
                        isPreview={false}
                        disabled={!userPermissions.canEdit}
                        fieldDiffStatus={undefined}
                        allowExpandInPreview={false}
                      />
                    </div>
                  ))}
                </div>
              ))
            ) : (
              <div className='py-8 text-center text-muted-foreground text-sm'>
                No configuration options available
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  )
}
