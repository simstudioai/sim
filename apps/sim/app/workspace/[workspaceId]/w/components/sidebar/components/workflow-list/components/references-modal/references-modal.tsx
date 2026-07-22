'use client'

import { useState } from 'react'
import { ChipModal, ChipModalBody, ChipModalHeader, ChipModalTabs } from '@sim/emcn'
import { useRouter } from 'next/navigation'
import { ReferenceTree } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workflow-list/components/references-modal/components/reference-tree/reference-tree'
import { useWorkflowReferences } from '@/hooks/queries/workflow-references'

type ReferencesTab = 'callers' | 'callees'

const TABS = [
  { value: 'callers', label: 'Used by' },
  { value: 'callees', label: 'Uses' },
] as const

const EMPTY_MESSAGE: Record<ReferencesTab, string> = {
  callers: 'No workflows call this workflow.',
  callees: "This workflow doesn't call any other workflows.",
}

interface ReferencesModalProps {
  onClose: () => void
  workspaceId: string
  workflowId: string
  workflowName: string
}

/**
 * IDE-style reference viewer for a workflow. "Used by" lists the workflows that
 * call it (inbound); "Uses" lists the workflows it calls (outbound). Both are
 * recursive trees whose rows navigate to the referenced workflow. Mounted on
 * demand by the owning row, so state initializes fresh per open.
 */
export function ReferencesModal({
  onClose,
  workspaceId,
  workflowId,
  workflowName,
}: ReferencesModalProps) {
  const router = useRouter()
  const [activeTab, setActiveTab] = useState<ReferencesTab>('callers')

  const { data, isPending, isError } = useWorkflowReferences(workflowId)

  const handleNavigate = (targetId: string) => {
    router.push(`/workspace/${workspaceId}/w/${targetId}`)
    onClose()
  }

  const nodes = data?.[activeTab] ?? []

  return (
    <ChipModal open onOpenChange={(next) => !next && onClose()} srTitle='References'>
      <ChipModalHeader onClose={onClose}>References · {workflowName}</ChipModalHeader>
      <ChipModalBody>
        <ChipModalTabs
          tabs={TABS}
          value={activeTab}
          onChange={(value) => setActiveTab(value as ReferencesTab)}
          aria-label='Reference direction'
        />
        {isPending ? (
          <p className='px-2 text-[var(--text-muted)] text-sm'>Loading references…</p>
        ) : isError ? (
          <p className='px-2 text-[var(--text-error)] text-sm'>Failed to load references.</p>
        ) : nodes.length === 0 ? (
          <p className='px-2 text-[var(--text-muted)] text-sm'>{EMPTY_MESSAGE[activeTab]}</p>
        ) : (
          <ReferenceTree nodes={nodes} onNavigate={handleNavigate} />
        )}
      </ChipModalBody>
    </ChipModal>
  )
}
