'use client'

import { type Dispatch, type SetStateAction, useMemo, useState } from 'react'
import { Badge, Chip, ChipCombobox, ChipSwitch, CollapsibleCard, Label, Tooltip } from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import type {
  ForkCopyableUnmapped,
  ForkDependentReconfig,
  ForkMappingEntry,
  ForkResourceUsage,
  ForkTriggerMapping,
} from '@/lib/api/contracts/workspace-fork'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { forkKindLabel } from '@/ee/workspace-forking/components/fork-kind-label'
import {
  FileKindRow,
  ResourceKindRow,
} from '@/ee/workspace-forking/components/fork-resource-picker/fork-resource-picker'
import { forkRefKey } from '@/ee/workspace-forking/components/fork-sync/copy-reconciliation'
import { DependentFieldSelector } from '@/ee/workspace-forking/components/fork-sync/dependent-field-selector'
import {
  dependentKey,
  effectiveCopyDependentValue,
  effectiveDependentValue,
} from '@/ee/workspace-forking/components/fork-sync/dependent-value'
import type {
  ForkResolveItem,
  ForkResolveStatus,
} from '@/ee/workspace-forking/components/fork-sync/resolve-items'
import type { ForkSyncController } from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'
import type { SelectorKey } from '@/hooks/selectors/types'
import { buildWebhookTriggerUrl } from '@/triggers/webhook-url'

/**
 * Copyable kinds as expandable rows in the extra-resources picker, ordered and labelled to match
 * the fork modal exactly. Files nest in a folder tree; every other kind stays flat.
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

/** Sentinel for "copy this resource into the target" — handled by `onSelect`, never sent. */
const NEW_COPY_VALUE = '__new_copy__'

/** Sentinel for "accept losing this reference" — offered only where the source is already gone. */
const DROP_REFERENCE_VALUE = '__drop_reference__'

/** Sentinel for "mint a fresh public URL" — sent as `adoptPath: null`. */
const NEW_TRIGGER_URL_VALUE = '__new_trigger_url__'

/**
 * Fixed control width so every row's picker lines up as one column. Wide enough to hold a
 * full-length secret key, the longest label these pickers show, since clipping one is what makes
 * two same-prefixed keys indistinguishable.
 */
const RESOLVE_CONTROL_CLASS = 'w-[320px] flex-shrink-0'

/** Badge copy and colour per resolve status. */
const RESOLVE_BADGE: Record<
  ForkResolveStatus,
  { label: string; variant: 'red' | 'amber' | 'green' | 'gray-secondary' }
