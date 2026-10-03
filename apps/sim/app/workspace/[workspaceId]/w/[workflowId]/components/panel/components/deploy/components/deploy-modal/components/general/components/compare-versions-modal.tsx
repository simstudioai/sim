'use client'

import { useMemo, useState } from 'react'
import { ChipDropdown, type ChipDropdownOption } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import type { WorkflowDeploymentVersionResponse } from '@/lib/workflows/persistence/utils'
import { formatVersionLabel } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/components/deploy-modal/components/general/format-version-label'
import { useDraftWorkflowState } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/deploy/hooks/use-draft-workflow-state'
import { WorkflowComparisonModal } from '@/app/workspace/[workspaceId]/w/components/workflow-diff'
import { useDeploymentVersionState } from '@/hooks/queries/workflows'

/** One side of a comparison: the editor draft or a numbered deployment version. */
export type CompareSide = { kind: 'draft' } | { kind: 'version'; version: number }

const DRAFT_OPTION_VALUE = 'draft'

/** The visible label of the selected option, so each picker's accessible name says what it holds. */
function optionLabel(options: ChipDropdownOption[], value: string): string {
  const label = options.find((option) => option.value === value)?.label
  return typeof label === 'string' ? label : ''
}

function sideToValue(side: CompareSide): string {
  return side.kind === 'draft' ? DRAFT_OPTION_VALUE : String(side.version)
}

function valueToSide(value: string): CompareSide {
  return value === DRAFT_OPTION_VALUE
    ? { kind: 'draft' }
    : { kind: 'version', version: Number(value) }
}

interface CompareVersionsModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  workflowId: string
  versions: WorkflowDeploymentVersionResponse[]
  initialBase: CompareSide
  initialTarget: CompareSide
}

/**
 * Full-width comparison of any two versions of this workflow, including the
 * unsaved draft. Both sides are pickable from the header so a reviewer can
 * move between pairs without leaving the view.
 */
export function CompareVersionsModal({
  open,
  onOpenChange,
  workflowId,
  versions,
  initialBase,
  initialTarget,
}: CompareVersionsModalProps) {
  const [base, setBase] = useState<CompareSide>(initialBase)
  const [target, setTarget] = useState<CompareSide>(initialTarget)
  /* Subscribed only while the modal is open, and only if a side is the draft. */
  const draftState = useDraftWorkflowState(
    workflowId,
    base.kind === 'draft' || target.kind === 'draft'
  )

  const options = useMemo((): ChipDropdownOption[] => {
    const sorted = [...versions].sort((a, b) => b.version - a.version)
    return [
      { value: DRAFT_OPTION_VALUE, label: 'Draft' },
      ...sorted.map((version) => {
        /* A name that merely repeats the number would read as "v2 · v2". */
        const name = version.name === `v${version.version}` ? null : version.name
        const label = formatVersionLabel(version.version, name)
        return {
          value: String(version.version),
          label: version.isActive ? `${label} (live)` : label,
        }
      }),
    ]
  }, [versions])

  const baseQuery = useDeploymentVersionState(
    workflowId,
    base.kind === 'version' ? base.version : null
  )
  const targetQuery = useDeploymentVersionState(
    workflowId,
    target.kind === 'version' ? target.version : null
  )

  const baseState = base.kind === 'draft' ? draftState : (baseQuery.data ?? null)
  const targetState = target.kind === 'draft' ? draftState : (targetQuery.data ?? null)
  const isLoading =
    (base.kind === 'version' && baseQuery.isLoading) ||
    (target.kind === 'version' && targetQuery.isLoading)
  const loadError = baseQuery.error ?? targetQuery.error

  return (
    <WorkflowComparisonModal
      open={open}
      onOpenChange={onOpenChange}
      header={
        <div className='flex items-center gap-2'>
          <span>Compare</span>
          <ChipDropdown
            options={options}
            value={sideToValue(base)}
            onChange={(value) => setBase(valueToSide(value))}
            align='start'
            aria-label={`Compare from ${optionLabel(options, sideToValue(base))}`}
          />
          <ArrowRight className='size-[12px] shrink-0 text-[var(--text-icon)]' />
          <ChipDropdown
            options={options}
            value={sideToValue(target)}
            onChange={(value) => setTarget(valueToSide(value))}
            align='start'
            aria-label={`Compare to ${optionLabel(options, sideToValue(target))}`}
          />
        </div>
      }
      baseState={baseState}
      targetState={targetState}
      isLoading={isLoading}
      error={loadError}
      comparisonKey={`${sideToValue(base)}:${sideToValue(target)}`}
    />
  )
}
