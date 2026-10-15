'use client'

import { useState } from 'react'
import {
  ChipInput,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  OverflowText,
  scrollFadeAttributes,
  scrollFadeClass,
  Tooltip,
  useScrollEdges,
} from '@sim/emcn'
import { ChevronDown, Plus, Search } from '@sim/emcn/icons'
import { useQueryStates } from 'nuqs'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { WORKSPACE_SEARCH_THRESHOLD } from '@/lib/workspaces/constants'
import {
  CreateProjectModal,
  useProjectCreationPolicy,
} from '@/app/o/[organizationId]/components/create-project-modal/create-project-modal'
import {
  projectPaneOptions,
  projectPaneParsers,
} from '@/app/o/[organizationId]/home/components/project-pane/search-params'
import { useProjects } from '@/app/o/[organizationId]/p/hooks/use-projects'
import { useOrganizationContext } from '@/app/o/[organizationId]/providers/organization-provider'
import { useSettingsDirtyStore } from '@/stores/settings/dirty/store'

/**
 * The name slot's silhouette at its rendered width: a leading diagonal parallel to the swell's
 * taper, and, alone in the swell, the mirrored trailing edge.
 */
function nameSlotClip(width: number, solo: boolean) {
  const leading = 'M23.75 0A8 8 0 0 0 17.6 2.88L3.41 19.9A2.5 2.5 0 0 0 5.34 24'
  const trailing = solo
    ? `L${width - 5.34} 24A2.5 2.5 0 0 0 ${width - 3.41} 19.9L${width - 17.6} 2.88A8 8 0 0 0 ${width - 23.75} 0Z`
    : `L${width - 4} 24A4 4 0 0 0 ${width} 20L${width} 4A4 4 0 0 0 ${width - 4} 0Z`
  return `path('${leading}${trailing}')`
}

/** Re-clips on every width change, so the shape follows the slot while it animates. */
function clipNameSlot(slot: HTMLButtonElement | null) {
  if (!slot) return
  const observer = new ResizeObserver(() => {
    const switcher = slot.parentElement?.querySelector<HTMLElement>('[data-project-switch]')
    slot.style.clipPath = nameSlotClip(slot.offsetWidth, !switcher || switcher.offsetWidth < 1)
  })
  observer.observe(slot)
  return () => observer.disconnect()
}

interface ProjectControlProps {
  active: boolean
  onShow: () => void
}

