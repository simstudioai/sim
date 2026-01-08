'use client'

import { useState } from 'react'
import { Modal, ModalBody, ModalContent, ModalHeader } from '@/components/emcn'
import { PinnedSubBlocks } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/components/pinned-sub-blocks'
import { WorkflowPreview } from '@/app/workspace/[workspaceId]/w/components/workflow-preview/workflow-preview'
import type { WorkflowState } from '@/stores/workflows/workflow/types'

interface ExpandedWorkflowPreviewProps {
  isOpen: boolean
  onClose: () => void
  workflowState: WorkflowState
  title?: string
}

export function ExpandedWorkflowPreview({
  isOpen,
  onClose,
  workflowState,
  title = 'Workflow Preview',
}: ExpandedWorkflowPreviewProps) {
  const [selectedBlockId, setSelectedBlockId] = useState<string | null>(null)

  const selectedBlock = selectedBlockId ? workflowState.blocks?.[selectedBlockId] : null

  const handleNodeClick = (blockId: string) => {
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

        <ModalBody className='!p-0 min-h-0 flex-1'>
          <div className='flex h-full w-full overflow-hidden rounded-[4px] border border-[var(--border)]'>
            {/* Canvas area */}
            <div className='h-full flex-1'>
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

            {/* Sidebar - attached to right side */}
            {selectedBlock && <PinnedSubBlocks block={selectedBlock} onClose={handleClosePanel} />}
          </div>
        </ModalBody>
      </ModalContent>
    </Modal>
  )
}
