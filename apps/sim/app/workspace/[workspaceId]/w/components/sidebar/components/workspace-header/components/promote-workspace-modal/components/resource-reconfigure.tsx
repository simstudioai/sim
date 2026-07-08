'use client'

import { type Dispatch, type SetStateAction, useMemo, useState } from 'react'
import { ChevronDown, cn } from '@sim/emcn'
import type { ForkDependentReconfig, ForkResourceUsage } from '@/lib/api/contracts/workspace-fork'
import { DependentFieldSelector } from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/components/dependent-field-selector'
import {
  dependentKey,
  effectiveDependentValue,
} from '@/app/workspace/[workspaceId]/w/components/sidebar/components/workspace-header/components/promote-workspace-modal/dependent-value'
import type { SelectorKey } from '@/hooks/selectors/types'

/** Stable empty array so a workflow with no dependents reuses one reference (no per-map alloc). */
const EMPTY_DEPENDENTS: ForkDependentReconfig[] = []

interface ReconfigBlock {
  targetBlockId: string
  blockName: string
  fields: ForkDependentReconfig[]
}

/** Group a workflow's dependent fields by their block, sorted by block name. */
function groupByBlock(fields: ForkDependentReconfig[]): ReconfigBlock[] {
  const byBlock = new Map<string, ReconfigBlock>()
  for (const field of fields) {
    let block = byBlock.get(field.targetBlockId)
    if (!block) {
      block = { targetBlockId: field.targetBlockId, blockName: field.blockName, fields: [] }
      byBlock.set(field.targetBlockId, block)
    }
    block.fields.push(field)
  }
  return Array.from(byBlock.values()).sort((a, b) => a.blockName.localeCompare(b.blockName))
}

interface ResourceReconfigureProps {
  /** Every workflow this resource is used in (from the diff's `resourceUsages`). */
  workflows: ForkResourceUsage['workflows']
  /** This resource's dependent fields across all its workflows (from `dependentReconfigs`). */
  dependents: ForkDependentReconfig[]
  /** The chosen target id (credential/KB/table) the selectors query against. */
  parentTargetValue: string
  /** True when the target was changed in-session: start blank (the old value won't resolve). */
  parentChanged: boolean
  /**
   * The target workspace the dependent selectors query against (direction-aware: the parent on
   * push, the child on pull). Workspace-scoped selectors like `table.columns` and sim workflow
   * pickers gate on it - the canvas supplies it from the active workspace, so the modal must too.
   */
  workspaceId: string
  reconfig: Record<string, string>
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>
}

/**
 * Always-on per-resource reconfigure listing: every workflow the resource is used in, each a
 * chevron row that expands to its blocks + dependent selectors so the user can (re)configure
 * them at any time - not only right after a target swap. A workflow with nothing configurable
 * (a secret/file, or a credential with no dependent selector here) renders as a plain
 * non-interactive row without a chevron, with a tooltip, so the usage is still visible.
 */
export function ResourceReconfigure({
  workflows,
  dependents,
  parentTargetValue,
  parentChanged,
  workspaceId,
  reconfig,
  setReconfig,
}: ResourceReconfigureProps) {
  // Group each workflow's dependents into blocks once per (workflows, dependents) change, so
  // the grouping doesn't re-run on every parent re-render (setTargets / setReconfig fire often
  // during the editing step). Bucket dependents by target workflow in a single pass first, so
  // the per-workflow lookup is O(1) instead of a fresh `.filter` per workflow (O(W x D)).
  const workflowBlocks = useMemo(() => {
    const dependentsByWorkflow = new Map<string, ForkDependentReconfig[]>()
    for (const dependent of dependents) {
      const list = dependentsByWorkflow.get(dependent.targetWorkflowId)
      if (list) list.push(dependent)
      else dependentsByWorkflow.set(dependent.targetWorkflowId, [dependent])
    }
    return workflows.map((workflow) => ({
      workflowId: workflow.workflowId,
      workflowName: workflow.workflowName,
      blocks: groupByBlock(dependentsByWorkflow.get(workflow.workflowId) ?? EMPTY_DEPENDENTS),
    }))
  }, [workflows, dependents])

  if (workflows.length === 0) return null
  // Muted caption label over the list (no divider) so this reads as subordinate to the
  // resource-name section header above, mirroring the "Recent runs" listing in
  // mothership-view's resource-content.
  return (
    <div className='mt-4 flex flex-col gap-2'>
      <span className='text-[var(--text-muted)] text-caption'>Workflows</span>
      <div className='flex flex-col gap-1.5'>
        {workflowBlocks.map((workflow) => (
          <ReconfigWorkflowRow
            key={workflow.workflowId}
            workflowName={workflow.workflowName}
            blocks={workflow.blocks}
            parentTargetValue={parentTargetValue}
            parentChanged={parentChanged}
            workspaceId={workspaceId}
            reconfig={reconfig}
            setReconfig={setReconfig}
          />
        ))}
      </div>
    </div>
  )
}

interface ReconfigWorkflowRowProps {
  workflowName: string
  blocks: ReconfigBlock[]
  parentTargetValue: string
  parentChanged: boolean
  workspaceId: string
  reconfig: Record<string, string>
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>
}

