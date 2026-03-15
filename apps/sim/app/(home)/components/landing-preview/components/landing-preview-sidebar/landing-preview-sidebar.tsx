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
import type { PreviewWorkflow } from '@/app/(home)/components/landing-preview/components/landing-preview-workflow/workflow-data'

interface LandingPreviewSidebarProps {
  workflows: PreviewWorkflow[]
  activeWorkflowId: string
  activeView: 'home' | 'workflow'
  onSelectWorkflow: (id: string) => void
  onSelectHome: () => void
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
  { id: 'knowledge-base', label: 'Knowledge Base', icon: Database },
  { id: 'scheduled-tasks', label: 'Scheduled Tasks', icon: Calendar },
  { id: 'logs', label: 'Logs', icon: Library },
] as const

const FOOTER_NAV = [
  { id: 'help', label: 'Help', icon: HelpCircle },
  { id: 'settings', label: 'Settings', icon: Settings },
] as const

function StaticNavItem({
  icon: Icon,
  label,
}: {
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>
  label: string
}) {
  return (
    <div className='pointer-events-none mx-[2px] flex h-[28px] items-center gap-[8px] rounded-[8px] px-[8px]'>
      <Icon className='h-[14px] w-[14px] flex-shrink-0' style={{ color: C.TEXT_ICON }} />
      <span className='truncate text-[13px]' style={{ color: C.TEXT_BODY, fontWeight: 450 }}>
        {label}
      </span>
    </div>
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
}: LandingPreviewSidebarProps) {
  const isHomeActive = activeView === 'home'

  return (
    <div
      className='flex h-full w-[248px] flex-shrink-0 flex-col pt-[12px]'
      style={{ backgroundColor: C.SURFACE_1 }}
    >
      {/* Workspace Header */}
      <div className='flex-shrink-0 px-[10px]'>
        <div
          className='pointer-events-none flex h-[32px] w-full items-center gap-[8px] rounded-[8px] border pr-[8px] pl-[5px]'
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
      <div className='mt-[10px] flex flex-shrink-0 flex-col gap-[2px] px-[8px]'>
        <button
          type='button'
          onClick={onSelectHome}
          className='mx-[2px] flex h-[28px] items-center gap-[8px] rounded-[8px] px-[8px] transition-colors'
          style={{ backgroundColor: isHomeActive ? C.SURFACE_ACTIVE : 'transparent' }}
          onMouseEnter={(e) => {
            if (!isHomeActive) e.currentTarget.style.backgroundColor = C.SURFACE_ACTIVE
          }}
          onMouseLeave={(e) => {
            if (!isHomeActive) e.currentTarget.style.backgroundColor = 'transparent'
          }}
        >
          <Home className='h-[14px] w-[14px] flex-shrink-0' style={{ color: C.TEXT_ICON }} />
          <span className='truncate text-[13px]' style={{ color: C.TEXT_BODY, fontWeight: 450 }}>
            Home
          </span>
        </button>
        <StaticNavItem icon={Search} label='Search' />
      </div>

      {/* Workspace */}
      <div className='mt-[14px] flex flex-shrink-0 flex-col'>
        <div className='px-[16px] pb-[6px]'>
          <div className='font-base text-[12px]' style={{ color: C.TEXT_ICON }}>
            Workspace
          </div>
        </div>
        <div className='flex flex-col gap-[2px] px-[8px]'>
          {WORKSPACE_NAV.map((item) => (
            <StaticNavItem key={item.id} icon={item.icon} label={item.label} />
          ))}
        </div>
      </div>

      {/* Scrollable Tasks + Workflows */}
      <div className='flex flex-1 flex-col overflow-y-auto overflow-x-hidden pt-[14px]'>
        {/* Workflows */}
        <div className='flex flex-col'>
          <div className='px-[16px]'>
            <div className='font-base text-[12px]' style={{ color: C.TEXT_ICON }}>
              Workflows
            </div>
          </div>
          <div className='mt-[6px] flex flex-col gap-[2px] px-[8px]'>
            {workflows.map((workflow) => {
              const isActive = activeView === 'workflow' && workflow.id === activeWorkflowId
              return (
                <button
                  key={workflow.id}
                  type='button'
                  onClick={() => onSelectWorkflow(workflow.id)}
                  className='group mx-[2px] flex h-[28px] w-full items-center gap-[8px] rounded-[8px] px-[8px] transition-colors'
                  style={{ backgroundColor: isActive ? C.SURFACE_ACTIVE : 'transparent' }}
                  onMouseEnter={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = C.SURFACE_ACTIVE
                  }}
                  onMouseLeave={(e) => {
                    if (!isActive) e.currentTarget.style.backgroundColor = 'transparent'
                  }}
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
      <div className='flex flex-shrink-0 flex-col gap-[2px] px-[8px] pt-[9px] pb-[8px]'>
        {FOOTER_NAV.map((item) => (
          <StaticNavItem key={item.id} icon={item.icon} label={item.label} />
        ))}
      </div>
    </div>
  )
}
