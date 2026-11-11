'use client'

import { type ReactNode, useState } from 'react'
import { Disclosure } from '@sim/emcn/disclosure'
import { EmptyState } from '@sim/emcn/empty-state'
import { Icon } from '@sim/emcn/icon'
import { ActionMenu } from '@sim/emcn/menu/action-menu'
import { ChoiceMenu } from '@sim/emcn/menu/choice-menu'
import { useScrollEdges } from '@sim/emcn/scroll-area/use-scroll-edges'
import { SearchField } from '@sim/emcn/search-field'
import { SettingsRow } from '@sim/emcn/settings-section'
import { FailureNotice, StatusTag } from '@sim/emcn/status'
import { getErrorMessage } from '@sim/utils/errors'
import {
  ActionRow,
  SectionToolbar,
} from '@/app/(product)/_components/settings-parts/settings-parts'
import styles from '@/app/(product)/o/[organizationId]/settings/_components/sections/access-control/permission-rows.module.css'
import {
  type AccessRequestTarget,
  accessStateOptions,
  bulkAccessOptions,
  type EditorBlock,
  type EditorModel,
  inheritedPermissionResolvers,
  ORGANIZATION_SCOPED_FEATURE_NOTE,
  type PermissionGroupAccessState,
  type PermissionGroupPlatformFeature,
  type PermissionResolvers,
  type PermissionStatusFilter,
  statusFilterOptions,
  useProviderModels,
} from '@/platform/lib/data/access-control'
import { compareText } from '@/platform/shared/time'

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
    <ActionMenu
      label='Set shown to…'
      triggerSize='compact'
      icon={null}
      disabled={!editable.length}
      disabledReason={!editable.length ? 'No editable permissions are shown' : undefined}
      actions={bulkAccessOptions(editable.every(controls.canRequest)).map((option) => ({
        id: option.value,
        label: option.label,
        onSelect: () => controls.onSet(editable, option.value as PermissionGroupAccessState),
      }))}
    />
  )
}

interface StatusFilterProps {
  value: PermissionStatusFilter
  onChange: (value: PermissionStatusFilter) => void
}

/** The toolbar filter every permission tab shares: show all, or only one access state. */
export function StatusFilter({ value, onChange }: StatusFilterProps) {
  return (
    <ChoiceMenu
      label='Filter by access'
      value={value}
      options={statusFilterOptions(value)}
      onValueChange={(next) => onChange(next as PermissionStatusFilter)}
    />
  )
}

interface PermissionRowProps extends ControlsProps {
  target: AccessRequestTarget
  label: string
  /** The nested choices' short name, as the disclosure that holds them reads: Models, Tools. */
  detailsLabel?: string
  description?: string
  leading?: ReactNode
  badge?: string
  disabled?: boolean
  children?: ReactNode
}

function PermissionRow({
  target,
  label,
  detailsLabel = 'Options',
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
          <ChoiceMenu
            label={label}
            value={state}
            options={accessStateOptions(controls.canRequest(target), state, rowDisabled)}
            disabled={rowDisabled}
            disabledReason={rowDisabled ? explanation || undefined : undefined}
            onValueChange={(next) => controls.onSet([target], next as PermissionGroupAccessState)}
          />
        </ActionRow>
      </SettingsRow>
      {children && (
        <Disclosure label={detailsLabel} open={expanded} onOpenChange={setExpanded}>
          {expanded && <div className={styles.nested}>{children}</div>}
        </Disclosure>
      )}
    </div>
  )
}

interface PlatformPermissionRowProps extends ControlsProps {
  feature: PermissionGroupPlatformFeature
  inert: boolean
  detailsLabel?: string
  children?: ReactNode
}

/** An inert row is an organization-scoped key on a non-default group: nothing would ever read it. */
export function PlatformPermissionRow({
  feature,
  inert,
  detailsLabel,
  children,
  controls,
}: PlatformPermissionRowProps) {
  return (
    <PermissionRow
      label={feature.label}
      detailsLabel={detailsLabel}
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
    .sort((a, b) => compareText(a.label, b.label))
  const targetFor = (id: string) => ({ kind, id }) as AccessRequestTarget
  if (loading) return null
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
      {!filtered.length && <EmptyState title='No matching items' />}
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
      emptyLabel='No models available for this provider'
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
      detailsLabel='Models'
      controls={controls}
    >
      {model.dynamicProviderIds.includes(providerId) ? (
        <DynamicProviderModels provider={providerId} controls={childControls} />
      ) : (
        <PermissionGrid
          items={model.providerModels(providerId).map((id) => ({ id, label: id }))}
          kind='model'
          searchLabel='Search models…'
          emptyLabel='No models available for this provider'
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
      detailsLabel='Tools'
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
          emptyLabel='This integration exposes no configurable tools'
          controls={childControls}
        />
      ) : null}
    </PermissionRow>
  )
}
