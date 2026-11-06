'use client'

import { type ReactNode, useState } from 'react'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ORGANIZATION_SCOPED_FEATURE_NOTE,
  type PermissionGroupPlatformFeature,
} from '@/lib/permission-groups/features'
import {
  accessStateOptions,
  bulkAccessOptions,
  inheritedPermissionResolvers,
  type PermissionResolvers,
} from '@/ee/access-control/lib/editor'
import type {
  AccessRequestTarget,
  PermissionGroupAccessState,
} from '@/ee/access-requests/lib/targets'
import { ProviderMark } from '@/platform/app/(shell)/_components/provider-mark/provider-mark'
import {
  ActionRow,
  SectionToolbar,
} from '@/platform/app/(shell)/settings/_components/section-parts/section-parts'
import styles from '@/platform/app/(shell)/settings/_components/sections/access-control/permission-rows.module.css'
import {
  Disclosure,
  EmptyState,
  FailureNotice,
  Icon,
  LoadingRows,
  SearchField,
  Select,
  StatusTag,
} from '@/platform/design-system/components'
import { useScrollEdges } from '@/platform/design-system/components/scroll-area/use-scroll-edges'
import { SettingsRow } from '@/platform/design-system/components/settings-section/settings-section'
import {
  type EditorBlock,
  type EditorModel,
  useProviderModels,
} from '@/platform/lib/data/access-control'

/** Resolves draft policy and inheritance, and stages edits without saving. */
export interface PermissionControls extends PermissionResolvers {
  onSet: (targets: AccessRequestTarget[], state: PermissionGroupAccessState) => void
}

interface ControlsProps {
  controls: PermissionControls
}

interface PermissionBulkSelectProps extends ControlsProps {
  targets: AccessRequestTarget[]
}

/** Edits non-inherited targets, offering requests only when every editable target supports them. */
export function PermissionBulkSelect({ targets, controls }: PermissionBulkSelectProps) {
  const editable = targets.filter((target) => !controls.isInherited(target))
  return (
    <Select
      label='Set shown permissions to'
      variant='quiet'
      disabled={!editable.length}
      options={[
        { value: 'shown', label: 'Set shown to…' },
        ...bulkAccessOptions(editable.every(controls.canRequest)),
      ]}
      value='shown'
      onValueChange={(state) => {
        if (state === 'shown') return
        controls.onSet(editable, state as PermissionGroupAccessState)
      }}
    />
  )
}

interface PermissionRowProps extends ControlsProps {
  target: AccessRequestTarget
  label: string
  description?: string
  leading?: ReactNode
  badge?: string
  disabled?: boolean
  children?: ReactNode
}

function PermissionRow({
  target,
  label,
  description,
  leading,
  badge,
  disabled,
  children,
  controls,
}: PermissionRowProps) {
  const [expanded, setExpanded] = useState(false)
  const inheritedFrom = controls.getInheritedFrom(target)
  const state = controls.getState(target)
  const rowDisabled = disabled || controls.isInherited(target)
  const explanation = [
    description,
    inheritedFrom &&
      `Controlled by ${inheritedFrom}. Set ${inheritedFrom} to Allowed to edit this choice.`,
  ]
    .filter(Boolean)
    .join(' ')
  return (
    <div className={styles.permission}>
      <SettingsRow label={label} description={explanation || undefined} leading={leading}>
        <ActionRow>
          {badge && <StatusTag label={badge} />}
          <Select
            label={label}
            variant='quiet'
            value={state}
            options={accessStateOptions(controls.canRequest(target), state, rowDisabled)}
            disabled={rowDisabled}
            onValueChange={(next) => controls.onSet([target], next as PermissionGroupAccessState)}
          />
        </ActionRow>
      </SettingsRow>
      {children && (
        <Disclosure label={`Details for ${label}`} open={expanded} onOpenChange={setExpanded}>
          {expanded && <div className={styles.nested}>{children}</div>}
        </Disclosure>
      )}
    </div>
  )
}

interface PlatformPermissionRowProps extends ControlsProps {
  feature: PermissionGroupPlatformFeature
  inert: boolean
  children?: ReactNode
}

/** An inert row is an organization-scoped key on a non-default group: nothing would ever read it. */
export function PlatformPermissionRow({
  feature,
  inert,
  children,
  controls,
}: PlatformPermissionRowProps) {
  return (
    <PermissionRow
      label={feature.label}
      target={{ kind: 'feature', configKey: feature.configKey }}
      description={inert ? `${feature.hint} ${ORGANIZATION_SCOPED_FEATURE_NOTE}` : feature.hint}
      badge={inert ? 'Organization' : undefined}
      disabled={inert}
      controls={controls}
    >
      {children}
    </PermissionRow>
  )
}

