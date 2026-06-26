'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { Search } from 'lucide-react'
import { useRouter } from 'next/navigation'
import {
  Checkbox,
  ChevronDown,
  ChipCopyInput,
  ChipInput,
  ChipModal,
  ChipModalBody,
  ChipModalError,
  ChipModalFooter,
  ChipModalHeader,
  toast,
} from '@/components/emcn'
import type {
  ForkCopyableResource,
  GetForkResourcesResponse,
} from '@/lib/api/contracts/workspace-fork'
import { cn } from '@/lib/core/utils/cn'
import { SettingsSection } from '@/app/workspace/[workspaceId]/settings/components/settings-section/settings-section'
import { useForkResources, useForkWorkspace } from '@/hooks/queries/workspace-fork'

interface ForkWorkspaceModalProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  sourceWorkspaceId: string
  sourceWorkspaceName: string
}

type ResourceKey = Exclude<keyof GetForkResourcesResponse, 'deployedWorkflowCount'>
type ResourceSelection = Record<ResourceKey, Set<string>>

const RESOURCE_KINDS: ReadonlyArray<{ key: ResourceKey; label: string }> = [
  { key: 'files', label: 'Files' },
  { key: 'tables', label: 'Tables' },
  { key: 'knowledgeBases', label: 'Knowledge bases' },
  { key: 'customTools', label: 'Custom tools' },
  { key: 'skills', label: 'Skills' },
  { key: 'mcpServers', label: 'MCP servers' },
]

/** Show the inline search once a kind has more entries than fit comfortably. */
const SEARCH_THRESHOLD = 8

const emptySelection = (): ResourceSelection => ({
  files: new Set(),
  tables: new Set(),
  knowledgeBases: new Set(),
  customTools: new Set(),
  skills: new Set(),
  mcpServers: new Set(),
})

/**
 * One expandable resource kind in the fork picker: a tri-state "select all" header
 * (count of selected / total) plus, when expanded, a searchable scrollable list of
 * individual resources so the user can copy a specific subset.
 */
