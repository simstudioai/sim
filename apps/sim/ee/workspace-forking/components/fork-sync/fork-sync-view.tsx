'use client'

import { type Dispatch, Fragment, type SetStateAction, useMemo, useState } from 'react'
import {
  Badge,
  ChevronDown,
  ChipCombobox,
  ChipSwitch,
  CollapsibleCard,
  cn,
  FieldDivider,
  Label,
} from '@sim/emcn'
import { ArrowRight } from 'lucide-react'
import type {
  ForkCopyableUnmapped,
  ForkDependentReconfig,
  ForkMappingEntry,
  ForkResourceUsage,
} from '@/lib/api/contracts/workspace-fork'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  FileKindRow,
  ResourceKindRow,
} from '@/ee/workspace-forking/components/fork-resource-picker/fork-resource-picker'
import { forkBlockerResolution } from '@/ee/workspace-forking/components/fork-sync/cleared-refs-list'
import { forkRefKey } from '@/ee/workspace-forking/components/fork-sync/copy-reconciliation'
import { DependentFieldSelector } from '@/ee/workspace-forking/components/fork-sync/dependent-field-selector'
import {
  dependentKey,
  effectiveCopyDependentValue,
  effectiveDependentValue,
} from '@/ee/workspace-forking/components/fork-sync/dependent-value'
import type {
  ForkKindSummary,
  ForkMappingGroup,
  ForkSyncController,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'
import type { SelectorKey } from '@/hooks/selectors/types'

/**
 * Copyable kinds as expandable rows in the "Copy resources" section, ordered + labeled to match
 * the fork modal's resource picker exactly. Files nest in a folder ▸ file tree; every other kind
 * is a flat list.
 */
const COPYABLE_KIND_SECTIONS: ReadonlyArray<{
  kind: ForkCopyableUnmapped['kind']
  label: string
}> = [
  { kind: 'file', label: 'Files' },
  { kind: 'table', label: 'Tables' },
  { kind: 'knowledge-base', label: 'Knowledge bases' },
  { kind: 'custom-tool', label: 'Custom tools' },
  { kind: 'skill', label: 'Skills' },
  { kind: 'mcp-server', label: 'MCP servers' },
]

/**
 * Sentinel option value for the "New copy" entry - the displayed resolution while a copyable
 * is copy-selected, and the way back to the copy flow after mapping. Handled via onSelect,
 * never sent.
 */
const NEW_COPY_VALUE = '__new_copy__'

/** Fixed target-picker width so every mapping row's control lines up as one column (mirrors General). */
const MAPPING_TARGET_TRIGGER_CLASS = 'w-[240px] flex-shrink-0'

interface DependentBlock {
  targetBlockId: string
  blockName: string
  fields: ForkDependentReconfig[]
}

interface WorkflowDependents {
  workflowId: string
  workflowName: string
  blocks: DependentBlock[]
}

/**
 * Bucket an entry's dependents per workflow, then per block within it - the
 * workflow → block hierarchy the workflow cards render from.
 */
function groupDependentsByWorkflow(
  workflows: ForkResourceUsage['workflows'],
  dependents: ForkDependentReconfig[]
): WorkflowDependents[] {
  const byWorkflow = new Map<string, ForkDependentReconfig[]>()
  for (const dependent of dependents) {
    const list = byWorkflow.get(dependent.targetWorkflowId)
    if (list) list.push(dependent)
    else byWorkflow.set(dependent.targetWorkflowId, [dependent])
  }
  return workflows.map((workflow) => {
    const byBlock = new Map<string, DependentBlock>()
    for (const field of byWorkflow.get(workflow.workflowId) ?? []) {
      let block = byBlock.get(field.targetBlockId)
      if (!block) {
        block = { targetBlockId: field.targetBlockId, blockName: field.blockName, fields: [] }
        byBlock.set(field.targetBlockId, block)
      }
      block.fields.push(field)
    }
    return {
      workflowId: workflow.workflowId,
      workflowName: workflow.workflowName,
      blocks: Array.from(byBlock.values()).sort((a, b) => a.blockName.localeCompare(b.blockName)),
    }
  })
}

/** Chain state for one block: the SelectorContext values its parent fields provide. */
function blockChainState(
  block: DependentBlock,
  effectiveValue: (field: ForkDependentReconfig) => string
) {
  const providedValues: Record<string, string> = {}
  const providedContextKeys = new Set<string>()
  for (const field of block.fields) {
    if (field.providesContextKey) {
      providedContextKeys.add(field.providesContextKey)
      const value = effectiveValue(field)
      if (value) providedValues[field.providesContextKey] = value
    }
  }
  return { providedValues, providedContextKeys }
}

/** Store a re-pick and invalidate in-block children chained off the changed field. */
function applyDependentRepick(
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>,
  field: ForkDependentReconfig,
  blockFields: ForkDependentReconfig[],
  value: string
) {
  setReconfig((prev) => {
    const nextState = { ...prev, [dependentKey(field)]: value }
    // A changed parent invalidates its children's stale re-picks.
    const providedKey = field.providesContextKey
    if (providedKey) {
      for (const sibling of blockFields) {
        if (sibling.consumesContextKeys.includes(providedKey)) {
          delete nextState[dependentKey(sibling)]
        }
      }
    }
    return nextState
  })
}

interface DependentSelectorProps {
  field: ForkDependentReconfig
  block: DependentBlock
  target: string
  parentChanged: boolean
  /** True when the parent is resolved by COPY: browse the SOURCE parent, seeded from the source. */
  copying: boolean
  workspaceId: string
  sourceWorkspaceId: string
  reconfig: Record<string, string>
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>
}

/**
 * One depends-on field's selector. Under a MAPPED parent it browses the TARGET parent
 * (pre-filled from the stored value, blank after a parent change) and is disabled until the
 * parent target is set. Under a COPY-resolved parent it browses the SOURCE parent (the copy
 * will contain exactly those children), pre-filled with the source reference. Either way it
 * stays disabled until every chained in-block parent has a value, and a re-pick invalidates
 * chained children.
 */
function DependentSelector({
  field,
  block,
  target,
  parentChanged,
  copying,
  workspaceId,
  sourceWorkspaceId,
  reconfig,
  setReconfig,
}: DependentSelectorProps) {
  const effectiveValue = (f: ForkDependentReconfig) =>
    copying
      ? effectiveCopyDependentValue(f, reconfig)
      : effectiveDependentValue(f, reconfig, parentChanged)
  const { providedValues, providedContextKeys } = blockChainState(block, effectiveValue)
  // Disabled until every in-block parent it depends on has a value, so a child never queries
  // a stale upstream value.
  const ready = field.consumesContextKeys.every(
    (key) => !providedContextKeys.has(key) || providedValues[key] !== undefined
  )
  // A copy-resolved parent has no target id until the sync runs - scope to the SOURCE parent
  // instead (its children are what the copy brings), keeping the selector fully editable.
  const parentValue = copying ? field.parentSourceId : target
  return (
    <DependentFieldSelector
      selectorKey={field.selectorKey as SelectorKey}
      context={{
        ...field.context,
        ...providedValues,
        // Owning workspace, for workspace-scoped selectors like table.columns.
        workspaceId: copying ? sourceWorkspaceId : workspaceId,
        [field.parentContextKey]: parentValue,
      }}
      enabled={parentValue !== '' && ready}
      value={effectiveValue(field)}
      onChange={(value) => applyDependentRepick(setReconfig, field, block.fields, value)}
      title={field.title}
    />
  )
}

interface DependentWorkflowCardProps {
  workflow: WorkflowDependents
  target: string
  parentChanged: boolean
  /** True when the parent is resolved by COPY - the selectors browse the SOURCE parent. */
  copying: boolean
  workspaceId: string
  sourceWorkspaceId: string
  reconfig: Record<string, string>
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>
}

/**
 * One workflow's dependent fields as a collapsible card (the same `CollapsibleCard` the table
 * workflow sidebar's input mapping and the enrichment config use): the header names the
 * workflow; the body groups fields under block → optional tool → plain field label.
 * Cards holding a required field start expanded - a required field is what gates Sync.
 */
function DependentWorkflowCard({
  workflow,
  target,
  parentChanged,
  copying,
  workspaceId,
  sourceWorkspaceId,
  reconfig,
  setReconfig,
}: DependentWorkflowCardProps) {
  const [collapsed, setCollapsed] = useState(
    () => !workflow.blocks.some((block) => block.fields.some((field) => field.required))
  )
  return (
    <CollapsibleCard
      title={workflow.workflowName}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((value) => !value)}
    >
      <div className='flex flex-col gap-3'>
        {workflow.blocks.map((block) => {
          const topLevel = block.fields.filter((field) => !field.toolName)
          const byTool = new Map<string, ForkDependentReconfig[]>()
          for (const field of block.fields) {
            if (!field.toolName) continue
            const list = byTool.get(field.toolName)
            if (list) list.push(field)
            else byTool.set(field.toolName, [field])
          }
          const toolGroups = Array.from(byTool.entries()).sort(([a], [b]) => a.localeCompare(b))

          return (
            <div key={block.targetBlockId} className='flex flex-col gap-2'>
              <Label className='text-small'>{block.blockName}</Label>
              {topLevel.map((field) => (
                <div key={dependentKey(field)} className='flex flex-col gap-1'>
                  <Label className='text-[var(--text-muted)] text-caption'>
                    {field.title}
                    {field.required ? <span className='text-[var(--text-error)]'> *</span> : null}
                  </Label>
                  <DependentSelector
                    field={field}
                    block={block}
                    target={target}
                    parentChanged={parentChanged}
                    copying={copying}
                    workspaceId={workspaceId}
                    sourceWorkspaceId={sourceWorkspaceId}
                    reconfig={reconfig}
                    setReconfig={setReconfig}
                  />
                </div>
              ))}
              {toolGroups.map(([toolName, fields]) => (
                <div key={toolName} className='flex flex-col gap-1.5 pl-2'>
                  <span className='text-[var(--text-muted)] text-small'>{toolName}</span>
                  {fields.map((field) => (
                    <div key={dependentKey(field)} className='flex flex-col gap-1'>
                      <Label className='text-[var(--text-muted)] text-caption'>
                        {field.title}
                        {field.required ? (
                          <span className='text-[var(--text-error)]'> *</span>
                        ) : null}
                      </Label>
                      <DependentSelector
                        field={field}
                        block={block}
                        target={target}
                        parentChanged={parentChanged}
                        copying={copying}
                        workspaceId={workspaceId}
                        sourceWorkspaceId={sourceWorkspaceId}
                        reconfig={reconfig}
                        setReconfig={setReconfig}
                      />
                    </div>
                  ))}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </CollapsibleCard>
  )
}

interface MappingEntryProps {
  controller: ForkSyncController
  group: ForkMappingGroup
  entry: ForkMappingEntry
}

/**
 * One mapping entry: the source ↔ target picker row (with a "Copy instead" entry for copy
 * candidates and per-source taken-target disabling on push), then one collapsible card per
 * workflow the resource is used in, holding that workflow's dependent field selectors.
 * Workflows with nothing to configure are named in a muted note so the usage stays visible.
 */
function MappingEntry({ controller, group, entry }: MappingEntryProps) {
  const target = controller.targetFor(entry)
  const takenOwners = controller.takenOwnersFor(entry, group.items)
  const parentChanged = controller.parentChangedFor(entry)
  const entryRefKey = forkRefKey(entry)
  const copying = controller.copyingKeys.has(entryRefKey)

  const usages = controller.usagesForEntry(entry)
  const dependents = controller.dependentsForEntry(entry)
  // Group once per (usages, dependents) change - both keep stable references from the
  // controller's memoized maps, so this skips recompute across the page's frequent re-renders.
  const workflows = useMemo(
    () => groupDependentsByWorkflow(usages, dependents),
    [usages, dependents]
  )
  const configurable = workflows.filter((workflow) => workflow.blocks.length > 0)
  const usedOnly = workflows.filter((workflow) => workflow.blocks.length === 0)

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-col gap-1'>
        <div className='flex items-center justify-between gap-4'>
          <Label className='min-w-0 truncate'>{entry.sourceLabel}</Label>
          <div className={MAPPING_TARGET_TRIGGER_CLASS}>
            <ChipCombobox
              className='w-full'
              align='start'
              options={[
                // While copy-resolved, the closed control shows the copy by NAME (the copy
                // keeps the source's name) via a hidden display-only option; the list itself
                // stays unambiguous.
                ...(controller.copyableKeys.has(entryRefKey) && copying
                  ? [{ label: entry.sourceLabel, value: NEW_COPY_VALUE, hidden: true }]
                  : []),
                // The way back to the copy flow after mapping - clears the target via onSelect.
                ...(controller.copyableKeys.has(entryRefKey) && target !== ''
                  ? [
                      {
                        label: 'New copy',
                        value: NEW_COPY_VALUE,
                        onSelect: () => controller.setTarget(entry, ''),
                      },
                    ]
                  : []),
                ...entry.candidates.map((candidate) => {
                  const owner = takenOwners.get(candidate.id)
                  return {
                    label: owner ? `${candidate.label} · mapped to ${owner}` : candidate.label,
                    value: candidate.id,
                    disabled: owner !== undefined,
                  }
                }),
              ]}
              value={copying ? NEW_COPY_VALUE : target || undefined}
              onChange={(value) => controller.setTarget(entry, value)}
              placeholder='Select target'
            />
          </div>
        </div>
        {entry.candidatesTruncated ? (
          <p className='text-[var(--text-muted)] text-small'>
            More options than shown — search by name.
          </p>
        ) : null}
      </div>
      {configurable.map((workflow) => (
        <DependentWorkflowCard
          key={workflow.workflowId}
          workflow={workflow}
          target={target}
          parentChanged={parentChanged}
          copying={copying}
          workspaceId={controller.targetWorkspaceId}
          sourceWorkspaceId={controller.sourceWorkspaceId}
          reconfig={controller.reconfig}
          setReconfig={controller.setReconfig}
        />
      ))}
      {usedOnly.length > 0 ? (
        <p className='text-[var(--text-tertiary)] text-caption'>
          Also used in {usedOnly.map((workflow) => workflow.workflowName).join(', ')} — nothing to
          configure there.
        </p>
      ) : null}
    </div>
  )
}

/** Badge copy + color for one kind's mapping status (shared badge rules with the old summary). */
function kindStatusBadge(summary: ForkKindSummary): {
  label: string
  variant: 'green' | 'amber' | 'gray-secondary'
} {
  const { total, mapped, copied, requiredPending, reconfigPending } = summary
  const resolved = mapped + copied
  const complete = resolved === total && !reconfigPending
  const label = complete
    ? mapped === total
      ? 'Fully mapped'
      : copied === total
        ? 'Copied'
        : 'Mapped & copied'
    : reconfigPending && resolved === total
      ? 'Needs setup'
      : copied > 0
        ? `${resolved}/${total} ready`
        : `${mapped}/${total} mapped`
  const variant = complete
    ? 'green'
    : requiredPending || reconfigPending
      ? 'amber'
      : 'gray-secondary'
  return { label, variant }
}

interface MappingKindRowProps {
  controller: ForkSyncController
  group: ForkMappingGroup
  summary: ForkKindSummary
}

/**
 * One resource kind in the Mappings section: a chevron header row with the kind's status badge
 * (the summary IS the entry), expanding to that kind's mapping entries. Mirrors the expandable
 * kind rows of the Copy resources section so the two sections share one interaction rhythm.
 */
function MappingKindRow({ controller, group, summary }: MappingKindRowProps) {
  const [open, setOpen] = useState(false)
  const badge = kindStatusBadge(summary)
  return (
    <div className='flex flex-col'>
      <button
        type='button'
        onClick={() => setOpen((value) => !value)}
        className='flex w-full items-center gap-2 text-left text-[var(--text-body)] text-sm transition-colors hover:text-[var(--text-primary)]'
      >
        <span className='min-w-0 flex-1 truncate'>{group.label}</span>
        <Badge variant={badge.variant} size='sm' dot>
          {badge.label}
        </Badge>
        <ChevronDown
          className={cn(
            'h-[6px] w-[10px] shrink-0 text-[var(--text-icon)] transition-transform',
            open && 'rotate-180'
          )}
        />
      </button>
      {open ? (
        <div className='flex flex-col pt-3 pb-1'>
          {group.items.map((entry, index) => (
            <Fragment key={forkRefKey(entry)}>
              {index > 0 ? <FieldDivider /> : null}
              <MappingEntry controller={controller} group={group} entry={entry} />
            </Fragment>
          ))}
        </div>
      ) : null}
    </div>
  )
}

interface CopyKindSectionsProps {
  controller: ForkSyncController
  byKind: ReadonlyMap<ForkCopyableUnmapped['kind'], ForkCopyableUnmapped[]>
}

/**
 * One expandable row per copyable kind present in `byKind` - shared by the referenced group
 * and the unreferenced "Not used by any workflow" group so both render exactly like the fork
 * picker (files as a folder tree, every other kind flat).
 */
function CopyKindSections({ controller, byKind }: CopyKindSectionsProps) {
  return (
    <>
      {COPYABLE_KIND_SECTIONS.map((section) => {
        const candidates = byKind.get(section.kind)
        if (!candidates || candidates.length === 0) return null
        // The picker rows track item ids; copy selection is keyed `${kind}:${id}`
        // (matching `forkRefKey`), so derive the per-kind selected-id subset and
        // re-prefix on toggle.
        const selectedIds = new Set(
          candidates
            .filter((candidate) => controller.copySelected.has(forkRefKey(candidate)))
            .map((candidate) => candidate.sourceId)
        )
        const toggleMany = (ids: string[], checked: boolean) =>
          controller.toggleCopyKeys(
            ids.map((id) => `${section.kind}:${id}`),
            checked
          )
        const toggleAll = (selectAll: boolean) =>
          toggleMany(
            candidates.map((candidate) => candidate.sourceId),
            selectAll
          )
        return section.kind === 'file' ? (
          <FileKindRow
            key={section.kind}
            label={section.label}
            files={candidates.map((candidate) => ({
              id: candidate.sourceId,
              label: candidate.label,
              folderId: candidate.parentId,
              folderName: candidate.parentLabel,
            }))}
            selected={selectedIds}
            onToggleAll={toggleAll}
            onToggleItem={(id, checked) => toggleMany([id], checked)}
            onToggleMany={toggleMany}
            disabled={controller.submitting}
          />
        ) : (
          <ResourceKindRow
            key={section.kind}
            label={section.label}
            items={candidates.map((candidate) => ({
              id: candidate.sourceId,
              label: candidate.label,
            }))}
            selected={selectedIds}
            onToggleMany={toggleMany}
            onToggleItem={(id, checked) => toggleMany([id], checked)}
            disabled={controller.submitting}
          />
        )
      })}
    </>
  )
}

interface ForkSyncViewProps {
  controller: ForkSyncController
  onDirectionChange: (direction: ForkDirection) => void
}

/**
 * The parent fork edge's sync experience as page sections: pick a direction, review the
 * deployed-workflow changes, resolve the per-kind mappings (each kind an expandable row whose
 * status badge doubles as the summary), choose which unmapped resources to copy, and clear any
 * blocking references. The page header's Sync action commits it (after the overwrite confirm).
 */
export function ForkSyncView({ controller, onDirectionChange }: ForkSyncViewProps) {
  const detailsError = controller.errorMessage ?? controller.diffErrorMessage
  const headsUp = controller.mcpReauthCount > 0 || controller.inlineSecretCount > 0

  return (
    <div className='flex flex-col gap-7'>
      <SettingsSection label='Sync direction'>
        <div className='flex flex-col gap-2'>
          <ChipSwitch
            value={controller.direction}
            onChange={onDirectionChange}
            aria-label='Sync direction'
            options={[
              { value: 'push', label: 'Push' },
              { value: 'pull', label: 'Pull' },
            ]}
          />
          <p className='text-[var(--text-muted)] text-caption'>
            {controller.direction === 'push'
              ? `Push this workspace's deployed workflows to "${controller.otherWorkspaceName}", overwriting it.`
              : `Pull deployed workflows from "${controller.otherWorkspaceName}", overwriting this workspace.`}
          </p>
        </div>
      </SettingsSection>

      {/* Surface a failed/pending fetch so the page never renders blank below the direction. */}
      {detailsError ? (
        <SettingsSection label='Sync details'>
          <div className='text-[var(--text-error)] text-small'>{detailsError}</div>
        </SettingsSection>
      ) : !controller.hasDiff ? (
        <div className='text-[var(--text-muted)] text-small'>Loading sync details…</div>
      ) : null}

      {/* Always shown once the diff loads so the user sees the section even with nothing
          deployed - an empty change list means the source has no deployed workflows (every
          deployed workflow appears here, changed or not), so the muted state nudges a deploy. */}
      {controller.hasDiff ? (
        <SettingsSection label='Deployed workflows'>
          {controller.workflowChanges.length > 0 ? (
            <div className='flex flex-col gap-1'>
              {controller.workflowChanges.map((change, index) => {
                const renamed = change.currentName !== change.otherName
                return (
                  <div
                    key={`${change.action}:${change.currentName}:${index}`}
                    className='flex min-w-0 items-center gap-1.5'
                  >
                    <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>
                      {change.currentName}
                    </span>
                    {renamed ? (
                      <>
                        <ArrowRight className='size-3 shrink-0 text-[var(--text-icon)]' />
                        <span className='min-w-0 truncate text-[var(--text-secondary)] text-sm'>
                          {change.otherName}
                        </span>
                      </>
                    ) : null}
                  </div>
                )
              })}
            </div>
          ) : (
            <div className='text-[var(--text-muted)] text-small'>
              {controller.direction === 'push'
                ? `No deployed workflows. Deploy workflows to push changes to ${controller.otherWorkspaceName}.`
                : `No deployed workflows in ${controller.otherWorkspaceName} to pull.`}
            </div>
          )}
        </SettingsSection>
      ) : null}

      {headsUp ? (
        <SettingsSection label='Heads up'>
          {controller.mcpReauthCount > 0 ? (
            <div className='text-[var(--text-muted)] text-small'>
              {controller.mcpReauthCount} MCP server(s) use OAuth and must be re-authorized in the
              target workspace.
            </div>
          ) : null}
          {controller.inlineSecretCount > 0 ? (
            <div className='mt-1 text-[var(--text-muted)] text-small'>
              {controller.inlineSecretCount} inline secret(s) can't be auto-mapped — set them in the
              target workspace.
            </div>
          ) : null}
        </SettingsSection>
      ) : null}

      {controller.hasMapping ? (
        <SettingsSection label='Mappings'>
          {controller.groups.length > 0 ? (
            <div className='flex flex-col gap-2'>
              {controller.groups.map((group) => {
                const summary = controller.kindSummaries.find((item) => item.kind === group.kind)
                if (!summary) return null
                return (
                  <MappingKindRow
                    key={group.kind}
                    controller={controller}
                    group={group}
                    summary={summary}
                  />
                )
              })}
            </div>
          ) : (
            <SettingsEmptyState variant='inline'>
              This workspace's deployed workflows have no mappable references.
            </SettingsEmptyState>
          )}
        </SettingsSection>
      ) : null}

      {controller.hasVisibleCopyables ? (
        <SettingsSection label='Copy resources'>
          <div className='flex flex-col gap-2'>
            {controller.referencedByKind.size > 0 ? (
              <CopyKindSections controller={controller} byKind={controller.referencedByKind} />
            ) : null}
            {controller.unreferencedByKind.size > 0 ? (
              <>
                {controller.referencedByKind.size > 0 ? (
                  <div className='mt-2 text-[var(--text-muted)] text-caption'>
                    Not used by any workflow
                  </div>
                ) : null}
                <CopyKindSections controller={controller} byKind={controller.unreferencedByKind} />
              </>
            ) : null}
          </div>
        </SettingsSection>
      ) : null}

      {controller.blockingRefs.length > 0 ? (
        <SettingsSection label='Blocking sync'>
          <div className='flex flex-col gap-1'>
            {controller.blockingRefs.map((ref, index) => (
              <div
                key={`${ref.targetWorkflowId}:${ref.blockId}:${ref.kind}:${ref.sourceId}:${ref.fieldLabel}:${index}`}
                className='min-w-0 text-[var(--text-secondary)] text-small'
              >
                <span className='text-[var(--text-body)]'>{ref.blockLabel}</span> would lose{' '}
                <span className='text-[var(--text-body)]'>{ref.fieldLabel}</span> in{' '}
                {ref.workflowName} — {forkBlockerResolution(ref)}
              </div>
            ))}
          </div>
        </SettingsSection>
      ) : null}

      {controller.dependentClears.length > 0 ? (
        <SettingsSection label='Will be cleared'>
          <div className='flex flex-col gap-1'>
            {controller.dependentClears.map((ref, index) => (
              <div
                key={`${ref.targetWorkflowId}:${ref.blockId}:${ref.kind}:${ref.sourceId}:${ref.fieldLabel}:${index}`}
                className='min-w-0 text-[var(--text-secondary)] text-small'
              >
                <span className='text-[var(--text-body)]'>{ref.blockLabel}</span> will lose{' '}
                <span className='text-[var(--text-body)]'>{ref.fieldLabel}</span> in{' '}
                {ref.workflowName}
              </div>
            ))}
          </div>
          <p className='text-[var(--text-muted)] text-caption'>
            Re-pick these in the target after the sync.
          </p>
        </SettingsSection>
      ) : null}
    </div>
  )
}
