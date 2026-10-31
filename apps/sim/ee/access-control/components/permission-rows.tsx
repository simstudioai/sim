'use client'

import { type ReactNode, useId, useMemo, useState } from 'react'
import {
  ChipInput,
  ChipTag,
  cn,
  Info,
  OverflowText,
  scrollFadeAttributes,
  scrollFadeClass,
  useScrollEdges,
} from '@sim/emcn'
import { ChevronDown, Search } from '@sim/emcn/icons'
import {
  ORGANIZATION_SCOPED_FEATURE_NOTE,
  type PermissionGroupPlatformFeature,
} from '@/lib/permission-groups/features'
import {
  SettingsEmptyState,
  SettingsQueryErrorState,
} from '@/app/workspace/[workspaceId]/settings/components/settings-empty-state'
import { SettingsResourceRow } from '@/app/workspace/[workspaceId]/settings/components/settings-resource-row'
import type { BlockConfig } from '@/blocks/types'
import {
  AccessStateSelect,
  BulkAccessSelect,
} from '@/ee/access-control/components/access-state-select'
import type {
  AccessRequestTarget,
  PermissionGroupAccessState,
} from '@/ee/access-requests/lib/targets'
import { useProviderModels } from '@/hooks/queries/providers'
import {
  DYNAMIC_MODEL_PROVIDERS,
  getProviderModels,
  PROVIDER_DEFINITIONS,
} from '@/providers/models'
import type { ProviderId } from '@/providers/types'
import type { ProviderName } from '@/stores/providers'
import { getToolMetadata } from '@/tools/metadata'

/** Resolves draft policy and inheritance, checks request support, and stages edits without saving. */
export interface PermissionEditorControls {
  getState: (target: AccessRequestTarget) => PermissionGroupAccessState
  isInherited: (target: AccessRequestTarget) => boolean
  getInheritedFrom: (target: AccessRequestTarget) => string | null
  canRequest: (target: AccessRequestTarget) => boolean
  onSet: (targets: AccessRequestTarget[], state: PermissionGroupAccessState) => void
}

function inheritedControls(
  parent: AccessRequestTarget,
  parentLabel: string,
  controls: PermissionEditorControls
): PermissionEditorControls {
  const parentState = controls.getState(parent)
  return {
    ...controls,
    getState: (target) => {
      const state = controls.getState(target)
      return parentState === 'unavailable' || state === 'unavailable'
        ? 'unavailable'
        : parentState === 'requestable'
          ? 'requestable'
          : state
    },
    isInherited: (target) => parentState !== 'allowed' || controls.isInherited(target),
    getInheritedFrom: (target) =>
      parentState !== 'allowed'
        ? (controls.getInheritedFrom(parent) ?? parentLabel)
        : controls.getInheritedFrom(target),
  }
}

interface PermissionRowProps extends PermissionEditorControls {
  target: AccessRequestTarget
  label: string
  description?: string
  icon?: ReactNode
  badge?: ReactNode
  disabled?: boolean
  nested?: boolean
  children?: ReactNode
}

interface PermissionBulkSelectProps extends PermissionEditorControls {
  targets: AccessRequestTarget[]
}

/** Edits non-inherited targets, offering requests only when every editable target supports them. */
export function PermissionBulkSelect({ targets, ...controls }: PermissionBulkSelectProps) {
  const editable = targets.filter((target) => !controls.isInherited(target))
  return (
    <BulkAccessSelect
      disabled={!editable.length}
      canRequest={editable.every(controls.canRequest)}
      onChange={(state) => controls.onSet(editable, state)}
    />
  )
}

