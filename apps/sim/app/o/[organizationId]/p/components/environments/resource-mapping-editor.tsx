'use client'

import { useCallback } from 'react'
import { EnvironmentSecretPeek } from '@/app/o/[organizationId]/p/components/environments/environment-secret-peek'
import { MappingEntry } from '@/ee/workspace-forking/components/fork-sync/fork-sync-view'
import type {
  ForkSyncController,
  MappableMappingKind,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'

interface ResourceMappingEditorProps {
  controller: ForkSyncController
  kind: MappableMappingKind
  focusSourceId?: string
  sourceName: string
  targetName: string
}

/** The selected pair's canonical mapping editor, including dependent field configuration. */
export function ResourceMappingEditor({
  controller,
  kind,
  sourceName,
  focusSourceId,
  targetName,
}: ResourceMappingEditorProps) {
  const focusMapping = useCallback((element: HTMLDivElement | null) => {
    if (!element) return
    element.scrollIntoView({ block: 'nearest' })
    element.focus({ preventScroll: true })
  }, [])
  const group = controller.groups.find((candidate) => candidate.kind === kind)
  if (controller.isError || controller.diffErrorMessage) {
    return (
      <p role='alert' className='text-[var(--text-error)] text-small'>
        {controller.errorMessage ?? controller.diffErrorMessage}
      </p>
    )
  }
  if (
    controller.isLoading ||
    controller.diffIsStale ||
    !controller.hasDiff ||
    !controller.hasMapping
  ) {
    return <p className='text-[var(--text-muted)] text-small'>Loading mappings…</p>
  }
  return (
    <div className='overflow-hidden rounded-lg border border-[var(--border)]'>
      <div className='flex items-center justify-between gap-4 border-[var(--border)] border-b px-4 py-3 text-[var(--text-muted)] text-small'>
        <span>{sourceName}</span>
        <span>{targetName}</span>
      </div>
      {group?.items.length ? (
        group.items.map((entry) => (
          <div
            key={`${entry.resourceType}:${entry.sourceId}`}
            tabIndex={-1}
            aria-label={`Mapping for ${entry.sourceLabel}`}
            ref={entry.sourceId === focusSourceId ? focusMapping : undefined}
            className='border-[var(--border)] border-b p-4 last:border-b-0'
          >
            <MappingEntry controller={controller} group={group} entry={entry} />
            {kind === 'env-var' && (
              <div className='mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2'>
                <EnvironmentSecretPeek
                  key={`${controller.sourceWorkspaceId}:${entry.sourceId}`}
                  workspaceId={controller.sourceWorkspaceId}
                  environmentName={sourceName}
                  secretKey={entry.sourceId}
                />
                <EnvironmentSecretPeek
                  key={`${controller.targetWorkspaceId}:${controller.targetFor(entry) || entry.sourceId}`}
                  workspaceId={controller.targetWorkspaceId}
                  environmentName={targetName}
                  secretKey={controller.targetFor(entry) || entry.sourceId}
                />
              </div>
            )}
          </div>
        ))
      ) : (
        <p className='px-4 py-6 text-[var(--text-muted)] text-small'>
          No mappings for this resource type in the selected sync.
        </p>
      )}
    </div>
  )
}