/** Project navigation stays separate from the chat's resource tabs and ownership. */
export function ProjectControl({ active, onShow }: ProjectControlProps) {
  const { organization } = useOrganizationContext()
  const { projects, roots } = useProjects(organization.id)
  const [params, setParams] = useQueryStates(projectPaneParsers, projectPaneOptions)
  const requestLeave = useSettingsDirtyStore((state) => state.requestLeave)
  const { canCreate, disabledReason } = useProjectCreationPolicy(organization.id)
  const [isMenuOpen, setIsMenuOpen] = useState(false)
  const [isCreateOpen, setIsCreateOpen] = useState(false)
  const [search, setSearch] = useState('')
  const [listElement, setListElement] = useState<HTMLDivElement | null>(null)
  const listEdges = useScrollEdges(listElement)
  const project = projects.find((candidate) => candidate.id === params.project)
  const name = project?.name ?? organization.name
  const showSearch = roots.length >= WORKSPACE_SEARCH_THRESHOLD
  const needle = search.trim().toLowerCase()
  const visibleRoots = needle
    ? roots.filter((candidate) => candidate.name.toLowerCase().includes(needle))
    : roots
  const pick = (workspaceId: string) =>
    requestLeave(() => {
      void setParams({
        project: workspaceId,
        section: null,
        resourceKind: '',
        resourceDetail: '',
        pane: 'project',
      })
      onShow()
    })
  return (
    <div
      data-swell-control=''
      data-active={active}
      className={cn(
        'group/control flex h-6 shrink-0 items-center gap-0.5 max-md:rounded-md',
        active
          ? 'text-[var(--text-inverse)] max-md:bg-[var(--text-body)]'
          : 'text-[var(--text-primary)] max-md:bg-[var(--surface-6)]'
      )}
    >
      <button
        ref={clipNameSlot}
        type='button'
        aria-pressed={active}
        aria-label={`Show ${name}`}
        onClick={onShow}
        className={cn(
          'flex h-full items-center pl-[22px] text-small transition-[padding,background-color,color] duration-200 hover-hover:bg-[var(--surface-2)] hover-hover:text-[var(--text-primary)] focus-visible:bg-[var(--surface-2)] focus-visible:text-[var(--text-primary)] focus-visible:outline-none',
          active
            ? 'pr-2'
            : 'pr-[22px] group-focus-within/control:pr-2 group-hover/control:pr-2 group-has-[[data-state=open]]/control:pr-2'
        )}
      >
        <IdentityTile initial={name[0]} />
        <span
          className={cn(
            'flex min-w-0 overflow-hidden transition-[max-width,margin,opacity] duration-200',
            active
              ? 'ml-1.5 max-w-[136px] opacity-100'
              : 'ml-0 max-w-0 opacity-0 group-focus-within/control:ml-1.5 group-focus-within/control:max-w-[136px] group-focus-within/control:opacity-100 group-hover/control:ml-1.5 group-hover/control:max-w-[136px] group-hover/control:opacity-100 group-has-[[data-state=open]]/control:ml-1.5 group-has-[[data-state=open]]/control:max-w-[136px] group-has-[[data-state=open]]/control:opacity-100'
          )}
        >
          <OverflowText label={name} className='max-w-[136px]' />
        </span>
      </button>
      <DropdownMenu
        open={isMenuOpen}
        onOpenChange={(open) => {
          setIsMenuOpen(open)
          if (!open) setSearch('')
        }}
      >
        <DropdownMenuTrigger asChild>
          <button
            type='button'
            aria-label='Switch project'
            data-project-switch=''
            className={cn(
              'flex h-full items-center justify-center overflow-hidden transition-[width,margin,opacity,background-color,color] duration-200 [clip-path:path("M16.25_0A8_8_0_0_1_22.4_2.88L36.59_19.9A2.5_2.5_0_0_1_34.66_24L4_24A4_4_0_0_1_0_20L0_4A4_4_0_0_1_4_0Z")] hover-hover:bg-[var(--surface-2)] hover-hover:text-[var(--text-primary)] focus-visible:bg-[var(--surface-2)] focus-visible:text-[var(--text-primary)] focus-visible:outline-none data-[state=open]:bg-[var(--surface-2)] data-[state=open]:text-[var(--text-primary)]',
              active
                ? 'w-10 text-[var(--surface-7)]'
                : '-ml-0.5 w-0 text-[var(--text-icon)] opacity-0 group-focus-within/control:ml-0 group-focus-within/control:w-10 group-focus-within/control:opacity-100 group-hover/control:ml-0 group-hover/control:w-10 group-hover/control:opacity-100 group-has-[[data-state=open]]/control:ml-0 group-has-[[data-state=open]]/control:w-10 group-has-[[data-state=open]]/control:opacity-100'
            )}
          >
            <ChevronDown className='-translate-x-1.5 size-[12px] translate-y-px' />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align='start'
          sideOffset={8}
          className='flex max-h-[var(--radix-dropdown-menu-content-available-height,400px)] w-64 max-w-[calc(100vw-24px)] flex-col overflow-y-auto'
        >
          {showSearch && (
            <ChipInput
              className='shrink-0'
              icon={Search}
              placeholder='Search projects...'
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => event.stopPropagation()}
            />
          )}
          <div
            ref={setListElement}
            className={cn(
              scrollFadeClass,
              '-mx-1.5 flex max-h-[200px] flex-col gap-0.5 overflow-y-auto px-1.5 pb-1',
              showSearch && 'pt-1.5'
            )}
            {...scrollFadeAttributes(listEdges)}
          >
            {visibleRoots.length === 0 && needle && (
              <div className='px-2 py-[5px] text-[var(--text-muted)] text-caption'>
                No results for "{search}"
              </div>
            )}
            {visibleRoots.map((candidate) => {
              const isCurrent = candidate.projectId === project?.projectId
              return (
                <DropdownMenuItem
                  key={candidate.projectId}
                  size='lg'
                  active={isCurrent}
                  onSelect={() => pick(isCurrent && project ? project.id : candidate.id)}
                >
                  <IdentityTile initial={candidate.name[0]} />
                  <DropdownMenuItemLabel label={candidate.name} />
                </DropdownMenuItem>
              )
            })}
          </div>
          <DropdownMenuSeparator className='mx-0 mt-0 shrink-0' />
          <NewProjectItem
            disabledReason={disabledReason}
            onSelect={() => {
              setIsMenuOpen(false)
              requestLeave(() => setIsCreateOpen(true))
            }}
            disabled={!canCreate}
          />
        </DropdownMenuContent>
      </DropdownMenu>
      <CreateProjectModal
        organizationId={organization.id}
        open={isCreateOpen}
        onOpenChange={setIsCreateOpen}
      />
    </div>
  )
}

interface NewProjectItemProps {
  disabled: boolean
  disabledReason: string | null
  onSelect: () => void
}

function NewProjectItem({ disabled, disabledReason, onSelect }: NewProjectItemProps) {
  const item = (
    <DropdownMenuItem
      size='lg'
      className='shrink-0'
      disabled={disabled}
      onSelect={(event) => {
        if (disabled) {
          event.preventDefault()
          return
        }
        onSelect()
      }}
    >
      <Plus className='size-[14px]' />
      New project
    </DropdownMenuItem>
  )
  if (!disabledReason) return item
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>
        <div>{item}</div>
      </Tooltip.Trigger>
      <Tooltip.Content>
        <p>{disabledReason}</p>
      </Tooltip.Content>
    </Tooltip.Root>
  )
}
