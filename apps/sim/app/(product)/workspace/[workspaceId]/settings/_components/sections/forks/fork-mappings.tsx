'use client'

import { type Dispatch, type SetStateAction, useMemo, useState } from 'react'
import { Button } from '@sim/emcn/button'
import { Disclosure } from '@sim/emcn/disclosure'
import { SearchableSelect } from '@sim/emcn/picker/searchable-select'
import { StatusTag } from '@sim/emcn/status'
import { Muted } from '@/app/(product)/_components/settings-parts/settings-parts'
import {
  type DependentBlock,
  DependentField,
} from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/fork-dependent-field'
import styles from '@/app/(product)/workspace/[workspaceId]/settings/_components/sections/forks/forks.module.css'
import {
  type DependentConfigurationState,
  type DependentReconfigState,
  dependentKey,
  FORK_RESOURCE_KIND_LABEL,
  type ForkDependentReconfig,
  type ForkKindSummary,
  type ForkMappingEntry,
  type ForkMappingGroup,
  type ForkResourceUsage,
  type ForkSyncController,
  forkRefKey,
  getDisplayedDependentFields,
  isDependentConfigurationActionable,
} from '@/platform/lib/data/forks'

/** The target picker's "New copy" choice: shown while a copyable resource is copied, never sent. */
const NEW_COPY_VALUE = '__new_copy__'

interface WorkflowDependents {
  workflowId: string
  workflowName: string
  blocks: DependentBlock[]
}

