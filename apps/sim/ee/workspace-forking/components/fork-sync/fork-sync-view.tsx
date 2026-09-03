'use client'

import { type Dispatch, Fragment, type SetStateAction, useMemo, useState } from 'react'
import {
  Badge,
  ChevronDown,
  Chip,
  ChipCombobox,
  ChipInput,
  ChipSwitch,
  CollapsibleCard,
  cn,
  FieldDivider,
  Label,
  OverflowText,
  Tooltip,
} from '@sim/emcn'
import { ArrowRight } from '@sim/emcn/icons'
import type {
  ForkCopyableUnmapped,
  ForkDependentReconfig,
  ForkMappingEntry,
  ForkResourceUsage,
  ForkTriggerMapping,
} from '@/lib/api/contracts/workspace-fork'
import type { SelectorKey } from '@/lib/selectors/manifest'
import { SettingsEmptyState } from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import {
  FileKindRow,
  ResourceKindRow,
} from '@/ee/workspace-forking/components/fork-resource-picker/fork-resource-picker'
import {
  FORK_RESOURCE_KIND_LABEL,
  forkBlockerResolution,
} from '@/ee/workspace-forking/components/fork-sync/cleared-refs-list'
import { forkRefKey } from '@/ee/workspace-forking/components/fork-sync/copy-reconciliation'
import {
  CUSTOM_BLOCK_UNSUPPORTED_HINT,
  customBlockBooleanOptions,
  forkDependentControl,
} from '@/ee/workspace-forking/components/fork-sync/custom-block-input-control'
import { CustomBlockInputField } from '@/ee/workspace-forking/components/fork-sync/custom-block-input-field'
import { DependentFieldSelector } from '@/ee/workspace-forking/components/fork-sync/dependent-field-selector'
import {
  applyDependentRepick,
  type DependentConfigurationState,
  type DependentReconfigState,
  dependentKey,
  effectiveCopyDependentValue,
  effectiveDependentValue,
  getDisplayedDependentFields,
  isDependentConfigurationActionable,
} from '@/ee/workspace-forking/components/fork-sync/dependent-value'
import type {
  ForkKindSummary,
  ForkMappingGroup,
  ForkSyncController,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'
import type { ForkDirection } from '@/ee/workspace-forking/hooks/workspace-fork'
import { forkSyncBlockerReasonFor } from '@/ee/workspace-forking/lib/promote/sync-blockers'
import { buildWebhookTriggerUrl } from '@/triggers/webhook-url'

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

/**
 * Sentinel option value for "New URL" - the trigger mints a fresh public URL instead of taking
 * over a retiring one. Sent as `adoptPath: null`.
 */
const NEW_TRIGGER_URL_VALUE = '__new_trigger_url__'

/**
 * Fixed target-picker width so every mapping row's control lines up as one column (mirrors
 * General). Wide enough to hold a full-length secret key - these are the longest labels the
 * picker shows, and clipping them is what makes two same-prefixed keys indistinguishable.
 */
const MAPPING_TARGET_TRIGGER_CLASS = 'w-[380px] shrink-0'

interface DependentBlock {
  targetBlockId: string
  blockName: string
  fields: ForkDependentReconfig[]
  configurableFields: ForkDependentReconfig[]
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
  dependents: ForkDependentReconfig[],
  reconfig: DependentReconfigState,
  state: DependentConfigurationState,
  showConfigured: boolean
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
        block = {
          targetBlockId: field.targetBlockId,
          blockName: field.blockName,
          fields: [],
          configurableFields: [],
        }
        byBlock.set(field.targetBlockId, block)
      }
      block.fields.push(field)
    }
    return {
      workflowId: workflow.workflowId,
      workflowName: workflow.workflowName,
      blocks: Array.from(byBlock.values())
        .map((block) => ({
          ...block,
          configurableFields: getDisplayedDependentFields(
            block.fields,
            reconfig,
            state,
            showConfigured
          ),
        }))
        .filter((block) => block.configurableFields.length > 0)
        .sort((a, b) => a.blockName.localeCompare(b.blockName)),
    }
  })
}