function PermissionRow({
  target,
  label,
  description,
  icon,
  badge,
  disabled,
  nested,
  children,
  ...controls
}: PermissionRowProps) {
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const inheritedFrom = controls.getInheritedFrom(target)
  const labelContent = (
    <>
      <OverflowText
        label={label}
        className='text-sm'
        focusTarget={children ? 'nearest-interactive' : undefined}
      />
      {badge}
      {children && (
        <ChevronDown
          className={cn(
            'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform motion-reduce:transition-none',
            expanded && 'rotate-180'
          )}
        />
      )}
    </>
  )
  return (
    <div className='flex min-w-0 flex-col'>
      <SettingsResourceRow
        density='compact'
        flush={nested}
        icon={icon}
        iconVariant='custom'
        title={
          <span className='flex min-w-0 items-center'>
            {children ? (
              <button
                type='button'
                aria-expanded={expanded}
                aria-controls={detailsId}
                onClick={() => setExpanded(!expanded)}
                className='flex min-h-10 min-w-0 items-center gap-2 rounded-md text-left focus-visible:outline-hidden focus-visible:ring-2 focus-visible:ring-[var(--border)] focus-visible:ring-inset max-md:pointer-coarse:min-h-11'
              >
                {labelContent}
              </button>
            ) : (
              <span className={cn('flex min-w-0 items-center gap-2', disabled && 'opacity-60')}>
                {labelContent}
              </span>
            )}
            {(description || inheritedFrom) && (
              <Info interactive label={`About ${label}`}>
                <span className='flex flex-col gap-2 whitespace-normal'>
                  {description && <span>{description}</span>}
                  {inheritedFrom && (
                    <span>
                      Controlled by {inheritedFrom}. Set {inheritedFrom} to Allowed to edit this
                      choice.
                    </span>
                  )}
                </span>
              </Info>
            )}
          </span>
        }
        trailing={
          <AccessStateSelect
            label={label}
            value={controls.getState(target)}
            disabled={disabled || controls.isInherited(target)}
            canRequest={controls.canRequest(target)}
            onChange={(state) => controls.onSet([target], state)}
          />
        }
      />
      {children && expanded && (
        <div id={detailsId} className='my-2 ml-2 min-w-0 border-[var(--border)] border-l pl-4'>
          {children}
        </div>
      )}
    </div>
  )
}

interface PlatformPermissionRowProps extends PermissionEditorControls {
  feature: PermissionGroupPlatformFeature
  inert: boolean
  children?: ReactNode
}

/** Edits a platform feature with optional child controls; inert organization-only rows stay disabled. */
export function PlatformPermissionRow({
  feature,
  inert,
  children,
  ...controls
}: PlatformPermissionRowProps) {
  return (
    <PermissionRow
      label={feature.label}
      target={{ kind: 'feature', configKey: feature.configKey }}
      description={inert ? `${feature.hint} ${ORGANIZATION_SCOPED_FEATURE_NOTE}` : feature.hint}
      badge={inert ? <ChipTag variant='gray'>Organization</ChipTag> : undefined}
      disabled={inert}
      {...controls}
    >
      {children}
    </PermissionRow>
  )
}

interface PermissionGridProps extends PermissionEditorControls {
  items: { id: string; label: string }[]
  kind: 'model' | 'tool' | 'knowledge_connector' | 'file_share_auth' | 'chat_deploy_auth'
  loading?: boolean
  searchPlaceholder: string
  emptyLabel: string
}