/** An entry's dependents per workflow, then per block, as the workflow groups render them. */
function groupDependentsByWorkflow(
  workflows: ForkResourceUsage['workflows'],
  dependents: ForkDependentReconfig[],
  reconfig: DependentReconfigState,
  state: DependentConfigurationState,
  showConfigured: boolean
): WorkflowDependents[] {
  const byWorkflow = new Map<string, ForkDependentReconfig[]>()
  for (const dependent of dependents) {
    byWorkflow.set(dependent.targetWorkflowId, [
      ...(byWorkflow.get(dependent.targetWorkflowId) ?? []),
      dependent,
    ])
  }
  return workflows.map((workflow) => {
    const byBlock = new Map<string, DependentBlock>()
    for (const field of byWorkflow.get(workflow.workflowId) ?? []) {
      const block = byBlock.get(field.targetBlockId) ?? {
        targetBlockId: field.targetBlockId,
        blockName: field.blockName,
        fields: [],
        configurableFields: [],
      }
      block.fields.push(field)
      byBlock.set(field.targetBlockId, block)
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

interface FieldContext {
  target: string
  parentChanged: boolean
  copying: boolean
  workspaceId: string
  sourceWorkspaceId: string
  reconfig: DependentReconfigState
  setReconfig: Dispatch<SetStateAction<DependentReconfigState>>
}

function LabeledDependentField({
  field,
  block,
  context,
}: {
  field: ForkDependentReconfig
  block: DependentBlock
  context: FieldContext
}) {
  return (
    <div className={styles.group}>
      <span className={styles.secondary} data-type='T060'>
        {field.required ? `${field.title} *` : field.title}
      </span>
      <DependentField
        field={field}
        block={block}
        target={context.target}
        parentChanged={context.parentChanged}
        copying={context.copying}
        workspaceId={context.workspaceId}
        sourceWorkspaceId={context.sourceWorkspaceId}
        reconfig={context.reconfig}
        setReconfig={context.setReconfig}
      />
    </div>
  )
}

/**
 * One workflow's dependent fields under block, then tool, labels. A workflow holding a required
 * field opens, since that field gates Sync; so does one revealed by Edit configuration.
 */
function DependentWorkflow({
  workflow,
  initiallyExpanded,
  context,
}: {
  workflow: WorkflowDependents
  initiallyExpanded: boolean
  context: FieldContext
}) {
  const [open, setOpen] = useState(
    () =>
      initiallyExpanded ||
      workflow.blocks.some((block) => block.configurableFields.some((field) => field.required))
  )
  return (
    <Disclosure label={workflow.workflowName} open={open} onOpenChange={setOpen}>
      <div className={styles.fields}>
        {workflow.blocks.map((block) => {
          const topLevel = block.configurableFields.filter((field) => !field.toolName)
          const byTool = new Map<string, { name: string; fields: ForkDependentReconfig[] }>()
          for (const field of block.configurableFields) {
            if (!field.toolName) continue
            const scope = field.dependencyScope ?? field.toolName
            const group = byTool.get(scope) ?? { name: field.toolName, fields: [] }
            group.fields.push(field)
            byTool.set(scope, group)
          }
          const toolGroups = Array.from(byTool.entries()).sort(([, a], [, b]) =>
            a.name.localeCompare(b.name)
          )
          return (
            <div key={block.targetBlockId} className={styles.group}>
              <span data-type='T048'>{block.blockName}</span>
              {topLevel.map((field) => (
                <LabeledDependentField
                  key={dependentKey(field)}
                  field={field}
                  block={block}
                  context={context}
                />
              ))}
              {toolGroups.map(([scope, tool]) => (
                <div key={scope} className={styles.toolFields}>
                  <span className={styles.secondary} data-type='T060'>
                    {tool.name}
                  </span>
                  {tool.fields.map((field) => (
                    <LabeledDependentField
                      key={dependentKey(field)}
                      field={field}
                      block={block}
                      context={context}
                    />
                  ))}
                </div>
              ))}
            </div>
          )
        })}
      </div>
    </Disclosure>
  )
}

/**
 * One mapping entry: the source and its target picker (with "New copy" for a copy candidate, and
 * targets another source already claims disabled on push), then each workflow that uses it with the
 * fields that need configuring. Workflows with nothing to configure are named in a note.
 */
function MappingEntry({
  controller,
  group,
  entry,
}: {
  controller: ForkSyncController
  group: ForkMappingGroup
  entry: ForkMappingEntry
}) {
  const [showConfigured, setShowConfigured] = useState(false)
  const target = controller.targetFor(entry)
  const takenOwners = controller.takenOwnersFor(entry, group.items)
  const parentChanged = controller.parentChangedFor(entry)
  const refKey = forkRefKey(entry)
  const copyable = controller.copyableKeys.has(refKey)
  const copying = controller.copyingKeys.has(refKey)
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
  const hasHiddenConfigured = dependents.some(
    (field) =>
      !isDependentConfigurationActionable(field, controller.reconfig, {
        parentResolved,
        parentChanged,
        copying,
      })
  )
  const canEditConfigured =
    parentResolved && !parentChanged && !copying && (showConfigured || hasHiddenConfigured)
  const options = [
    ...(copyable && target !== '' ? [{ value: NEW_COPY_VALUE, label: 'New copy' }] : []),
    ...entry.candidates.map((candidate) => {
      const owner = takenOwners.get(candidate.id)
      return {
        value: candidate.id,
        label: owner ? `${candidate.label} · mapped to ${owner}` : candidate.label,
        disabled: owner !== undefined,
      }
    }),
  ]
  const context: FieldContext = {
    target,
    parentChanged,
    copying,
    workspaceId: controller.targetWorkspaceId,
    sourceWorkspaceId: controller.sourceWorkspaceId,
    reconfig: controller.reconfig,
    setReconfig: controller.setReconfig,
  }

  return (
    <div className={styles.entry}>
      <div className={styles.entryHeader}>
        <span className={styles.entryLabel} data-type='T043'>
          {entry.sourceLabel}
        </span>
        <div className={styles.entryControl}>
          <SearchableSelect
            label={`Target for ${entry.sourceLabel}`}
            labelHidden
            options={options}
            value={copying ? NEW_COPY_VALUE : target || null}
            selectedLabel={
              copying ? entry.sourceLabel : options.find((option) => option.value === target)?.label
            }
            onValueChange={(value) => {
              if (value === null) return
              controller.setTarget(entry, value === NEW_COPY_VALUE ? '' : value)
            }}
            placeholder='Select target'
            searchLabel='Search targets'
          />
        </div>
      </div>
      {entry.sourceDeleted && (
        <Muted>
          {`Deleted in the source — its name can't be shown. Map it to an existing ${FORK_RESOURCE_KIND_LABEL[entry.kind] ?? 'resource'} in ${controller.targetWorkspaceName}, or fix the reference in the source and redeploy.`}
        </Muted>
      )}
      {entry.candidatesTruncated && (
        <Muted>Too many targets to list them all — search covers only the ones shown.</Muted>
      )}
      {canEditConfigured && (
        <div className={styles.entryEnd}>
          <Button
            variant='quiet'
            size='compact'
            selected={showConfigured}
            onClick={() => setShowConfigured((value) => !value)}
          >
            {showConfigured ? 'Done editing' : 'Edit configuration'}
          </Button>
        </div>
      )}
      {configurable.map((workflow) => (
        <DependentWorkflow
          key={workflow.workflowId}
          workflow={workflow}
          initiallyExpanded={showConfigured}
          context={context}
        />
      ))}
      {usedOnly.length > 0 && (
        <Muted>
          {`Also used in ${usedOnly.map((workflow) => workflow.workflowName).join(', ')} — no changes required.`}
        </Muted>
      )}
    </div>
  )
}

/** One kind's mapping status, by the same rules as the legacy summary badges. */
function kindStatus(summary: ForkKindSummary) {
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
  const intent = complete
    ? ('success' as const)
    : requiredPending || reconfigPending
      ? ('warning' as const)
      : ('neutral' as const)
  return { label, intent }
}

/** One resource kind's mappings behind its status, expanded to the kind's entries. */
export function MappingKind({
  controller,
  group,
  summary,
}: {
  controller: ForkSyncController
  group: ForkMappingGroup
  summary: ForkKindSummary
}) {
  const status = kindStatus(summary)
  return (
    <Disclosure
      label={group.label}
      actions={<StatusTag label={status.label} intent={status.intent} />}
    >
      <div className={styles.entries}>
        {group.items.map((entry) => (
          <MappingEntry
            key={forkRefKey(entry)}
            controller={controller}
            group={group}
            entry={entry}
          />
        ))}
      </div>
    </Disclosure>
  )
}
