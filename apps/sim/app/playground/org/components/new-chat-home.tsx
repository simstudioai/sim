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
import { useSession } from '@/lib/auth/auth-client'
import type { OrganizationSurfaceContext } from '@/lib/organizations/surface'
import { OrganizationHome } from '@/app/o/[organizationId]/home/organization-home'
import { OrganizationProvider } from '@/app/o/[organizationId]/providers/organization-provider'
import { type Project, useProjects } from '@/app/playground/org/lib/project'
import { protoRoutes } from '@/app/playground/org/lib/routes'
import { protoParsers } from '@/app/playground/org/lib/search-params'
import { ChatSurfaceProvider, UserInput } from '@/app/workspace/[workspaceId]/home/components'

const NO_PROJECT = 'none'

interface NewChatHomeProps {
  /** The organization to chat in; without one, only project chats can start here. */
  organization: OrganizationSurfaceContext | null
}

/**
 * New chat: the organization Home from the product (Build, Plan and Search), plus a project
 * picker. Build with a project picked opens that project's chat; everything else is the
 * organization chat exactly as the product runs it.
 */
export function NewChatHome({ organization }: NewChatHomeProps) {
  const router = useRouter()
  const { data: session } = useSession()
  const { roots: projects } = useProjects()
  const [{ project }, setParams] = useQueryStates(protoParsers)
  /** The first project is the default so a fresh visit lands in a project, not an org-wide chat. */
  const selected =
    project === NO_PROJECT ? undefined : (projects.find((p) => p.id === project) ?? projects[0])
  const select = (id: string) => void setParams({ project: id })
  const firstName = session?.user?.name?.split(' ')[0]

  /** Hands a build message to the picked project's chat; false leaves it to the org Home. */
  const openProjectChat = (message: string): boolean => {
    if (!selected) return false
    router.push(
      selected.isMock
        ? `${protoRoutes.workspace(selected.id)}?chat=new`
        : `${protoRoutes.workspace(selected.id)}?chat=new&q=${encodeURIComponent(message)}`
    )
    return true
  }

  if (organization?.mothershipAvailable) {
    return (
      <OrganizationProvider context={organization}>
        <OrganizationHome
          userName={session?.user?.name ?? undefined}
          syncChatUrl={false}
          landing={(mode) =>
            mode === 'agent'
              ? {
                  heading: selected ? `What should we build in ${selected.name}?` : undefined,
                  accessory: (
                    <div className='mb-2 flex items-center gap-1'>
                      <ProjectMenu
                        projects={projects}
                        value={selected?.id ?? NO_PROJECT}
                        onSelect={select}
                      >
                        <Chip leftIcon={selected ? Folder : X} rightIcon={ChevronDown}>
                          {selected ? selected.name : 'No project'}
                        </Chip>
                      </ProjectMenu>
                    </div>
                  ),
                }
              : undefined
          }
          onBeforeSend={(message, mode) => mode === 'agent' && openProjectChat(message)}
        />
      </OrganizationProvider>
    )
  }

  return (
    <div className='flex h-full flex-col items-center justify-center px-6 pt-[2vh] pb-[18vh]'>
      <h1 className='mb-8 max-w-chat text-balance text-center font-season text-[26px] text-[var(--text-primary)] leading-[1.15] tracking-[-0.01em] sm:text-[28px]'>
        {selected ? (
          <>
            What should we build in{' '}
            <ProjectMenu projects={projects} value={selected.id} onSelect={select}>
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
          `What should we get done${firstName ? `, ${firstName}` : ''}?`
        )}
      </h1>
      <div className='flex w-full max-w-chat flex-col gap-2'>
        <div className='flex items-center gap-1'>
          <ProjectMenu projects={projects} value={selected?.id ?? NO_PROJECT} onSelect={select}>
            <Chip leftIcon={selected ? Folder : X} rightIcon={ChevronDown}>
              {selected ? selected.name : 'No project'}
            </Chip>
          </ProjectMenu>
        </div>
        <ChatSurfaceProvider userId={session?.user?.id}>
          <UserInput
            key={selected?.id ?? NO_PROJECT}
            draftScopeKey={`proto:home:${selected?.id ?? NO_PROJECT}`}
            isSending={false}
            onStopGeneration={() => {}}
            onSubmit={(text) => {
              const message = text.trim()
              if (!message) return
              if (!openProjectChat(message))
                toast.success('Org-wide chats need an organization with Sim Chat')
            }}
          />
        </ChatSurfaceProvider>
      </div>
    </div>
  )
}

interface ProjectMenuProps {
  projects: Project[]
  value: string
  onSelect: (id: string) => void
  children: React.ReactElement
}

function ProjectMenu({ projects, value, onSelect, children }: ProjectMenuProps) {
  const [search, setSearch] = useState('')
  const matches = projects.filter((p) => p.name.toLowerCase().includes(search.toLowerCase()))
  return (
    <DropdownMenu onOpenChange={(open) => !open && setSearch('')}>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align='start' className='w-[300px] font-sans'>
        <DropdownMenuSearchInput
          placeholder='Search projects'
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {matches.map((project) => (
          <DropdownMenuItem key={project.id} onSelect={() => onSelect(project.id)}>
            <Folder />
            <span className='min-w-0 flex-1 truncate'>{project.name}</span>
            <Check className={cn(project.id !== value && 'invisible')} />
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