/** Searches items of one target kind and limits bulk edits to the visible, editable rows. */
export function PermissionGrid({
  items,
  kind,
  loading,
  searchPlaceholder,
  emptyLabel,
  ...controls
}: PermissionGridProps) {
  const [search, setSearch] = useState('')
  const [scrollElement, setScrollElement] = useState<HTMLDivElement | null>(null)
  const scrollEdges = useScrollEdges(scrollElement)
  const filtered = useMemo(() => {
    const query = search.trim().toLowerCase()
    return items
      .filter(
        (item) => item.label.toLowerCase().includes(query) || item.id.toLowerCase().includes(query)
      )
      .sort((a, b) => a.label.localeCompare(b.label))
  }, [items, search])
  const targetFor = (id: string): AccessRequestTarget => ({ kind, id }) as AccessRequestTarget
  if (loading) return <SettingsEmptyState variant='inline'>Loading…</SettingsEmptyState>
  if (!items.length) return <SettingsEmptyState variant='inline'>{emptyLabel}</SettingsEmptyState>
  return (
    <div className='flex flex-col gap-2'>
      <div className='flex flex-wrap items-center gap-2'>
        <ChipInput
          icon={Search}
          placeholder={searchPlaceholder}
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          className='min-w-0 flex-1'
        />
        <PermissionBulkSelect targets={filtered.map((item) => targetFor(item.id))} {...controls} />
      </div>
      {!filtered.length && (
        <SettingsEmptyState variant='inline'>No items match your search.</SettingsEmptyState>
      )}
      <div
        ref={setScrollElement}
        role='region'
        aria-label='Permission options'
        className={cn('scrollbar-none max-h-[280px] overflow-y-auto', scrollFadeClass)}
        {...scrollFadeAttributes(scrollEdges)}
      >
        <div className='flex flex-col gap-0.5'>
          {filtered.map((item) => (
            <PermissionRow
              key={item.id}
              target={targetFor(item.id)}
              label={item.label}
              nested
              {...controls}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

interface DynamicProviderModelsProps extends PermissionEditorControls {
  provider: ProviderName
  workspaceId?: string
}

function DynamicProviderModels({ provider, workspaceId, ...controls }: DynamicProviderModelsProps) {
  const { data, isPending, isError, error, isFetching, refetch } = useProviderModels(
    provider,
    workspaceId
  )
  const items = useMemo(() => (data?.models ?? []).map((id) => ({ id, label: id })), [data?.models])
  if (isError && !data) {
    return (
      <SettingsQueryErrorState
        error={error}
        fallback='Could not load models'
        isRetrying={isFetching}
        onRetry={() => void refetch()}
        variant='inline'
      />
    )
  }
  return (
    <PermissionGrid
      items={items}
      kind='model'
      loading={isPending}
      searchPlaceholder='Search models...'
      emptyLabel='No models available for this provider.'
      {...controls}
    />
  )
}

interface ProviderRowProps extends PermissionEditorControls {
  providerId: ProviderId
  workspaceId?: string
}

/** Edits a provider and its inherited model choices, using workspace-scoped dynamic models when needed. */
export function ProviderRow({ providerId, workspaceId, ...controls }: ProviderRowProps) {
  const definition = PROVIDER_DEFINITIONS[providerId]
  const ProviderIcon = definition?.icon
  const name = definition?.name ?? providerId
  const dynamic = (DYNAMIC_MODEL_PROVIDERS as readonly string[]).includes(providerId)
  const childControls = inheritedControls({ kind: 'provider', id: providerId }, name, controls)
  const items = useMemo(
    () => getProviderModels(providerId).map((id) => ({ id, label: id })),
    [providerId]
  )
  return (
    <PermissionRow
      target={{ kind: 'provider', id: providerId }}
      label={name}
      icon={ProviderIcon ? <ProviderIcon className='size-4 shrink-0' /> : undefined}
      {...controls}
    >
      {dynamic ? (
        <DynamicProviderModels
          provider={providerId as ProviderName}
          workspaceId={workspaceId}
          {...childControls}
        />
      ) : (
        <PermissionGrid
          items={items}
          kind='model'
          searchPlaceholder='Search models...'
          emptyLabel='No models available for this provider.'
          {...childControls}
        />
      )}
    </PermissionRow>
  )
}

interface BlockToolRowProps extends PermissionEditorControls {
  block: BlockConfig
}

/** Edits a block and its tool operations, preserving child choices while a parent restricts access. */
export function BlockToolRow({ block, ...controls }: BlockToolRowProps) {
  const childControls = inheritedControls(
    { kind: 'integration', id: block.type },
    block.name,
    controls
  )
  const Icon = block.icon
  const items = useMemo(
    () => (block.tools?.access ?? []).map((id) => ({ id, label: getToolMetadata(id)?.name ?? id })),
    [block.tools?.access]
  )
  return (
    <PermissionRow
      target={{ kind: 'integration', id: block.type }}
      label={block.name}
      description={block.description}
      icon={
        <span
          className='flex size-4 shrink-0 items-center justify-center overflow-hidden rounded-sm'
          style={{ background: block.bgColor }}
        >
          {Icon && <Icon className='size-[9px]! text-white' />}
        </span>
      }
      badge={
        block.sourceWorkspaceName ? (
          <span className='text-[var(--text-muted)] text-caption'>{block.sourceWorkspaceName}</span>
        ) : undefined
      }
      {...controls}
    >
      {items.length ? (
        <PermissionGrid
          items={items}
          kind='tool'
          searchPlaceholder='Search tools...'
          emptyLabel='This integration exposes no configurable tools.'
          {...childControls}
        />
      ) : null}
    </PermissionRow>
  )
}