/** One workflow row: a chevron header (a plain non-interactive row when nothing to configure). */
function ReconfigWorkflowRow({
  workflowName,
  blocks,
  parentTargetValue,
  parentChanged,
  workspaceId,
  reconfig,
  setReconfig,
}: ReconfigWorkflowRowProps) {
  // Auto-open a row that has a required dependent so it's visible without hunting through
  // chevrons (a required field is what gates Sync). Deterministic from the block config at mount
  // (lazy initializer, no effect/flicker); the user can still collapse it, and it won't reopen on
  // re-render - only if the row remounts (its workflow changes).
  const [open, setOpen] = useState(() =>
    blocks.some((block) => block.fields.some((field) => field.required))
  )
  const configurable = blocks.length > 0

  return (
    <div className={cn('flex flex-col gap-1', configurable && open && 'pb-2')}>
      {/* Chevron styling mirrors the Activity panel's collapsible rows exactly. A row with
          nothing to configure renders as muted plain text (no chevron, not a button) with a
          native title tooltip explaining why it isn't expandable. */}
      {configurable ? (
        <button
          type='button'
          onClick={() => setOpen((value) => !value)}
          className='flex w-full items-center gap-2 text-left text-[var(--text-secondary)] text-sm transition-colors hover:text-[var(--text-primary)]'
        >
          <span className='min-w-0 flex-1 truncate'>{workflowName}</span>
          <ChevronDown
            className={cn(
              'h-[6px] w-[10px] shrink-0 text-[var(--text-icon)] transition-transform',
              open && 'rotate-180'
            )}
          />
        </button>
      ) : (
        <div
          className='truncate text-[var(--text-muted)] text-sm'
          title='Used here, but nothing to configure for this resource'
        >
          {workflowName}
        </div>
      )}
      {configurable && open
        ? blocks.map((block) => (
            <BlockReconfig
              key={block.targetBlockId}
              block={block}
              parentTargetValue={parentTargetValue}
              parentChanged={parentChanged}
              workspaceId={workspaceId}
              reconfig={reconfig}
              setReconfig={setReconfig}
            />
          ))
        : null}
    </div>
  )
}

interface BlockReconfigProps {
  block: ReconfigBlock
  parentTargetValue: string
  parentChanged: boolean
  workspaceId: string
  reconfig: Record<string, string>
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>
}

/** One block card: its dependent selectors, chained so a parent feeds its in-block children. */
function BlockReconfig({
  block,
  parentTargetValue,
  parentChanged,
  workspaceId,
  reconfig,
  setReconfig,
}: BlockReconfigProps) {
  // A field's effective value: the user's re-pick, else the stored value (stable parent) - but
  // blank after a parent change, since the old value no longer resolves. Shared with the modal.
  const effectiveValue = (field: ForkDependentReconfig) =>
    effectiveDependentValue(field, reconfig, parentChanged)

  // Chain re-picks: a field that provides a SelectorContext key feeds its effective value to
  // its in-block descendants (a spreadsheet drives the sheet selector). Track only WHICH keys
  // an in-block field provides (a Set) - the readiness check below tests membership, never a value.
  const providedValues: Record<string, string> = {}
  const providedContextKeys = new Set<string>()
  for (const field of block.fields) {
    if (field.providesContextKey) {
      providedContextKeys.add(field.providesContextKey)
      const value = effectiveValue(field)
      if (value) providedValues[field.providesContextKey] = value
    }
  }

  return (
    <div className='ml-2 flex flex-col gap-2 rounded-md border border-[var(--border)] bg-[var(--surface-1)] p-3'>
      <span className='font-medium text-[var(--text-secondary)] text-small'>{block.blockName}</span>
      {block.fields.map((field) => {
        // Disabled until the parent target is set AND every in-block parent it depends on has
        // a value, so a child never queries a stale upstream value.
        const ready = field.consumesContextKeys.every(
          (key) => !providedContextKeys.has(key) || providedValues[key] !== undefined
        )
        return (
          <div key={dependentKey(field)} className='flex flex-col gap-1'>
            <span className='text-[var(--text-tertiary)] text-caption'>
              {field.title}
              {field.required ? <span className='text-[var(--text-error)]'> *</span> : null}
            </span>
            <DependentFieldSelector
              selectorKey={field.selectorKey as SelectorKey}
              context={{
                ...field.context,
                ...providedValues,
                // Target workspace, for workspace-scoped selectors like table.columns.
                workspaceId,
                [field.parentContextKey]: parentTargetValue,
              }}
              enabled={parentTargetValue !== '' && ready}
              value={effectiveValue(field)}
              onChange={(value) =>
                setReconfig((prev) => {
                  const nextState = { ...prev, [dependentKey(field)]: value }
                  // A changed parent invalidates its children's stale re-picks.
                  const providedKey = field.providesContextKey
                  if (providedKey) {
                    for (const sibling of block.fields) {
                      if (sibling.consumesContextKeys.includes(providedKey)) {
                        delete nextState[dependentKey(sibling)]
                      }
                    }
                  }
                  return nextState
                })
              }
              title={field.title}
            />
          </div>
        )
      })}
    </div>
  )
}