function ResourceKindRow({
  label,
  items,
  selected,
  onToggleAll,
  onToggleItem,
  disabled,
}: {
  label: string
  items: ForkCopyableResource[]
  selected: Set<string>
  onToggleAll: (selectAll: boolean) => void
  onToggleItem: (id: string, checked: boolean) => void
  disabled: boolean
}) {
  const [expanded, setExpanded] = useState(false)
  const [query, setQuery] = useState('')
  const fieldId = useId()

  const total = items.length
  const selectedCount = selected.size
  const headerState = selectedCount === 0 ? false : selectedCount === total ? true : 'indeterminate'

  const filtered = useMemo(() => {
    const trimmed = query.trim().toLowerCase()
    if (!trimmed) return items
    return items.filter((item) => item.label.toLowerCase().includes(trimmed))
  }, [items, query])

  return (
    <div className='flex flex-col gap-1'>
      <div className='flex items-center gap-2 text-[var(--text-body)] text-sm'>
        <Checkbox
          size='sm'
          aria-label={`Copy all ${label}`}
          checked={headerState}
          onCheckedChange={() => onToggleAll(headerState !== true)}
          disabled={disabled}
        />
        <button
          type='button'
          className='flex min-w-0 flex-1 items-center gap-1 text-left hover:text-[var(--text-primary)]'
          onClick={() => setExpanded((value) => !value)}
        >
          <span className='min-w-0 flex-1 truncate'>
            {label} ({selectedCount > 0 ? `${selectedCount}/${total}` : total})
          </span>
          <ChevronDown
            className={cn(
              'h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)] transition-transform',
              expanded && 'rotate-180'
            )}
          />
        </button>
      </div>

      {expanded ? (
        <div className='ml-6 flex flex-col gap-1'>
          {total > SEARCH_THRESHOLD ? (
            <ChipInput
              icon={Search}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder={`Search ${label.toLowerCase()}`}
              disabled={disabled}
            />
          ) : null}
          <div className='flex max-h-44 flex-col gap-0.5 overflow-y-auto'>
            {filtered.map((item) => {
              const isChecked = selected.has(item.id)
              const itemId = `${fieldId}-${item.id}`
              return (
                <label
                  key={item.id}
                  htmlFor={itemId}
                  className={cn(
                    'flex min-w-0 items-center gap-2 rounded-md py-0.5 text-[var(--text-body)] text-sm',
                    disabled
                      ? 'cursor-not-allowed opacity-60'
                      : 'cursor-pointer hover:text-[var(--text-primary)]'
                  )}
                >
                  <Checkbox
                    id={itemId}
                    size='sm'
                    checked={isChecked}
                    onCheckedChange={(checked) => onToggleItem(item.id, checked === true)}
                    disabled={disabled}
                  />
                  <span className='truncate'>{item.label}</span>
                </label>
              )
            })}
            {filtered.length === 0 ? (
              <p className='py-1 text-[var(--text-secondary)] text-xs'>No matches</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/**
 * Names and creates a fork of the current workspace, lets the user pick which
 * resources to copy (whole kinds or a specific subset), then navigates into the new
 * fork. Unselected resources leave the corresponding workflow subblocks empty.
 */
export function ForkWorkspaceModal({
  open,
  onOpenChange,
  sourceWorkspaceId,
  sourceWorkspaceName,
}: ForkWorkspaceModalProps) {
  const router = useRouter()
  const forkWorkspace = useForkWorkspace()
  const resources = useForkResources(sourceWorkspaceId, open)
  const [name, setName] = useState('')
  const [selected, setSelected] = useState<ResourceSelection>(emptySelection)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (open) {
      setName(`${sourceWorkspaceName} (fork)`)
      setSelected(emptySelection())
      setError(null)
    }
  }, [open, sourceWorkspaceName])

  const isForking = forkWorkspace.isPending

  const availableKinds = useMemo(
    () => RESOURCE_KINDS.filter((kind) => (resources.data?.[kind.key].length ?? 0) > 0),
    [resources.data]
  )

  // A fork always produces a usable workspace: deployed workflows are copied, and
  // when the source has none, create-fork seeds a blank starter workflow (plus any
  // selected resources). So forking is never blocked - we just set expectations when
  // there are no deployed workflows to carry over.
  const noDeployedWorkflows =
    Boolean(resources.data) && (resources.data?.deployedWorkflowCount ?? 0) === 0

  const handleSubmit = () => {
    const trimmed = name.trim()
    if (!trimmed || isForking) return
    setError(null)
    const copy = resources.data
      ? Object.fromEntries(RESOURCE_KINDS.map((kind) => [kind.key, Array.from(selected[kind.key])]))
      : undefined
    const copyingResources = RESOURCE_KINDS.some((kind) => selected[kind.key].size > 0)
    forkWorkspace.mutate(
      { workspaceId: sourceWorkspaceId, body: { name: trimmed, copy } },
      {
        onSuccess: (result) => {
          toast.success(
            copyingResources
              ? `Forked to "${result.workspace.name}" — copying selected resources in the background`
              : `Forked to "${result.workspace.name}"`
          )
          onOpenChange(false)
          router.push(`/workspace/${result.workspace.id}/w`)
        },
        onError: (err) => setError(err.message || 'Failed to fork workspace'),
      }
    )
  }

  return (
    <ChipModal open={open} onOpenChange={onOpenChange} srTitle='Fork workspace'>
      <ChipModalHeader onClose={() => onOpenChange(false)}>Fork workspace</ChipModalHeader>
      <ChipModalBody>
        <div className='flex flex-col gap-7 px-2'>
          <SettingsSection label='Forking from'>
            <ChipCopyInput value={sourceWorkspaceName} aria-label='Forking from' />
          </SettingsSection>

          <SettingsSection
            label='Name'
            headerAccessory={
              <span className='text-[var(--text-error)]' title='Required'>
                *
              </span>
            }
          >
            <ChipInput
              value={name}
              onChange={(event) => setName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                  event.preventDefault()
                  handleSubmit()
                }
              }}
              placeholder='Workspace name'
              maxLength={100}
              autoComplete='off'
              disabled={isForking}
              aria-label='Workspace name'
            />
          </SettingsSection>

          {availableKinds.length > 0 ? (
            <SettingsSection label='Copy resources'>
              <div className='flex flex-col gap-2'>
                {availableKinds.map((kind) => (
                  <ResourceKindRow
                    key={kind.key}
                    label={kind.label}
                    items={resources.data?.[kind.key] ?? []}
                    selected={selected[kind.key]}
                    onToggleAll={(selectAll) =>
                      setSelected((prev) => ({
                        ...prev,
                        [kind.key]: selectAll
                          ? new Set((resources.data?.[kind.key] ?? []).map((item) => item.id))
                          : new Set<string>(),
                      }))
                    }
                    onToggleItem={(id, checked) =>
                      setSelected((prev) => {
                        const next = new Set(prev[kind.key])
                        if (checked) next.add(id)
                        else next.delete(id)
                        return { ...prev, [kind.key]: next }
                      })
                    }
                    disabled={isForking}
                  />
                ))}
                <p className='text-[var(--text-muted)] text-caption'>
                  Unselected resources leave their workflow fields empty in the fork.
                </p>
              </div>
            </SettingsSection>
          ) : null}

          {noDeployedWorkflows ? (
            <p className='text-[var(--text-muted)] text-caption'>
              No deployed workflows to copy — your fork will start with a blank workflow.
            </p>
          ) : null}
        </div>
        <ChipModalError>{error ?? undefined}</ChipModalError>
      </ChipModalBody>
      <ChipModalFooter
        onCancel={() => onOpenChange(false)}
        cancelDisabled={isForking}
        primaryAction={{
          label: isForking ? 'Forking...' : 'Fork',
          onClick: handleSubmit,
          disabled: !name.trim() || isForking,
        }}
      />
    </ChipModal>
  )
}