> = {
  blocking: { label: 'Blocking', variant: 'red' },
  'needs-setup': { label: 'Needs setup', variant: 'amber' },
  'will-clear': { label: 'Will clear', variant: 'amber' },
  dropped: { label: 'Dropped', variant: 'gray-secondary' },
  copied: { label: 'Copy', variant: 'green' },
  mapped: { label: 'Mapped', variant: 'green' },
}

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
 * Bucket an entry's dependents per workflow, then per block within it — the workflow → block
 * hierarchy the workflow cards render from.
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
 * One depends-on field's selector. Under a MAPPED parent it browses the TARGET parent (pre-filled
 * from the stored value, blank after a parent change) and stays disabled until the parent target
 * is set. Under a COPY-resolved parent it browses the SOURCE parent — the copy will contain
 * exactly those children — pre-filled with the source reference. Either way it waits for every
 * chained in-block parent, and a re-pick invalidates chained children.
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
  const ready = field.consumesContextKeys.every(
    (key) => !providedContextKeys.has(key) || providedValues[key] !== undefined
  )
  // A copy-resolved parent has no target id until the sync runs — scope to the SOURCE parent
  // instead, whose children are what the copy brings, keeping the selector fully editable.
  const parentValue = copying ? field.parentSourceId : target
  return (
    <DependentFieldSelector
      selectorKey={field.selectorKey as SelectorKey}
      context={{
        ...field.context,
        ...providedValues,
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
  copying: boolean
  workspaceId: string
  sourceWorkspaceId: string
  reconfig: Record<string, string>
  setReconfig: Dispatch<SetStateAction<Record<string, string>>>
}

/**
 * One workflow's dependent fields as a collapsible card, grouping fields under block, then the
 * optional nested tool, then the plain field label. Cards holding a required field start expanded,
 * since a required field is what gates Sync.
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

          const renderField = (field: ForkDependentReconfig) => (
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
          )

          return (
            <div key={block.targetBlockId} className='flex flex-col gap-2'>
              <Label className='text-small'>{block.blockName}</Label>
              {topLevel.map(renderField)}
              {toolGroups.map(([toolName, fields]) => (
                <div key={toolName} className='flex flex-col gap-1.5 pl-2'>
                  <span className='text-[var(--text-muted)] text-small'>{toolName}</span>
                  {fields.map(renderField)}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </CollapsibleCard>
  )
}

interface ResolveTargetPickerProps {
  controller: ForkSyncController
  item: ForkResolveItem
  entry: ForkMappingEntry
}

/**
 * The one control that resolves a reference: map it to something in the target, copy it across, or
 * — where the source resource is already gone — accept losing it.
 *
 * These are alternatives to each other, so they belong in one list rather than in a picker beside a
 * button beside a checkbox, which is how the same three choices used to be spread across three
 * sections of this page.
 */
function ResolveTargetPicker({ controller, item, entry }: ResolveTargetPickerProps) {
  const key = forkRefKey(entry)
  const target = controller.targetFor(entry)
  const copying = controller.copyingKeys.has(key)
  const copyable = controller.copyableKeys.has(key)
  const takenOwners = controller.takenOwnersFor(entry)

  if (item.status === 'dropped') {
    return (
      <Chip
        variant='border'
        onClick={() => controller.toggleDroppedRef(entry.kind, entry.sourceId, false)}
      >
        Undo drop
      </Chip>
    )
  }

  return (
    <ChipCombobox
      className='w-full'
      align='start'
      options={[
        // While copy-resolved the closed control shows the copy by NAME (a copy keeps the source's
        // name) through a hidden display-only option; the open list stays unambiguous.
        ...(copyable && copying
          ? [{ label: entry.sourceLabel, value: NEW_COPY_VALUE, hidden: true }]
          : []),
        ...(copyable && !copying
          ? [
              {
                label: 'Copy into the target',
                value: NEW_COPY_VALUE,
                onSelect: () => {
                  controller.setTarget(entry, '')
                  controller.toggleCopyKeys([key], true)
                },
              },
            ]
          : []),
        ...entry.candidates.map((candidate) => {
          const owner = takenOwners.get(candidate.id)
          return {
            label: owner ? `${candidate.label} — already mapped from ${owner}` : candidate.label,
            value: candidate.id,
            disabled: owner !== undefined,
          }
        }),
        ...(item.dropFieldCount !== null
          ? [
              {
                label:
                  item.dropFieldCount > 1
                    ? `Drop from all ${item.dropFieldCount} fields`
                    : 'Drop this reference',
                value: DROP_REFERENCE_VALUE,
                onSelect: () => controller.toggleDroppedRef(entry.kind, entry.sourceId, true),
              },
            ]
          : []),
      ]}
      value={copying ? NEW_COPY_VALUE : target || undefined}
      onChange={(value) => controller.setTarget(entry, value)}
      placeholder='Choose a target'
      searchable
      searchPlaceholder='Search targets'
      emptyMessage='Nothing to map to in the target workspace'
    />
  )
}

interface ResolveRowProps {
  controller: ForkSyncController
  item: ForkResolveItem
}

/**
 * One reference, as one row: where it stands, what breaks if it stays there, and the control that
 * fixes it. Rows whose resource feeds configurable fields expand into those fields, so a mapping
 * and the re-picks it forces are one place rather than two.
 */
function ResolveRow({ controller, item }: ResolveRowProps) {
  const [expanded, setExpanded] = useState(false)
  const { entry } = item
  const badge = RESOLVE_BADGE[item.status]

  const usages = entry ? controller.usagesForEntry(entry) : []
  const dependents = entry ? controller.dependentsForEntry(entry) : []
  // Both keep stable references from the controller's memoized maps, so this skips recompute
  // across the page's frequent re-renders.
  const workflows = useMemo(
    () => groupDependentsByWorkflow(usages, dependents),
    [usages, dependents]
  )
  const configurable = workflows.filter((workflow) => workflow.blocks.length > 0)
  const usedOnly = workflows.filter((workflow) => workflow.blocks.length === 0)
  const expandable = workflows.length > 0

  return (
    <div className='flex flex-col gap-2 py-2.5'>
      <div className='flex items-center justify-between gap-4'>
        <div className='flex min-w-0 flex-col gap-0.5'>
          <div className='flex min-w-0 items-center gap-2'>
            <Badge variant={badge.variant} size='sm' dot>
              {badge.label}
            </Badge>
            <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>{item.label}</span>
            <span className='flex-shrink-0 text-[var(--text-subtle)] text-caption'>
              {forkKindLabel(item.kind)}
            </span>
          </div>
          {item.detail ? (
            <p className='text-[var(--text-muted)] text-caption'>{item.detail}</p>
          ) : null}
          {expandable ? (
            <button
              type='button'
              onClick={() => setExpanded((value) => !value)}
              className='self-start text-[var(--text-muted)] text-caption underline-offset-2 transition-colors hover-hover:text-[var(--text-body)] hover-hover:underline'
            >
              {expanded
                ? 'Hide where it is used'
                : workflows.length === 1
                  ? 'Used in 1 workflow'
                  : `Used in ${workflows.length} workflows`}
            </button>
          ) : null}
        </div>
        <div className={RESOLVE_CONTROL_CLASS}>
          {entry ? (
            <ResolveTargetPicker controller={controller} item={item} entry={entry} />
          ) : (
            <p className='text-right text-[var(--text-muted)] text-small'>Fix in the source</p>
          )}
        </div>
      </div>

      {expanded && entry ? (
        <div className='flex flex-col gap-2 pl-1'>
          {configurable.map((workflow) => (
            <DependentWorkflowCard
              key={workflow.workflowId}
              workflow={workflow}
              target={controller.targetFor(entry)}
              parentChanged={controller.parentChangedFor(entry)}
              copying={controller.copyingKeys.has(forkRefKey(entry))}
              workspaceId={controller.targetWorkspaceId}
              sourceWorkspaceId={controller.sourceWorkspaceId}
              reconfig={controller.reconfig}
              setReconfig={controller.setReconfig}
            />
          ))}
          {usedOnly.length > 0 ? (
            <p className='text-[var(--text-tertiary)] text-caption'>
              Also used in {usedOnly.map((workflow) => workflow.workflowName).join(', ')}, where
              there is nothing to configure.
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}

interface CopyKindSectionsProps {
  controller: ForkSyncController
  byKind: ReadonlyMap<ForkCopyableUnmapped['kind'], ForkCopyableUnmapped[]>
}

/** One expandable picker per copyable kind, drawn exactly like the fork modal's. */
function CopyKindSections({ controller, byKind }: CopyKindSectionsProps) {
  return (
    <>
      {COPYABLE_KIND_SECTIONS.map((section) => {
        const candidates = byKind.get(section.kind)
        if (!candidates || candidates.length === 0) return null
        // The picker rows track item ids; copy selection is keyed `${kind}:${id}` (matching
        // `forkRefKey`), so derive the per-kind selected subset and re-prefix on toggle.
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
            onToggleAll={(selectAll) =>
              toggleMany(
                candidates.map((candidate) => candidate.sourceId),
                selectAll
              )
            }
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

interface TriggerMappingRowProps {
  controller: ForkSyncController
  mapping: ForkTriggerMapping
}

/**
 * One arriving trigger's URL decision: take over a URL retiring in the same target workflow, or
 * mint a new one. Keyed and labelled by BLOCK NAME rather than by raw path — it is one block to one
 * webhook URL, and the name is what the user recognises. Adopting keeps the external caller working
 * with no re-registration at all.
 */
function TriggerMappingRow({ controller, mapping }: TriggerMappingRowProps) {
  // A trigger that already serves a URL keeps it, so the row states the URL and offers no control.
  // Only a trigger the sync would give a NEW URL has something to decide.
  const decidable = mapping.ownPath === null && mapping.adoptablePaths.length > 0
  const pathOwners = controller.triggerPathOwnersFor(mapping.sourceBlockId)
  // The RESOLVED choice, not the raw pick: a path another row claimed first is awarded once, so
  // showing the raw pick would promise a URL this row is not going to get.
  const chosen = controller.triggerChoiceFor(mapping.sourceBlockId)
  const resultingPath = mapping.ownPath ?? (chosen === '' ? null : chosen)

  return (
    <div className='flex flex-col gap-1 py-1'>
      <div className='flex items-center justify-between gap-4'>
        {/* One inner span, so the name and its "in <workflow>" suffix share a normal inline flow:
            `Label` is inline-flex, and a flex container DISCARDS whitespace-only children, which
            eats the separating space (and leaves `truncate` with no text run to clip). */}
        <Label className='min-w-0'>
          <span className='min-w-0 truncate'>
            {mapping.blockName}{' '}
            <span className='text-[var(--text-muted)]'>in {mapping.workflowName}</span>
          </span>
        </Label>
        <div className={RESOLVE_CONTROL_CLASS}>
          {decidable ? (
            <ChipCombobox
              className='w-full'
              align='start'
              options={[
                // The full URL sits under the row and follows the selection, so an option only has
                // to name the CHOICE. Several retiring URLs is the one case needing a
                // disambiguator, and the path tail is what tells them apart.
                //
                // A URL another trigger already took is disabled and says who took it: two blocks
                // cannot serve one path, and the resolver awards it to the first slot — so allowing
                // the pick would leave this row reading "Keeps this URL" while the sync silently
                // minted it a new one.
                ...mapping.adoptablePaths.map((path) => {
                  const owner = pathOwners.get(path)
                  const base =
                    mapping.adoptablePaths.length === 1
                      ? 'Keep existing URL'
                      : `Keep …${path.slice(-12)}`
                  return {
                    label: owner ? `${base} — taken by ${owner}` : base,
                    value: path,
                    disabled: owner !== undefined,
                  }
                }),
                { label: 'Generate new URL', value: NEW_TRIGGER_URL_VALUE },
              ]}
              value={chosen === '' ? NEW_TRIGGER_URL_VALUE : chosen}
              onChange={(value) =>
                controller.setTriggerAdoption(
                  mapping.sourceBlockId,
                  value === NEW_TRIGGER_URL_VALUE ? '' : value
                )
              }
              placeholder='Generate new URL'
            />
          ) : (
            <p className='text-right text-[var(--text-muted)] text-small'>Unchanged</p>
          )}
        </div>
      </div>
      <p className='min-w-0 truncate text-[var(--text-muted)] text-small'>
        {resultingPath ? (
          <span className='font-mono text-caption'>{buildWebhookTriggerUrl(resultingPath)}</span>
        ) : (
          'Gets a new URL on sync. Register it with the calling service afterwards.'
        )}
      </p>
    </div>
  )
}

/** The Resolve section's progress bar: resolved, still-to-configure, and blocking, in one line. */
function ResolveMeter({ controller }: { controller: ForkSyncController }) {
  const { total, resolved, blocking, needsSetup } = controller.resolveProgress
  if (total === 0) return null
  const share = (count: number) => `${(count / total) * 100}%`
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex items-baseline justify-between gap-4'>
        <span className='text-[var(--text-body)] text-small'>
          {resolved} of {total} resolved
        </span>
        {blocking > 0 ? (
          <span className='text-[var(--text-muted)] text-caption'>
            {blocking === 1
              ? '1 reference is blocking sync'
              : `${blocking} references are blocking sync`}
          </span>
        ) : needsSetup > 0 ? (
          <span className='text-[var(--text-muted)] text-caption'>
            {needsSetup === 1 ? '1 resource needs setup' : `${needsSetup} resources need setup`}
          </span>
        ) : (
          <span className='text-[var(--text-muted)] text-caption'>Everything resolved</span>
        )}
      </div>
      <div className='flex h-1 overflow-hidden rounded-full bg-[var(--surface-5)]'>
        <span
          className='block h-full bg-[var(--badge-success-text)]'
          style={{ width: share(resolved) }}
        />
        <span
          className='block h-full bg-[var(--badge-amber-text)]'
          style={{ width: share(needsSetup) }}
        />
        <span className='block h-full bg-[var(--text-error)]' style={{ width: share(blocking) }} />
      </div>
    </div>
  )
}

interface ForkSyncViewProps {
  controller: ForkSyncController
  onDirectionChange: (direction: ForkDirection) => void
}

/**
 * One fork edge's sync, as three questions in order: what changes, what still has to be resolved
 * before it can, and which public URLs it decides.
 *
 * The page used to answer the middle question in four separate sections — a mapping editor, a copy
 * picker, a blocker list and a will-clear list — so one resource could appear in three of them and
 * the user had to reconcile them by eye. Here every reference is one row in one list, ordered by
 * how much it still needs.
 */
export function ForkSyncView({ controller, onDirectionChange }: ForkSyncViewProps) {
  const detailsError = controller.errorMessage ?? controller.diffErrorMessage
  const headsUp =
    controller.mcpReauthCount > 0 ||
    controller.inlineSecretCount > 0 ||
    controller.triggerUrlChanges.length > 0

  // Excluded workflows render greyed in the change list. Orient each name's tooltip to WHERE it is
  // excluded, since that is the only place it can be re-included: the sync's source is this
  // workspace on push and the other workspace on pull.
  const excludedRows = [
    ...(controller.direction === 'push'
      ? controller.excludedSourceWorkflows
      : controller.excludedTargetWorkflows
    ).map((name) => ({ name, tooltip: 'Excluded from sync' })),
    ...(controller.direction === 'push'
      ? controller.excludedTargetWorkflows
      : controller.excludedSourceWorkflows
    ).map((name) => ({
      name,
      tooltip: `Excluded from sync in "${controller.otherWorkspaceName}"`,
    })),
  ]

  return (
    <div className='flex flex-col gap-7'>
      <SettingsSection label='Direction'>
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
              ? `Overwrites "${controller.otherWorkspaceName}" with this workspace's deployed workflows.`
              : `Overwrites this workspace with the deployed workflows in "${controller.otherWorkspaceName}".`}
          </p>
        </div>
      </SettingsSection>

      {/* Surface a failed or pending fetch, so the page never renders blank below the direction. */}
      {detailsError ? (
        <SettingsSection label='Changes'>
          <div className='text-[var(--text-error)] text-small'>{detailsError}</div>
        </SettingsSection>
      ) : !controller.hasDiff ? (
        <div className='text-[var(--text-muted)] text-small'>Loading sync details…</div>
      ) : null}

      {/* Always shown once the diff loads, so the section is visible even with nothing deployed —
          an empty change list means the source has no deployed workflows (every deployed workflow
          appears here, changed or not), which the muted state turns into a nudge to deploy. */}
      {controller.hasDiff ? (
        <SettingsSection label='Changes'>
          {controller.workflowChanges.length + excludedRows.length > 0 ? (
            <Tooltip.Provider delayDuration={150}>
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
                {excludedRows.map(({ name, tooltip }, index) => (
                  <div key={`excluded:${name}:${index}`} className='flex min-w-0 items-center'>
                    <Tooltip.Root>
                      <Tooltip.Trigger asChild>
                        <span className='min-w-0 max-w-full truncate text-[var(--text-muted)] text-sm'>
                          {name}
                        </span>
                      </Tooltip.Trigger>
                      <Tooltip.Content side='top' className='text-small'>
                        {tooltip}
                      </Tooltip.Content>
                    </Tooltip.Root>
                  </div>
                ))}
              </div>
            </Tooltip.Provider>
          ) : (
            <div className='text-[var(--text-muted)] text-small'>
              {controller.direction === 'push'
                ? `No deployed workflows. Deploy one to push changes to ${controller.otherWorkspaceName}.`
                : `No deployed workflows in ${controller.otherWorkspaceName} to pull.`}
            </div>
          )}
        </SettingsSection>
      ) : null}

      {headsUp ? (
        <SettingsSection label='Before you sync'>
          <div className='flex flex-col gap-1.5'>
            {controller.mcpReauthCount > 0 ? (
              <p className='text-[var(--text-muted)] text-small'>
                {controller.mcpReauthCount === 1
                  ? 'One MCP server uses OAuth and has to be re-authorized in the target workspace.'
                  : `${controller.mcpReauthCount} MCP servers use OAuth and have to be re-authorized in the target workspace.`}
              </p>
            ) : null}
            {controller.inlineSecretCount > 0 ? (
              <p className='text-[var(--text-muted)] text-small'>
                {controller.inlineSecretCount === 1
                  ? "One inline secret can't be mapped automatically. Set it in the target workspace."
                  : `${controller.inlineSecretCount} inline secrets can't be mapped automatically. Set them in the target workspace.`}
              </p>
            ) : null}
            {controller.triggerUrlChanges.map((change) => (
              <p
                key={`${change.workflowName}:${change.path}`}
                className='min-w-0 text-[var(--text-muted)] text-small'
              >
                <span className='text-[var(--text-body)]'>
                  A webhook URL in {change.workflowName}
                </span>{' '}
                stops being served, so anything calling it will stop working.
                <span className='block truncate font-mono text-caption'>
                  {buildWebhookTriggerUrl(change.path)}
                </span>
              </p>
            ))}
          </div>
        </SettingsSection>
      ) : null}

      {controller.hasMapping ? (
        <SettingsSection
          label='Resolve'
          action={
            controller.droppableBlockerCount > 1 ? (
              <Chip onClick={controller.dropAllDeletedRefs}>Drop all deleted</Chip>
            ) : undefined
          }
        >
          {controller.resolveItems.length > 0 ? (
            <div className='flex flex-col gap-3'>
              <ResolveMeter controller={controller} />
              <div className='flex flex-col divide-y divide-[var(--border)]'>
                {controller.resolveItems.map((item) => (
                  <ResolveRow key={item.key} controller={controller} item={item} />
                ))}
              </div>
            </div>
          ) : (
            <SettingsEmptyState variant='inline'>
              These deployed workflows reference nothing that needs mapping.
            </SettingsEmptyState>
          )}
        </SettingsSection>
      ) : null}

      {controller.triggerMappings.length > 0 ? (
        <SettingsSection label={`Trigger URLs in ${controller.targetWorkspaceName}`}>
          <div className='flex flex-col divide-y divide-[var(--border)]'>
            {controller.triggerMappings.map((mapping) => (
              <TriggerMappingRow
                key={mapping.sourceBlockId}
                controller={controller}
                mapping={mapping}
              />
            ))}
          </div>
        </SettingsSection>
      ) : null}

      {controller.hasUnreferencedCopyables ? (
        <SettingsSection label='Extra resources'>
          <div className='flex flex-col gap-2'>
            <p className='text-[var(--text-muted)] text-caption'>
              No synced workflow uses these, so they are only copied if you ask for them.
            </p>
            <CopyKindSections controller={controller} byKind={controller.unreferencedByKind} />
          </div>
        </SettingsSection>
      ) : null}

      {controller.dependentClears.length > 0 ? (
        <SettingsSection label='Will be cleared'>
          <div className='flex flex-col gap-1'>
            {controller.dependentClears.map((ref, index) => (
              <p
                key={`${ref.targetWorkflowId}:${ref.blockId}:${ref.kind}:${ref.sourceId}:${ref.fieldLabel}:${index}`}
                className='min-w-0 text-[var(--text-secondary)] text-small'
              >
                <span className='text-[var(--text-body)]'>{ref.blockLabel}</span> will lose{' '}
                <span className='text-[var(--text-body)]'>{ref.fieldLabel}</span> in{' '}
                {ref.workflowName}
              </p>
            ))}
          </div>
          <p className='text-[var(--text-muted)] text-caption'>
            Re-pick these in the target workspace after the sync.
          </p>
        </SettingsSection>
      ) : null}
    </div>
  )
}
