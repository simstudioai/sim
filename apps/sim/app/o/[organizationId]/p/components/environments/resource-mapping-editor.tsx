'use client'

import { useState } from 'react'
import { cn, Skeleton } from '@sim/emcn'
import { EnvironmentSecretPeek } from '@/app/o/[organizationId]/p/components/environments/environment-secret-peek'
import {
  MAPPING_TARGET_TRIGGER_CLASS,
  MappingEntry,
} from '@/ee/workspace-forking/components/fork-sync/fork-sync-view'
import type {
  ForkSyncController,
  MappableMappingKind,
} from '@/ee/workspace-forking/components/fork-sync/use-fork-sync'

const TYPE_COLUMN_CLASS = 'w-[96px] shrink-0'
/** The canonical resource table's cell inset. */
const ROW_INSET_CLASS = 'px-3 md:px-6'

interface ResourceMappingEditorProps {
  controller: ForkSyncController
  /** Resource types to show; empty shows every type. */
  kinds: readonly MappableMappingKind[]
  /** Narrows the rows by resource name. */
  search: string
  /** Shows only resources that had no target when the table opened, so a pick never hides its row. */
  unmappedOnly: boolean
  sourceName: string
  targetName: string
}

/**
 * Every mapping between the selected pair as one table, filtered by resource type, including
 * dependent field configuration.
 */
export function ResourceMappingEditor({
  controller,
  kinds,
  search,
  unmappedOnly,
  sourceName,
  targetName,
}: ResourceMappingEditorProps) {
  const [unmappedAtOpen] = useState(
    () =>
      new Set(
        controller.groups.flatMap((group) =>
          group.items
            .filter((entry) => !controller.targetFor(entry))
            .map((entry) => `${entry.resourceType}:${entry.sourceId}`)
        )
      )
  )
  const query = search.trim().toLowerCase()
  const rows = controller.groups
    .filter((group) => kinds.length === 0 || kinds.includes(group.kind))
    .flatMap((group) => group.items.map((entry) => ({ group, entry })))
    .filter(({ entry }) => entry.sourceLabel.toLowerCase().includes(query))
    .filter(
      ({ entry }) => !unmappedOnly || unmappedAtOpen.has(`${entry.resourceType}:${entry.sourceId}`)
    )
  if (controller.isError || controller.diffErrorMessage) {
    return (
      <p role='alert' className={cn('py-6 text-[var(--text-error)] text-small', ROW_INSET_CLASS)}>
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
    return <Skeleton className='m-6 h-24' />
  }
  return (
    <div role='table' aria-label='Resource mappings' className='text-small'>
      <div
        role='row'
        className={cn(
          'flex h-10 items-center gap-4 border-[var(--border)] border-b text-[var(--text-muted)] max-md:h-11',
          ROW_INSET_CLASS
        )}
      >
        <span role='columnheader' className={TYPE_COLUMN_CLASS}>
          Type
        </span>
        <div className='flex min-w-0 flex-1 items-center justify-between gap-4'>
          <span role='columnheader' className='min-w-0 truncate'>
            {sourceName}
          </span>
          <span role='columnheader' className={MAPPING_TARGET_TRIGGER_CLASS}>
            {targetName}
          </span>
        </div>
      </div>
      {rows.length ? (
        rows.map(({ group, entry }) => (
          <div
            key={`${entry.resourceType}:${entry.sourceId}`}
            role='row'
            aria-label={`Mapping for ${entry.sourceLabel}`}
            className={cn('flex gap-4 border-[var(--border)] border-b py-2.5', ROW_INSET_CLASS)}
          >
            <span role='cell' className={cn(TYPE_COLUMN_CLASS, 'pt-1.5 text-[var(--text-body)]')}>
              {group.label}
            </span>
            <div role='cell' className='min-w-0 flex-1'>
              <MappingEntry controller={controller} group={group} entry={entry} />
              {group.kind === 'env-var' && (
                <div className='mt-2 flex items-start justify-between gap-4'>
                  <EnvironmentSecretPeek
                    key={`${controller.sourceWorkspaceId}:${entry.sourceId}`}
                    workspaceId={controller.sourceWorkspaceId}
                    environmentName={sourceName}
                    secretKey={entry.sourceId}
                    className='min-w-0 flex-1'
                  />
                  <EnvironmentSecretPeek
                    key={`${controller.targetWorkspaceId}:${controller.targetFor(entry) || entry.sourceId}`}
                    workspaceId={controller.targetWorkspaceId}
                    environmentName={targetName}
                    secretKey={controller.targetFor(entry) || entry.sourceId}
                    className={MAPPING_TARGET_TRIGGER_CLASS}
                  />
                </div>
              )}
            </div>
          </div>
        ))
      ) : (
        <p className={cn('py-6 text-[var(--text-muted)]', ROW_INSET_CLASS)}>
          {unmappedOnly
            ? 'Every resource is mapped. Use Filter to review all mappings.'
            : 'No mappings.'}
        </p>
      )}
    </div>
  )
}
