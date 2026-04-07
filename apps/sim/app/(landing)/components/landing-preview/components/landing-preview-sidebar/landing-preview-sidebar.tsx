'use client'

import { ChevronDown, Home, Library } from '@/components/emcn'
import {
  Calendar,
  Database,
  File,
  HelpCircle,
  Search,
  Settings,
  Table,
} from '@/components/emcn/icons'
import { cn } from '@/lib/core/utils/cn'
import type { PreviewWorkflow } from '@/app/(landing)/components/landing-preview/components/landing-preview-workflow/workflow-data'

export type SidebarView =
  | 'home'
  | 'workflow'
  | 'tables'
  | 'files'
  | 'knowledge'
  | 'logs'
  | 'scheduled-tasks'

interface LandingPreviewSidebarProps {
  workflows: PreviewWorkflow[]
  activeWorkflowId: string
  activeView: SidebarView
  onSelectWorkflow: (id: string) => void
  onSelectHome: () => void
  onSelectNav: (id: SidebarView) => void
}

/**
 * Hardcoded dark-theme equivalents of the real sidebar CSS variables.
 * The preview lives inside a `dark` wrapper but CSS variable cascade
 * isn't guaranteed, so we pin the hex values directly.
 */
const C = {
  SURFACE_1: '#1e1e1e',
  SURFACE_2: '#252525',
  SURFACE_ACTIVE: '#363636',
  BORDER: '#2c2c2c',
  TEXT_PRIMARY: '#e6e6e6',
  TEXT_BODY: '#cdcdcd',
  TEXT_ICON: '#939393',
  BRAND: '#33C482',
} as const

const WORKSPACE_NAV = [
  { id: 'tables', label: 'Tables', icon: Table },
  { id: 'files', label: 'Files', icon: File },
  { id: 'knowledge', label: 'Knowledge Base', icon: Database },
  { id: 'scheduled-tasks', label: 'Scheduled Tasks', icon: Calendar },
  { id: 'logs', label: 'Logs', icon: Library },
] as const

