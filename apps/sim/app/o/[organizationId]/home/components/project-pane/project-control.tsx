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
    <div className='flex h-[var(--tab-strip-band,30px)] shrink-0 items-center overflow-hidden rounded-lg border border-[var(--border)]'>
      <button
        type='button'
        aria-pressed={active}
        aria-label={`Show ${name}`}
        onClick={onShow}
        className={cn(
          'flex h-full items-center gap-1.5 pr-2 pl-1.5 text-small transition-colors',
          active
            ? 'bg-[var(--surface-active)] text-[var(--text-primary)]'
            : 'text-[var(--text-body)] hover-hover:bg-[var(--surface-hover)]'
        )}
      >
        <IdentityTile initial={name[0]} />
        <OverflowText label={name} className='max-w-[136px]' />
      </button>
      <span aria-hidden className={cn('h-4 w-px bg-[var(--border)]', active && 'invisible')} />
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
            className='flex h-full w-6 items-center justify-center text-[var(--text-icon)] transition-colors hover-hover:bg-[var(--surface-hover)]'
          >
            <ChevronDown className='size-[12px]' />
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
