'use client'

import { Button } from '@sim/emcn/button'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { SegmentedControl } from '@sim/emcn/segmented-control'
import { SettingsRow, SettingsSection } from '@sim/emcn/settings-section'
import { FailureNotice, InlineNotice } from '@sim/emcn/status'
import { FieldStack, Muted } from '@/platform/app/(shell)/_components/settings-parts/settings-parts'
import { CheckboxTree } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/forks/fork-checkbox-tree'
import { MappingKind } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/forks/fork-mappings'
import styles from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/forks/forks.module.css'
import { copyKindNode } from '@/platform/app/(shell)/workspace/[workspaceId]/settings/_components/sections/forks/resource-nodes'
import {
  buildWebhookTriggerUrl,
  type ForkCopyableUnmapped,
  type ForkDirection,
  type ForkSyncController,
  type ForkTriggerMapping,
  forkBlockerResolution,
  forkSyncBlockerReasonFor,
} from '@/platform/lib/data/forks'

/** Copyable kinds in the fork picker's order and labels; files nest by folder. */
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

/** The trigger choice that mints a fresh URL; sent as `adoptPath: null`. */
const NEW_TRIGGER_URL_VALUE = '__new_trigger_url__'

function CopyKinds({
  controller,
  byKind,
}: {
  controller: ForkSyncController
  byKind: ReadonlyMap<ForkCopyableUnmapped['kind'], ForkCopyableUnmapped[]>
}) {
  return COPYABLE_KIND_SECTIONS.map((section) => {
    const candidates = byKind.get(section.kind)
    if (!candidates || candidates.length === 0) return null
    const node = copyKindNode(
      section.kind,
      section.label,
      candidates.map((candidate) => ({
        id: candidate.sourceId,
        label: candidate.label,
        folderId: candidate.parentId,
        folderName: candidate.parentLabel,
      })),
      section.kind === 'file'
    )
    return (
      <CheckboxTree
        key={section.kind}
        nodes={[node]}
        isSelected={(id) => controller.copySelected.has(`${section.kind}:${id}`)}
        onToggle={(ids, checked) =>
          controller.toggleCopyKeys(
            ids.map((id) => `${section.kind}:${id}`),
            checked
          )
        }
        groupActionLabel={(label) => `Copy all in ${label}`}
        disabled={controller.submitting || !controller.comparisonReady}
      />
    )
  })
}

/**
 * An arriving trigger's URL: take over one retiring in the same target workflow, keeping its
 * external caller working, or mint a new one. A trigger that already serves a URL keeps it.
 */
function TriggerMappingRow({
  controller,
  mapping,
}: {
  controller: ForkSyncController
  mapping: ForkTriggerMapping
}) {
  const decidable = mapping.ownPath === null && mapping.adoptablePaths.length > 0
  const pathOwners = controller.triggerPathOwnersFor(mapping.sourceBlockId)
  // The resolved choice: a path another row claimed first is not this row's to show.
  const chosen = controller.triggerChoiceFor(mapping.sourceBlockId)
  const resultingPath = mapping.ownPath ?? (chosen === '' ? null : chosen)
  const label = `${mapping.blockName} in ${mapping.workflowName}`
  return (
    <SettingsRow
      label={label}
      description={
        resultingPath
          ? buildWebhookTriggerUrl(resultingPath)
          : 'Gets a new URL on sync — register it with the calling service afterwards.'
      }
    >
      {decidable ? (
        <ChoiceMenu
          label={`URL for ${label}`}
          options={[
            ...mapping.adoptablePaths.map((path) => {
              const owner = pathOwners.get(path)
              const base =
                mapping.adoptablePaths.length === 1
                  ? 'Keep existing URL'
                  : `Keep …${path.slice(-12)}`
              return {
                value: path,
                label: owner ? `${base} · taken by ${owner}` : base,
                disabled: owner !== undefined,
              }
            }),
            { value: NEW_TRIGGER_URL_VALUE, label: 'Generate new URL' },
          ]}
          value={chosen === '' ? NEW_TRIGGER_URL_VALUE : chosen}
          onValueChange={(value) =>
            controller.setTriggerAdoption(
              mapping.sourceBlockId,
              value === NEW_TRIGGER_URL_VALUE ? '' : value
            )
          }
        />
      ) : (
        <Muted>Unchanged</Muted>
      )}
    </SettingsRow>
  )
}