const FOOTER_NAV = [
  { id: 'help', label: 'Help', icon: HelpCircle },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const

function NavItem({
  icon: Icon,
  label,
  isActive,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
  isActive?: boolean
  onClick?: () => void
}) {
  if (!onClick) {
    return (
      <div className='pointer-events-none mx-0.5 flex h-[28px] items-center gap-2 rounded-[8px] px-2'>
        <Icon className='h-[14px] w-[14px] flex-shrink-0' style={{ color: C.TEXT_ICON }} />
        <span className='truncate text-[13px]' style={{ color: C.TEXT_BODY, fontWeight: 450 }}>
          {label}
        </span>
      </div>
    )
  }

  return (
    <button
      type='button'
      onClick={onClick}
      className={cn(
        'mx-0.5 flex h-[28px] items-center gap-2 rounded-[8px] px-2 transition-colors hover-hover:bg-[var(--c-active)]',
        isActive && 'bg-[var(--c-active)]'
      )}
    >
      <Icon className='h-[14px] w-[14px] flex-shrink-0' style={{ color: C.TEXT_ICON }} />
      <span className='truncate text-[13px]' style={{ color: C.TEXT_BODY, fontWeight: 450 }}>
        {label}
      </span>
    </button>
  )
}

/**
 * Lightweight sidebar replicating the real workspace sidebar layout and sizing.
 * Starts from the workspace header (no logo/collapse row).
 * Only workflow items are interactive — everything else is pointer-events-none.
 */
export function LandingPreviewSidebar({
  workflows,
  activeWorkflowId,
  activeView,
  onSelectWorkflow,
  onSelectHome,
  onSelectNav,
}: LandingPreviewSidebarProps) {
  const isHomeActive = activeView === 'home'

  return (
    <div
      className='flex h-full w-[248px] flex-shrink-0 flex-col pt-3'
      style={
        { backgroundColor: C.SURFACE_1, '--c-active': C.SURFACE_ACTIVE } as React.CSSProperties
      }
    >
      {/* Workspace Header */}
      <div className='flex-shrink-0 px-2.5'>
        <div
          className='pointer-events-none flex h-[32px] w-full items-center gap-2 rounded-[8px] border pr-2 pl-[5px]'
          style={{ borderColor: C.BORDER, backgroundColor: C.SURFACE_2 }}
        >
          <div className='flex h-[20px] w-[20px] flex-shrink-0 items-center justify-center rounded-[4px] bg-white'>
            <svg width='10' height='10' viewBox='0 0 10 10' fill='none'>
              <path
                d='M1 9C1 4.58 4.58 1 9 1'
                stroke='#1e1e1e'
                strokeWidth='1.8'
                strokeLinecap='round'
              />
            </svg>
          </div>
          <span
            className='min-w-0 flex-1 truncate text-left font-medium text-[13px]'
            style={{ color: C.TEXT_PRIMARY }}
          >
            Superark
          </span>
          <ChevronDown className='h-[8px] w-[10px] flex-shrink-0' style={{ color: C.TEXT_ICON }} />
        </div>
      </div>

      {/* Top Navigation: Home (interactive), Search (static) */}
      <div className='mt-2.5 flex flex-shrink-0 flex-col gap-0.5 px-2'>
        <button
          type='button'
          onClick={onSelectHome}
          className={cn(
            'mx-0.5 flex h-[28px] items-center gap-2 rounded-[8px] px-2 transition-colors hover-hover:bg-[var(--c-active)]',
            isHomeActive && 'bg-[var(--c-active)]'
          )}
        >
          <Home className='h-[14px] w-[14px] flex-shrink-0' style={{ color: C.TEXT_ICON }} />
          <span className='truncate text-[13px]' style={{ color: C.TEXT_BODY, fontWeight: 450 }}>
            Home
          </span>
        </button>
        <NavItem icon={Search} label='Search' />
      </div>

      {/* Workspace */}
      <div className='mt-3.5 flex flex-shrink-0 flex-col'>
        <div className='px-4 pb-1.5'>
          <div className='font-base text-[12px]' style={{ color: C.TEXT_ICON }}>
            Workspace
          </div>
        </div>
        <div className='flex flex-col gap-0.5 px-2'>
          {WORKSPACE_NAV.map((item) => (
            <NavItem
              key={item.id}
              icon={item.icon}
              label={item.label}
              isActive={activeView === item.id}
              onClick={() => onSelectNav(item.id)}
            />
          ))}
        </div>
      </div>

      {/* Scrollable Tasks + Workflows */}
      <div className='flex flex-1 flex-col overflow-y-auto overflow-x-hidden pt-3.5'>
        {/* Workflows */}
        <div className='flex flex-col'>
          <div className='px-4'>
            <div className='font-base text-[12px]' style={{ color: C.TEXT_ICON }}>
              Workflows
            </div>
          </div>
          <div className='mt-1.5 flex flex-col gap-0.5 px-2'>
            {workflows.map((workflow) => {
              const isActive = activeView === 'workflow' && workflow.id === activeWorkflowId
              return (
                <button
                  key={workflow.id}
                  type='button'
                  onClick={() => onSelectWorkflow(workflow.id)}
                  className={cn(
                    'mx-0.5 flex h-[28px] w-full items-center gap-2 rounded-[8px] px-2 transition-colors hover-hover:bg-[#363636]',
                    isActive && 'bg-[#363636]'
                  )}
                >
                  <div
                    className='h-[14px] w-[14px] flex-shrink-0 rounded-[4px] border-[2.5px]'
                    style={{
                      backgroundColor: workflow.color,
                      borderColor: `${workflow.color}60`,
                      backgroundClip: 'padding-box',
                    }}
                  />
                  <div
                    className='min-w-0 flex-1 truncate text-left text-[13px]'
                    style={{ color: C.TEXT_BODY, fontWeight: 450 }}
                  >
                    {workflow.name}
                  </div>
                </button>
              )
            })}
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className='flex flex-shrink-0 flex-col gap-0.5 px-2 pt-[9px] pb-2'>
        {FOOTER_NAV.map((item) => (
          <NavItem key={item.id} icon={item.icon} label={item.label} />
        ))}
      </div>
    </div>
  )
}
