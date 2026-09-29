'use client'

import { useState } from 'react'
import {
  Chip,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSearchInput,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  toast,
} from '@sim/emcn'
import { Check, ChevronDown, Folder, Plus, X } from '@sim/emcn/icons'
import { useRouter } from 'next/navigation'
import { useQueryStates } from 'nuqs'
import { MockComposer } from '@/app/playground/org/components/mock-composer'
import { PEOPLE, WORKSPACES } from '@/app/playground/org/lib/mock-data'
import { protoRoutes } from '@/app/playground/org/lib/routes'
import { protoParsers } from '@/app/playground/org/lib/search-params'

const NO_PROJECT = 'none'

/** New chat, Codex-style: pick the project in the heading or on the composer, then ask. */
export function NewChatHome() {
  const router = useRouter()
  const [{ project }, setParams] = useQueryStates(protoParsers)
  const selected = WORKSPACES.find((w) => w.id === project)
  const select = (id: string) => void setParams({ project: id })
  const firstName = PEOPLE.teddy.name.split(' ')[0]

  return (
    <div className='flex h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[18vh]'>
      <h1 className='mb-8 max-w-chat text-balance text-center font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
        {selected ? (
          <>
            What should we build in{' '}
            <ProjectMenu value={project} onSelect={select}>
              <button
                type='button'
                className='underline decoration-[var(--text-muted)] decoration-dotted underline-offset-[6px] hover-hover:decoration-[var(--text-body)]'
              >
                {selected.name}
              </button>
            </ProjectMenu>
            ?
          </>
        ) : (
          `What should we get done, ${firstName}?`
        )}
      </h1>
      <div className='flex w-full max-w-chat flex-col gap-2'>
        <div className='flex items-center gap-1'>
          <ProjectMenu value={project} onSelect={select}>
            <Chip leftIcon={selected ? Folder : X} rightIcon={ChevronDown}>
              {selected ? selected.name : 'No project'}
            </Chip>
          </ProjectMenu>
        </div>
        <MockComposer
          placeholder={selected ? `Ask Sim to work on ${selected.name}…` : 'Do anything'}
          onSubmit={() => {
            if (selected) router.push(`${protoRoutes.workspace(selected.id)}?chat=new`)
            else toast.success('Started an org-wide chat')
          }}
        />
      </div>
    </div>
  )
}

interface ProjectMenuProps {
  value: string
  onSelect: (id: string) => void
  children: React.ReactElement
}

function ProjectMenu({ value, onSelect, children }: ProjectMenuProps) {
  const [search, setSearch] = useState('')
  const matches = WORKSPACES.filter((w) => w.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-[300px] font-sans'>
        <DropdownMenuSearchInput
          placeholder='Search projects'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {matches.map((workspace) => (
          <DropdownMenuItem key={workspace.id} onSelect={() => onSelect(workspace.id)}>
            <Folder />
            <span className='min-w-0 flex-1 truncate'>{workspace.name}</span>
            <Check className={cn(workspace.id !== value && 'invisible')} />
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem>
          <Plus />
          New project
        </DropdownMenuItem>
        <DropdownMenuItem onSelect={() => onSelect(NO_PROJECT)}>
          <X />
          Don’t work in a project
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
