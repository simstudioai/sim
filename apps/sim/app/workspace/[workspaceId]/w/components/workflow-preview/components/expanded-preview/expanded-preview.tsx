'use client'

import { useState } from 'react'
import { Modal, ModalBody, ModalContent, ModalHeader } from '@/components/emcn'
import { PinnedSubBlocks } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/components/pinned-sub-blocks'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface ExpandedWorkflowPreviewProps {
  /** Whether the modal is open */
  isOpen: boolean
  /** Callback when closing the modal */
  onClose: () => void
  /** The workflow state to display */
  workflowState: WorkflowState
  /** Title for the modal header */
  title?: string
}

/**
 * Expanded workflow preview modal with clickable blocks.
 * Shows the workflow preview at full size with a pinned panel
 * displaying subblock values when a block is clicked.
 */
export function ExpandedWorkflowPreview({
  isOpen,
  onClose,
  workflowState,
  title = 'Workflow Preview',
}: ExpandedWorkflowPreviewProps) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)

  const selectedBlock = selectedBlockId ? workflowState.blocks?.[selectedBlockId] : null

  const handleNodeClick = (blockId: string) => {
    // Toggle selection if clicking the same block
    if (selectedBlockId === blockId) {
      setSelectedBlockId(null)
    } else {
      setSelectedBlockId(blockId)
    }
  }

  const handleClose = () => {
    setSelectedBlockId(null)
    onClose()
  }

  const handleClosePanel = () => {
    setSelectedBlockId(null)
  }

  return (
    <Modal open={isOpen} onOpenChange={handleClose}>
      <ModalContent size='full' className='flex h-[90vh] flex-col'>
        <ModalHeader>{title}</ModalHeader>

        <ModalBody className='!p-0 relative min-h-0 flex-1'>
          <div className='h-full w-full overflow-hidden rounded-[4px] border border-[var(--border)]'>
            <WorkflowPreview
              workflowState={workflowState}
              showSubBlocks={true}
              isPannable={true}
              defaultPosition={{ x: 0, y: 0 }}
              defaultZoom={0.8}
              onNodeClick={handleNodeClick}
              cursorStyle='pointer'
            />
          </div>

          {selectedBlock && <PinnedSubBlocks block={selectedBlock} onClose={handleClosePanel} />}
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