interface PermissionGridProps extends ControlsProps {
  items: readonly { id: string; label: string }[]
  kind: 'model' | 'tool' | 'knowledge_connector' | 'file_share_auth' | 'chat_deploy_auth'
  loading?: boolean
  searchLabel: string
  emptyLabel: string
}

/** Searches items of one target kind and limits bulk edits to the visible, editable rows. */
export function PermissionGrid({
  items,
  kind,
  loading,
  searchLabel,
  emptyLabel,
  controls,
}: PermissionGridProps) {
  const [search, setSearch] = useState('')
  const scrollRef = useScrollEdges<HTMLDivElement>()
  const query = search.trim().toLowerCase()
  const filtered = items
    .filter(
      (item) => item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)
    )
    .sort((a, b) => a.label.localeCompare(b.label))
  const targetFor = (id: string) => ({ kind, id }) as AccessRequestTarget
  if (loading) return <LoadingRows label='Loading…' />
  if (!items.length) return <EmptyState title={emptyLabel} />
  return (
    <>
      <SectionToolbar
        grow={
          <SearchField label={searchLabel} placeholder={searchLabel} onValueChange={setSearch} />
        }
      >
        <PermissionBulkSelect
          targets={filtered.map((item) => targetFor(item.id))}
          controls={controls}
        />
      </SectionToolbar>
      {!filtered.length && <EmptyState title='No items match your search.' />}
      <div ref={scrollRef} className={styles.grid}>
        {filtered.map((item) => (
          <PermissionRow
            key={item.id}
            target={targetFor(item.id)}
            label={item.label}
            controls={controls}
          />
        ))}
      </div>
    </>
  )
}

function DynamicProviderModels({ provider, controls }: ControlsProps & { provider: string }) {
  const { data, isPending, isError, error, isFetching, refetch } = useProviderModels(
    provider as Parameters<typeof useProviderModels>[0]
  )
  if (isError && !data) {
    return (
      <FailureNotice
        message={getErrorMessage(error, 'Could not load models')}
        retrying={isFetching}
        onRetry={() => void refetch()}
      />
    )
  }
  return (
    <PermissionGrid
      items={(data?.models ?? []).map((id) => ({ id, label: id }))}
      kind='model'
      loading={isPending}
      searchLabel='Search models…'
      emptyLabel='No models available for this provider.'
      controls={controls}
    />
  )
}

interface ProviderRowProps extends ControlsProps {
  providerId: string
  model: EditorModel
}

/** Edits a provider and its inherited model choices. */
export function ProviderRow({ providerId, model, controls }: ProviderRowProps) {
  const name = model.providerName(providerId)
  const childControls = inheritedPermissionResolvers(
    { kind: 'provider', id: providerId },
    name,
    controls
  )
  return (
    <PermissionRow
      target={{ kind: 'provider', id: providerId }}
      label={name}
      leading={<ProviderMark providerId={providerId} />}
      controls={controls}
    >
      {model.dynamicProviderIds.includes(providerId) ? (
        <DynamicProviderModels provider={providerId} controls={childControls} />
      ) : (
        <PermissionGrid
          items={model.providerModels(providerId).map((id) => ({ id, label: id }))}
          kind='model'
          searchLabel='Search models…'
          emptyLabel='No models available for this provider.'
          controls={childControls}
        />
      )}
    </PermissionRow>
  )
}

interface BlockToolRowProps extends ControlsProps {
  block: EditorBlock
}

/** Edits a block and its tool operations, preserving child choices while a parent restricts access. */
export function BlockToolRow({ block, controls }: BlockToolRowProps) {
  const childControls = inheritedPermissionResolvers(
    { kind: 'integration', id: block.type },
    block.name,
    controls
  )
  return (
    <PermissionRow
      target={{ kind: 'integration', id: block.type }}
      label={block.name}
      description={block.description}
      leading={<Icon providerId={block.type} />}
      badge={block.sourceWorkspaceName ?? undefined}
      controls={controls}
    >
      {block.tools.length ? (
        <PermissionGrid
          items={block.tools}
          kind='tool'
          searchLabel='Search tools…'
          emptyLabel='This integration exposes no configurable tools.'
          controls={childControls}
        />
      ) : null}
    </PermissionRow>
  )
}