/** Chain state for one block: the SelectorContext values its parent fields provide. */
function blockChainState(
  block: DependentBlock,
  activeField: ForkDependentReconfig,
  effectiveValue: (field: ForkDependentReconfig) => string
) {
  const providedValues: Record<string, string> = {}
  const providedContextKeys = new Set<string>()
  for (const field of block.fields) {
    if (field.dependencyScope !== activeField.dependencyScope) continue
    if (field.providesContextKey) {
      providedContextKeys.add(field.providesContextKey)
      const value = effectiveValue(field)
      if (value) providedValues[field.providesContextKey] = value
    }
  }
  return { providedValues, providedContextKeys }
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
  reconfig: DependentReconfigState
  setReconfig: Dispatch<SetStateAction<DependentReconfigState>>
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
  // `effectiveDependentValue` owns the custom-block carve-out, so the value shown here is the
  // same one the Sync gate and the submitted payload see.
  const isCustomBlockInput = field.parentKind === 'custom-block'
  const effectiveValueIn = (f: ForkDependentReconfig, state: DependentReconfigState) =>
    copying && !isCustomBlockInput
      ? effectiveCopyDependentValue(f, state)
      : effectiveDependentValue(f, state, parentChanged)
  const baselineValueFor = (f: ForkDependentReconfig) => effectiveValueIn(f, {})
  const effectiveValue = (f: ForkDependentReconfig) => effectiveValueIn(f, reconfig)
  // A dependent with no selector has no parent resource to browse and no options to fetch —
  // just a value to type. That is every custom-block input, and also a plain text field under
  // a remapped credential (a Jira issue type, a Notion block id), which the sync clears on
  // every push and so must be re-settable here.
  if (!field.selectorKey) {
    // Renders a BARE control, like `DependentFieldSelector` does — the row wrapper above
    // already draws the field's label and required marker, so a labelled `ChipModalField`
    // printed the title twice.
    const setValue = (value: string) =>
      setReconfig((current) => ({ ...current, [dependentKey(field)]: value }))
    const value = effectiveValue(field)
    switch (forkDependentControl(field)) {
      case 'switch':
        return (
          <ChipSwitch
            options={customBlockBooleanOptions(field.required)}
            // Passed through unmapped: an unset field is `''`, which matches neither segment,
            // so the switch renders with nothing selected. Coercing it to False would show a
            // required flag as configured while the Sync gate still reads it as empty.
            value={value}
            onChange={setValue}
            aria-label={field.title}
          />
        )
      case 'textarea':
        return (
          <CustomBlockInputField
            field={field}
            value={value}
            onChange={setValue}
            targetWorkspaceId={workspaceId}
            multiline
          />
        )
      case 'unsupported':
        return (
          <ChipInput
            className='w-full'
            value=''
            onChange={() => {}}
            disabled
            placeholder={CUSTOM_BLOCK_UNSUPPORTED_HINT}
            aria-label={field.title}
          />
        )
      default:
        return (
          <CustomBlockInputField
            field={field}
            value={value}
            onChange={setValue}
            targetWorkspaceId={workspaceId}
          />
        )
    }
  }

  const { providedValues, providedContextKeys } = blockChainState(block, field, effectiveValue)
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
      workspaceId={copying ? sourceWorkspaceId : workspaceId}
      context={{
        ...field.context,
        ...providedValues,
        ...(field.parentContextKey ? { [field.parentContextKey]: parentValue } : {}),
      }}
      enabled={parentValue !== '' && ready}
      value={effectiveValue(field)}
      onChange={(value) =>
        setReconfig((current) =>
          // The pre-pick value comes from the state being updated, so re-selecting the value
          // already shown is recognised as the no-op it is and leaves descendants intact.
          applyDependentRepick(current, field, block.fields, value, {
            previousValue: effectiveValueIn(field, current),
            baselineValueFor,
          })
        )
      }
      title={field.title}
    />
  )
}

interface DependentWorkflowCardProps {
  workflow: WorkflowDependents
  initiallyExpanded: boolean
  target: string
  parentChanged: boolean
  /** True when the parent is resolved by COPY - the selectors browse the SOURCE parent. */
  copying: boolean
  workspaceId: string
  sourceWorkspaceId: string
  reconfig: DependentReconfigState
  setReconfig: Dispatch<SetStateAction<DependentReconfigState>>
}

