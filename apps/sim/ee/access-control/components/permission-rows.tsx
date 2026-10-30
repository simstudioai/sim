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
  canRequest: (target: AccessRequestTarget) => boolean
  onSet: (targets: AccessRequestTarget[], state: PermissionGroupAccessState) => void
}

function inheritedControls(
  parent: AccessRequestTarget,
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
  }
}

interface PermissionRowSelectProps extends PermissionEditorControls {
  target: AccessRequestTarget
  label: string
  disabled?: boolean
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

function PermissionRowSelect({
  target,
  label,
  disabled,
  getState,
  isInherited,
  canRequest,
  onSet,
}: PermissionRowSelectProps) {
  const inherited = isInherited(target)
  return (
    <div className='flex shrink-0 items-center gap-2'>
      {inherited && (
        <Info>Inherited from a restricted parent. Allow the parent to edit this choice.</Info>
      )}
      <AccessStateSelect
        label={label}
        value={getState(target)}
        disabled={disabled || inherited}
        canRequest={canRequest(target)}
        onChange={(state) => onSet([target], state)}
      />
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
  const [expanded, setExpanded] = useState(false)
  const detailsId = useId()
  const label = (
    <>
      <span className='font-normal text-sm'>{feature.label}</span>
      {inert && <ChipTag variant='gray'>Organization</ChipTag>}
    </>
  )
  const labelClass = cn('flex min-w-0 flex-1 items-center gap-2 py-1 pl-2', inert && 'opacity-60')
  return (
    <div className='flex flex-col'>
      <div className='flex flex-wrap items-center gap-1.5 rounded-md pr-2 transition-colors hover-hover:bg-[var(--surface-active)]'>
        {children ? (
          <button
            type='button'
            aria-expanded={expanded}
            aria-controls={detailsId}
            onClick={() => setExpanded(!expanded)}
            className={cn(labelClass, 'text-left')}
          >
            {label}
            <ChevronDown
              className={cn(
                'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
                expanded && 'rotate-180'
              )}
            />
          </button>
        ) : (
          <div className={labelClass}>{label}</div>
        )}
        <PermissionRowSelect
          label={feature.label}
          target={{ kind: 'feature', configKey: feature.configKey }}
          disabled={inert}
          {...controls}
        />
        <Info side='top' className='shrink-0'>
          {inert ? `${feature.hint} ${ORGANIZATION_SCOPED_FEATURE_NOTE}` : feature.hint}
        </Info>
      </div>
      {children && expanded && (
        <div id={detailsId} className='ml-6 border-[var(--border)] border-l py-2 pl-3'>
          {children}
        </div>
      )}
    </div>
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
        className={cn('max-h-[280px] overflow-y-auto', scrollFadeClass)}
        {...scrollFadeAttributes(scrollEdges)}
      >
        <div className='flex flex-col gap-0.5'>
          {filtered.map((item) => (
            <div
              key={item.id}
              className='flex flex-wrap items-center justify-between gap-2 rounded-md px-2 py-1 hover-hover:bg-[var(--surface-active)]'
            >
              <OverflowText label={item.label} className='min-w-0 flex-1 text-sm' />
              <PermissionRowSelect target={targetFor(item.id)} label={item.label} {...controls} />
            </div>
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
  const [expanded, setExpanded] = useState(false)
  const definition = PROVIDER_DEFINITIONS[providerId]
  const ProviderIcon = definition?.icon
  const name = definition?.name ?? providerId
  const dynamic = (DYNAMIC_MODEL_PROVIDERS as readonly string[]).includes(providerId)
  const childControls = inheritedControls({ kind: 'provider', id: providerId }, controls)
  const items = useMemo(
    () => getProviderModels(providerId).map((id) => ({ id, label: id })),
    [providerId]
  )
  return (
    <div>
      <div className='flex flex-wrap items-center gap-2 rounded-md px-2 py-1 hover-hover:bg-[var(--surface-active)]'>
        {ProviderIcon && <ProviderIcon className='size-[16px] shrink-0' />}
        <button
          type='button'
          aria-expanded={expanded}
          onClick={() => setExpanded(!expanded)}
          className='flex min-w-0 flex-1 items-center gap-2 text-left'
        >
          <OverflowText label={name} className='text-sm' />
          <ChevronDown
            className={cn(
              'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </button>
        <PermissionRowSelect
          target={{ kind: 'provider', id: providerId }}
          label={name}
          {...controls}
        />
      </div>
      {expanded && (
        <div className='border-[var(--border)] border-t px-2 pt-2 pb-3'>
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
        </div>
      )}
    </div>
  )
}

interface BlockToolRowProps extends PermissionEditorControls {
  block: BlockConfig
}

/** Edits a block and its tool operations, preserving child choices while a parent restricts access. */
export function BlockToolRow({ block, ...controls }: BlockToolRowProps) {
  const [expanded, setExpanded] = useState(false)
  const childControls = inheritedControls({ kind: 'integration', id: block.type }, controls)
  const Icon = block.icon
  const items = useMemo(
    () => (block.tools?.access ?? []).map((id) => ({ id, label: getToolMetadata(id)?.name ?? id })),
    [block.tools?.access]
  )
  return (
    <div>
      <div className='flex flex-wrap items-center gap-2 rounded-md px-2 py-1 hover-hover:bg-[var(--surface-active)]'>
        <div
          className='flex size-[16px] shrink-0 items-center justify-center overflow-hidden rounded-sm'
          style={{ background: block.bgColor }}
        >
          {Icon && <Icon className='size-[9px]! text-white' />}
        </div>
        <button
          type='button'
          aria-expanded={items.length ? expanded : undefined}
          disabled={!items.length}
          onClick={() => setExpanded(!expanded)}
          className='flex min-w-0 flex-1 items-center gap-2 text-left'
        >
          <OverflowText label={block.name} className='text-sm' />
          {block.sourceWorkspaceName && (
            <span className='text-[var(--text-muted)] text-caption'>
              {block.sourceWorkspaceName}
            </span>
          )}
          {!!items.length && (
            <ChevronDown
              className={cn(
                'size-[14px] shrink-0 text-[var(--text-icon)] transition-transform',
                expanded && 'rotate-180'
              )}
            />
          )}
        </button>
        {block.description && <Info>{block.description}</Info>}
        <PermissionRowSelect
          target={{ kind: 'integration', id: block.type }}
          label={block.name}
          {...controls}
        />
      </div>
      {expanded && !!items.length && (
        <div className='border-[var(--border)] border-t px-2 pt-2 pb-3'>
          <PermissionGrid
            items={items}
            kind='tool'
            searchPlaceholder='Search tools...'
            emptyLabel='This integration exposes no configurable tools.'
            {...childControls}
          />
        </div>
      )}
    </div>
  )
}
