'use client'

import {
  ChipDropdown,
  ChipTag,
  cn,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@sim/emcn'
import { Check, ChevronDown, Settings } from '@sim/emcn/icons'
import { IdentityTile } from '@/components/identity-tile/identity-tile'
import { BrowseRow, BrowseSection } from '@/app/playground/org/components/browse-rows'
import { Changelog } from '@/app/playground/org/components/changelog'
import { IssuesList } from '@/app/playground/org/components/issues-list'
import { ProjectSettings } from '@/app/playground/org/components/project-settings'
import { ProtoDashboard } from '@/app/playground/org/components/proto-dashboard'
import { ResourceKinds } from '@/app/playground/org/components/resource-kinds'
import { ResourceSection } from '@/app/playground/org/components/resource-section'
import { ORGANIZATION, WORKSPACES, workspaceById } from '@/app/playground/org/lib/mock-data'
import {
  MAIN_SECTION_IDS,
  MAIN_SECTIONS,
  type ProjectSection,
} from '@/app/playground/org/lib/routes'
import { SETTINGS_NAV } from '@/app/playground/org/lib/settings-nav'
import { useWorkspacePane } from '@/app/playground/org/lib/workspace-pane-store'

const TABS = [
  ...MAIN_SECTIONS.map((item) => ({ id: item.id as ProjectSection, label: item.label })),
  { id: 'resources' as ProjectSection, label: 'Resources' },
]

/**
 * The workspace tab: pick a project, then its dashboard, changelog, issues, and resources.
 * Resources lists every other kind; opening one keeps the tab and swaps what is below.
 */
export function WorkspaceView() {
  const { projectId, section, setProject, setSection } = useWorkspacePane()
  if (!projectId) return <ProjectPicker onPick={setProject} />
  const workspace = workspaceById(projectId)
  const activeTab: ProjectSection = MAIN_SECTION_IDS.includes(section as never)
    ? section
    : 'resources'
  return (
    <div className='flex h-full min-h-0 flex-col'>
      <header className='flex shrink-0 flex-col gap-3 px-6 pt-5'>
        <div className='flex items-start gap-3'>
          <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type='button'
                  className='flex w-fit items-center gap-1.5 text-[20px] text-[var(--text-primary)] leading-tight'
                >
                  {workspace.name}
                  <ChevronDown className='size-[14px] text-[var(--text-icon)]' />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align='start' className='w-[260px]'>
                {WORKSPACES.map((candidate) => (
                  <DropdownMenuItem key={candidate.id} onSelect={() => setProject(candidate.id)}>
                    <span className='min-w-0 flex-1 truncate'>{candidate.name}</span>
                    <Check className={cn(candidate.id !== workspace.id && 'invisible')} />
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => setSection('settings')}>
                  <Settings />
                  Settings
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <p className='text-[var(--text-muted)] text-small'>{workspace.description}</p>
          </div>
        </div>
        <nav
          aria-label='Project sections'
          className='flex items-center gap-6 border-[var(--border)] border-b'
        >
          {TABS.map((item) => {
            const active = activeTab === item.id
            return (
              <button
                key={item.id}
                type='button'
                onClick={() => setSection(item.id)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  '-mb-px border-b-2 pb-2.5 text-small transition-colors',
                  active
                    ? 'border-[var(--text-primary)] text-[var(--text-primary)]'
                    : 'border-transparent text-[var(--text-muted)] hover-hover:text-[var(--text-body)]'
                )}
              >
                {item.label}
              </button>
            )
          })}
        </nav>
      </header>
      <div className='min-h-0 flex-1 overflow-y-auto'>
        <SectionBody section={section} />
      </div>
    </div>
  )
}

/** The workspace tab with nothing selected: the org's projects. */
function ProjectPicker({ onPick }: { onPick: (projectId: string) => void }) {
  return (
    <div className='min-h-0 flex-1 overflow-y-auto px-8 py-8'>
      <div className='mx-auto flex w-full max-w-[560px] flex-col gap-6'>
        <h1 className='text-[20px] text-[var(--text-primary)] leading-tight'>
          {ORGANIZATION.name}
        </h1>
        <BrowseSection label='Projects'>
          {WORKSPACES.map((workspace) => (
            <BrowseRow key={workspace.id} onClick={() => onPick(workspace.id)}>
              <IdentityTile initial={workspace.name[0]} />
              <span className='shrink-0 text-[var(--text-body)]'>{workspace.name}</span>
              <span className='min-w-0 flex-1 truncate text-[var(--text-muted)]'>
                {workspace.description}
              </span>
              {workspace.needsYou > 0 && <ChipTag variant='gray'>{workspace.needsYou}</ChipTag>}
            </BrowseRow>
          ))}
        </BrowseSection>
      </div>
    </div>
  )
}

function SectionBody({ section }: { section: ProjectSection }) {
  const { projectId, settingsSection, setSettingsSection } = useWorkspacePane()
  if (!projectId) throw new Error('SectionBody needs a project')
  const workspace = workspaceById(projectId)
  switch (section) {
    case 'dashboard':
      return (
        <div className='flex h-full min-h-0 flex-col'>
          <ProtoDashboard workspace={workspace} />
        </div>
      )
    case 'changelog':
      return <Changelog workspace={workspace} />
    case 'issues':
      return <IssuesList workspace={workspace} />
    case 'resources':
      return <ResourceKinds workspace={workspace} />
    case 'settings':
      return (
        <div className='flex flex-col gap-2'>
          <div className='px-6 pt-4'>
            <ChipDropdown
              value={settingsSection}
              onChange={setSettingsSection}
              options={SETTINGS_NAV.map((item) => ({ value: item.id, label: item.label }))}
            />
          </div>
          <ProjectSettings workspace={workspace} sectionId={settingsSection} />
        </div>
      )
    default:
      return <ResourceSection workspace={workspace} section={section} />
  }
}