/**
 * One workflow's dependent fields as a collapsible card (the same `CollapsibleCard` the table
 * workflow sidebar's input mapping and the enrichment config use): the header names the
 * workflow; the body groups fields under block → optional tool → plain field label.
 * Cards holding a required field start expanded because that field gates Sync. Cards first
 * revealed by explicit edit mode also start expanded so the edit action exposes its controls.
 */
function DependentWorkflowCard({
  workflow,
  initiallyExpanded,
  target,
  parentChanged,
  copying,
  workspaceId,
  sourceWorkspaceId,
  reconfig,
  setReconfig,
}: DependentWorkflowCardProps) {
  const [collapsed, setCollapsed] = useState(
    () =>
      !initiallyExpanded &&
      !workflow.blocks.some((block) => block.configurableFields.some((field) => field.required))
  )
  return (
    <CollapsibleCard
      title={workflow.workflowName}
      collapsed={collapsed}
      onToggleCollapse={() => setCollapsed((value) => !value)}
    >
      <div className='flex flex-col gap-3'>
        {workflow.blocks.map((block) => {
          const topLevel = block.configurableFields.filter((field) => !field.toolName)
          const byTool = new Map<string, { name: string; fields: ForkDependentReconfig[] }>()
          for (const field of block.configurableFields) {
            if (!field.toolName) continue
            const scope = field.dependencyScope ?? field.toolName
            const group = byTool.get(scope)
            if (group) group.fields.push(field)
            else byTool.set(scope, { name: field.toolName, fields: [field] })
          }
          const toolGroups = Array.from(byTool.entries()).sort(([, a], [, b]) =>
            a.name.localeCompare(b.name)
          )

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
              {toolGroups.map(([scope, tool]) => (
                <div key={scope} className='flex flex-col gap-1.5 pl-2'>
                  <span className='text-[var(--text-muted)] text-small'>{tool.name}</span>
                  {tool.fields.map((field) => (
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
  const [showConfigured, setShowConfigured] = useState(false)
  const target = controller.targetFor(entry)
  const takenOwners = controller.takenOwnersFor(entry, group.items)
  const parentChanged = controller.parentChangedFor(entry)
  const entryRefKey = forkRefKey(entry)
  const copying = controller.copyingKeys.has(entryRefKey)

  const usages = controller.usagesForEntry(entry)
  const dependents = controller.dependentsForEntry(entry)
  const parentResolved = target !== '' || copying
  const workflows = useMemo(
    () =>
      groupDependentsByWorkflow(
        usages,
        dependents,
        controller.reconfig,
        { parentResolved, parentChanged, copying },
        showConfigured
      ),
    [
      usages,
      dependents,
      controller.reconfig,
      parentResolved,
      parentChanged,
      copying,
      showConfigured,
    ]
  )
  const configurable = workflows.filter((workflow) => workflow.blocks.length > 0)
  const usedOnly = workflows.filter((workflow) => workflow.blocks.length === 0)
  const configurationState = { parentResolved, parentChanged, copying }
  const hasHiddenConfigured = dependents.some(
    (field) => !isDependentConfigurationActionable(field, controller.reconfig, configurationState)
  )
  const canEditConfigured =
    parentResolved && !parentChanged && !copying && (showConfigured || hasHiddenConfigured)

  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-col gap-1'>
        <div className='flex items-center justify-between gap-4'>
          <Label className='min-w-0'>
            <OverflowText label={entry.sourceLabel} />
          </Label>
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
              searchable
              searchPlaceholder='Search targets'
            />
          </div>
        </div>
        {entry.sourceDeleted ? (
          <p className='text-[var(--text-muted)] text-small'>
            Deleted in the source — its name can't be shown. Map it to an existing{' '}
            {FORK_RESOURCE_KIND_LABEL[entry.kind] ?? 'resource'} in {controller.targetWorkspaceName}
            , or fix the reference in the source and redeploy.
          </p>
        ) : null}
        {entry.candidatesTruncated ? (
          <p className='text-[var(--text-muted)] text-small'>
            Too many targets to list them all — search covers only the ones shown.
          </p>
        ) : null}
      </div>
      {canEditConfigured ? (
        <div className='flex justify-end'>
          <Chip active={showConfigured} onClick={() => setShowConfigured((value) => !value)}>
            {showConfigured ? 'Done editing' : 'Edit configuration'}
          </Chip>
        </div>
      ) : null}
      {configurable.map((workflow) => (
        <DependentWorkflowCard
          key={workflow.workflowId}
          workflow={workflow}
          initiallyExpanded={showConfigured}
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
          Also used in {usedOnly.map((workflow) => workflow.workflowName).join(', ')} — no changes
          required.
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
        <OverflowText label={group.label} className='flex-1' />
        <Badge variant={badge.variant} size='sm' dot>
          {badge.label}
        </Badge>
        <ChevronDown
          className={cn(
            'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
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

interface TriggerMappingRowProps {
  controller: ForkSyncController
  mapping: ForkTriggerMapping
}

/**
 * One arriving trigger's URL decision: take over a URL that is retiring in the same target
 * workflow, or mint a new one.
 *
 * Keyed and labelled by BLOCK NAME rather than the raw path - it is one block to one webhook URL,
 * and the name is what the user recognises. Adopting keeps the external caller (a Slack Request
 * URL, a provider subscription) working with no re-registration at all.
 */
function TriggerMappingRow({ controller, mapping }: TriggerMappingRowProps) {
  // A trigger that already serves a URL keeps it, so the row states the URL and offers no
  // control. Only a trigger the sync would give a NEW URL has something to decide.
  const decidable = mapping.ownPath === null && mapping.adoptablePaths.length > 0
  const pathOwners = controller.triggerPathOwnersFor(mapping.sourceBlockId)
  // The RESOLVED choice, not the raw pick: a path another row claimed first is awarded once, so
  // displaying the raw pick would promise a URL this row is not going to get.
  const chosen = controller.triggerChoiceFor(mapping.sourceBlockId)
  const resultingPath = mapping.ownPath ?? (chosen === '' ? null : chosen)

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center justify-between gap-4'>
        <Label className='min-w-0'>
          <OverflowText label={`${mapping.blockName} in ${mapping.workflowName}`}>
            {mapping.blockName}{' '}
            <span className='text-[var(--text-muted)]'>in {mapping.workflowName}</span>
          </OverflowText>
        </Label>
        <div className={MAPPING_TARGET_TRIGGER_CLASS}>
          {decidable ? (
            <ChipCombobox
              className='w-full'
              align='start'
              options={[
                // The full URL lives under the row and follows the selection, so an option only
                // has to name the CHOICE. Several retiring URLs is the one case that needs a
                // disambiguator, and the path tail is what distinguishes them.
                //
                // A URL another trigger already took is disabled and says who took it: two blocks
                // cannot serve one path, and the resolver awards it to the first slot - so
                // allowing the pick would leave this row reading "Keeps this URL" while the sync
                // silently minted it a new one.
                ...mapping.adoptablePaths.map((path) => {
                  const owner = pathOwners.get(path)
                  const base =
                    mapping.adoptablePaths.length === 1
                      ? 'Keep existing URL'
                      : `Keep …${path.slice(-12)}`
                  return {
                    label: owner ? `${base} · taken by ${owner}` : base,
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
          'Gets a new URL on sync — register it with the calling service afterwards.'
        )}
      </p>
    </div>
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
  const headsUp =
    controller.mcpReauthCount > 0 ||
    controller.inlineSecretCount > 0 ||
    controller.triggerUrlChanges.length > 0

  // Excluded workflows render greyed in the change list. Orient each name's tooltip
  // to WHERE it is excluded (that's the only place it can be re-included): the sync's
  // source is this workspace on push and the other workspace on pull.
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
          deployed workflow appears here, changed or not), so the muted state nudges a deploy.
          Sync-excluded workflows list greyed at the end, with a tooltip naming where the
          exclusion lives - the sync will not touch them. */}
      {controller.hasDiff ? (
        <SettingsSection label='Deployed workflows'>
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
          {controller.triggerUrlChanges.map((change) => (
            <div
              key={`${change.workflowName}:${change.path}`}
              className='mt-1 min-w-0 text-[var(--text-muted)] text-small'
            >
              <span className='text-[var(--text-body)]'>
                A webhook URL in {change.workflowName}
              </span>{' '}
              stops being served — anything calling it will stop working.
              <span className='block truncate font-mono text-caption'>
                {buildWebhookTriggerUrl(change.path)}
              </span>
            </div>
          ))}
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

      {controller.triggerMappings.length > 0 ? (
        <SettingsSection label={`Trigger URLs in ${controller.targetWorkspaceName}`}>
          <div className='flex flex-col gap-2'>
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
        <SettingsSection
          label='Blocking sync'
          action={
            controller.droppableBlockerCount > 1 ? (
              <Chip onClick={controller.dropAllDeletedRefs}>Drop all deleted</Chip>
            ) : undefined
          }
        >
          <div className='flex flex-col gap-1'>
            {controller.blockingRefs.map((ref, index) => {
              const dropKey = `${ref.kind}:${ref.sourceId}`
              const uses = controller.blockingUsesByResource.get(dropKey) ?? 1
              return (
                <div
                  key={`${ref.targetWorkflowId}:${ref.blockId}:${ref.kind}:${ref.sourceId}:${ref.fieldLabel}:${index}`}
                  className='flex min-w-0 items-start justify-between gap-3 text-[var(--text-secondary)] text-small'
                >
                  <span className='min-w-0'>
                    <span className='text-[var(--text-body)]'>{ref.blockLabel}</span>
                    {/* A custom block blocks for the opposite reason to everything else here:
                        nothing is lost, the block keeps invoking the SOURCE environment. Saying
                        "would lose" would contradict its own resolution line. */}
                    {ref.kind === 'custom-block' ? (
                      <> in {ref.workflowName} </>
                    ) : (
                      <>
                        {' '}
                        would lose <span className='text-[var(--text-body)]'>{ref.fieldLabel}</span>{' '}
                        in {ref.workflowName} —{' '}
                      </>
                    )}
                    {forkBlockerResolution(ref, controller.targetWorkspaceName)}
                  </span>
                  {/* Only a source-deleted reference can be dropped: an unmapped copyable can still
                      be copied and a missing workflow can still be deployed, so neither is a dead
                      end the user should be able to accept away.

                      One control per RESOURCE, not per row: the resource is gone, so the sync
                      clears every field naming it (the remapper's clear resolves by reference, not
                      by field). Rendering a Drop on each row would imply a per-field choice the
                      write path cannot honour, so later rows for the same id state the scope
                      instead. */}
                  {forkSyncBlockerReasonFor(ref) !==
                  'source-deleted' ? null : controller.firstBlockingRowForResource.get(dropKey) ===
                    index ? (
                    <Chip onClick={() => controller.toggleDroppedRef(ref.kind, ref.sourceId, true)}>
                      {uses > 1 ? `Drop from ${uses} fields` : 'Drop'}
                    </Chip>
                  ) : (
                    <span className='shrink-0 text-[var(--text-muted)] text-caption'>
                      same reference
                    </span>
                  )}
                </div>
              )
            })}
          </div>
        </SettingsSection>
      ) : null}

      {controller.dependentClears.length > 0 ? (
        <SettingsSection label='Will be cleared'>
          <div className='flex flex-col gap-1'>
            {controller.dependentClears.map((ref, index) => {
              const droppedKey = `${ref.kind}:${ref.sourceId}`
              const dropped = controller.droppedRefs.has(droppedKey)
              return (
                <div
                  key={`${ref.targetWorkflowId}:${ref.blockId}:${ref.kind}:${ref.sourceId}:${ref.fieldLabel}:${index}`}
                  className='flex min-w-0 items-start justify-between gap-3 text-[var(--text-secondary)] text-small'
                >
                  <span className='min-w-0'>
                    <span className='text-[var(--text-body)]'>{ref.blockLabel}</span> will lose{' '}
                    <span className='text-[var(--text-body)]'>{ref.fieldLabel}</span> in{' '}
                    {ref.workflowName}
                    {dropped ? ' — dropped' : ''}
                  </span>
                  {dropped ? (
                    <Chip
                      onClick={() => controller.toggleDroppedRef(ref.kind, ref.sourceId, false)}
                    >
                      Undo
                    </Chip>
                  ) : null}
                </div>
              )
            })}
          </div>
          <p className='text-[var(--text-muted)] text-caption'>
            Re-pick these in the target after the sync.
          </p>
        </SettingsSection>
      ) : null}
    </div>
  )
}