interface ForkSyncViewProps {
  controller: ForkSyncController
  onDirectionChange: (direction: ForkDirection) => void
}

/**
 * The parent edge's sync as page sections: the direction, the deployed workflows it changes, each
 * resource kind's mappings behind its status, trigger URLs, what to copy, and any reference that
 * blocks the sync. The header's Sync commits it after the overwrite confirmation.
 */
export function ForkSyncView({ controller, onDirectionChange }: ForkSyncViewProps) {
  const detailsError = controller.errorMessage ?? controller.diffErrorMessage
  const headsUp =
    controller.mcpReauthCount > 0 ||
    controller.inlineSecretCount > 0 ||
    controller.triggerUrlChanges.length > 0
  // Unsynced workflows are named where they can be re-selected: this workspace's Synced workflows
  // on push for its own, the other workspace's for its.
  const pushing = controller.direction === 'push'
  const excludedRows = [
    ...(pushing ? controller.excludedSourceWorkflows : controller.excludedTargetWorkflows).map(
      (name) => ({ name, note: 'Not synced' })
    ),
    ...(pushing ? controller.excludedTargetWorkflows : controller.excludedSourceWorkflows).map(
      (name) => ({ name, note: `Not synced in "${controller.otherWorkspaceName}"` })
    ),
  ]
  const busy = controller.saving || controller.submitting

  return (
    <>
      <SettingsSection title='Sync direction'>
        <SettingsRow
          label='Direction'
          description={
            pushing
              ? `Push this workspace's deployed workflows to "${controller.otherWorkspaceName}", overwriting it.`
              : `Pull deployed workflows from "${controller.otherWorkspaceName}", overwriting this workspace.`
          }
        >
          <SegmentedControl
            label='Sync direction'
            value={controller.direction}
            holdOnReselect
            options={[
              { value: 'push', label: 'Push', disabled: busy },
              { value: 'pull', label: 'Pull', disabled: busy },
            ]}
            onSelect={onDirectionChange}
          />
        </SettingsRow>
      </SettingsSection>

      {detailsError && <FailureNotice message={detailsError} />}

      {controller.hasDiff && (
        <SettingsSection title='Deployed workflows'>
          {controller.workflowChanges.length + excludedRows.length > 0 ? (
            <>
              {controller.workflowChanges.map((change) => (
                <SettingsRow
                  key={
                    change.action === 'archive' ? change.targetWorkflowId : change.sourceWorkflowId
                  }
                  label={
                    change.currentName === change.otherName
                      ? change.currentName
                      : `${change.currentName} → ${change.otherName}`
                  }
                />
              ))}
              {excludedRows.map(({ name, note }, index) => (
                <SettingsRow key={`excluded:${name}:${index}`} label={name} description={note} />
              ))}
            </>
          ) : (
            <FieldStack>
              <Muted>
                {pushing
                  ? `No deployed workflows. Deploy workflows to push changes to ${controller.otherWorkspaceName}.`
                  : `No deployed workflows in ${controller.otherWorkspaceName} to pull.`}
              </Muted>
            </FieldStack>
          )}
        </SettingsSection>
      )}

      {headsUp && (
        <SettingsSection title='Heads up'>
          <FieldStack>
            {controller.mcpReauthCount > 0 && (
              <InlineNotice
                intent='warning'
                message={`${controller.mcpReauthCount} MCP server(s) use OAuth and must be re-authorized in the target workspace.`}
              />
            )}
            {controller.inlineSecretCount > 0 && (
              <InlineNotice
                intent='warning'
                message={`${controller.inlineSecretCount} inline secret(s) can't be auto-mapped — set them in the target workspace.`}
              />
            )}
            {controller.triggerUrlChanges.map((change) => (
              <InlineNotice
                key={`${change.workflowName}:${change.path}`}
                intent='warning'
                title={`A webhook URL in ${change.workflowName} stops being served — anything calling it will stop working.`}
                message={buildWebhookTriggerUrl(change.path)}
              />
            ))}
          </FieldStack>
        </SettingsSection>
      )}

      {controller.hasMapping && (
        <SettingsSection title='Mappings'>
          <FieldStack>
            {controller.groups.length > 0 ? (
              controller.groups.map((group) => {
                const summary = controller.kindSummaries.find((item) => item.kind === group.kind)
                if (!summary) return null
                return (
                  <MappingKind
                    key={group.kind}
                    controller={controller}
                    group={group}
                    summary={summary}
                  />
                )
              })
            ) : (
              <Muted>This workspace's deployed workflows have no mappable references.</Muted>
            )}
          </FieldStack>
        </SettingsSection>
      )}

      {controller.triggerMappings.length > 0 && (
        <SettingsSection title={`Trigger URLs in ${controller.targetWorkspaceName}`}>
          {controller.triggerMappings.map((mapping) => (
            <TriggerMappingRow
              key={mapping.sourceBlockId}
              controller={controller}
              mapping={mapping}
            />
          ))}
        </SettingsSection>
      )}

      {controller.hasVisibleCopyables && (
        <SettingsSection title='Copy resources'>
          <FieldStack>
            {controller.referencedByKind.size > 0 && (
              <div className={styles.group}>
                <CopyKinds controller={controller} byKind={controller.referencedByKind} />
              </div>
            )}
            {controller.unreferencedByKind.size > 0 && (
              <div className={styles.group}>
                {controller.referencedByKind.size > 0 && <Muted>Not used by any workflow</Muted>}
                <CopyKinds controller={controller} byKind={controller.unreferencedByKind} />
              </div>
            )}
          </FieldStack>
        </SettingsSection>
      )}

      {controller.blockingRefs.length > 0 && (
        <SettingsSection title='Blocking sync'>
          {controller.droppableBlockerCount > 1 && (
            <SettingsRow
              label='Deleted references'
              description='Accept losing every reference deleted in the source.'
            >
              <Button variant='secondary' size='compact' onClick={controller.dropAllDeletedRefs}>
                Drop all deleted
              </Button>
            </SettingsRow>
          )}
          {controller.blockingRefs.map((ref, index) => {
            const dropKey = `${ref.kind}:${ref.sourceId}`
            const uses = controller.blockingUsesByResource.get(dropKey) ?? 1
            const resolution = forkBlockerResolution(ref, controller.targetWorkspaceName)
            // A custom block loses nothing: it keeps invoking the SOURCE environment's block.
            const description =
              ref.kind === 'custom-block'
                ? `in ${ref.workflowName} ${resolution ?? ''}`
                : `would lose ${ref.fieldLabel} in ${ref.workflowName}${resolution ? ` — ${resolution}` : ''}`
            // One Drop per RESOURCE: the sync clears every field naming it, so later rows say so.
            const droppable = forkSyncBlockerReasonFor(ref) === 'source-deleted'
            const ownsDrop = controller.firstBlockingRowForResource.get(dropKey) === index
            return (
              <SettingsRow
                key={`${ref.targetWorkflowId}:${ref.blockId}:${ref.kind}:${ref.sourceId}:${ref.fieldLabel}:${index}`}
                label={ref.blockLabel}
                description={description}
              >
                {droppable &&
                  (ownsDrop ? (
                    <Button
                      variant='secondary'
                      size='compact'
                      onClick={() => controller.toggleDroppedRef(ref.kind, ref.sourceId, true)}
                    >
                      {uses > 1 ? `Drop from ${uses} fields` : 'Drop'}
                    </Button>
                  ) : (
                    <Muted>same reference</Muted>
                  ))}
              </SettingsRow>
            )
          })}
        </SettingsSection>
      )}

      {controller.dependentClears.length > 0 && (
        <SettingsSection title='Will be cleared'>
          {controller.dependentClears.map((ref, index) => {
            const dropped = controller.droppedRefs.has(`${ref.kind}:${ref.sourceId}`)
            return (
              <SettingsRow
                key={`${ref.targetWorkflowId}:${ref.blockId}:${ref.kind}:${ref.sourceId}:${ref.fieldLabel}:${index}`}
                label={ref.blockLabel}
                description={`will lose ${ref.fieldLabel} in ${ref.workflowName}${dropped ? ' — dropped' : ''}`}
              >
                {dropped && (
                  <Button
                    variant='quiet'
                    size='compact'
                    onClick={() => controller.toggleDroppedRef(ref.kind, ref.sourceId, false)}
                  >
                    Undo
                  </Button>
                )}
              </SettingsRow>
            )
          })}
          <FieldStack>
            <Muted>Re-pick these in the target after the sync.</Muted>
          </FieldStack>
        </SettingsSection>
      )}
    </>
  )
}
