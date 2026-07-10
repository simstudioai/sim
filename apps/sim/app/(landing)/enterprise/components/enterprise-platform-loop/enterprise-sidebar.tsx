import { ChevronDown, cn, Home, Library } from '@sim/emcn'
import {
  Calendar,
  Database,
  File,
  HelpCircle,
  Integration,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Settings,
  Table,
} from '@sim/emcn/icons'
import Image from 'next/image'
import {
  SIDEBAR_CHATS,
  SIDEBAR_WORKFLOWS,
} from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

const WORKSPACE_NAV = [
  { label: 'Tables', icon: Table },
  { label: 'Files', icon: File },
  { label: 'Knowledge base', icon: Database },
  { label: 'Scheduled tasks', icon: Calendar },
  { label: 'Logs', icon: Library },
] as const

interface IconRowProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
}

/** A sidebar nav row with a leading icon, like the real workspace sidebar. */
function IconRow({ icon: Icon, label, active = false }: IconRowProps) {
  return (
    <div
      className={cn(
        'mx-0.5 flex h-[28px] items-center gap-2 rounded-[8px] px-2',
        active && 'bg-[var(--surface-active)]'
      )}
    >
      <Icon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
      <span className='truncate font-[450] text-[13px] text-[var(--text-body)]'>{label}</span>
    </div>
  )
}

/** A bare text row - the real sidebar's chat and workflow entries. */
function TextRow({ label }: { label: string }) {
  return (
    <div className='mx-0.5 flex h-[28px] items-center rounded-[8px] px-2'>
      <span className='truncate font-[450] text-[13px] text-[var(--text-body)]'>{label}</span>
    </div>
  )
}

/** Muted section heading (Chats / Workspace / Workflows). */
function SectionLabel({ label, actions }: { label: string; actions?: boolean }) {
  return (
    <div className='flex items-center justify-between px-4 pb-1.5'>
      <span className='text-[12px] text-[var(--text-icon)]'>{label}</span>
      {actions && (
        <span className='flex items-center gap-2 text-[var(--text-icon)]'>
          <MoreHorizontal className='size-[14px]' />
          <Plus className='size-[14px]' />
        </span>
      )}
    </div>
  )
}

/**
 * The Brightwave workspace sidebar, rendered live (the homepage loop keeps its
 * baked-screenshot sidebar; the enterprise loop draws its own so the content
 * can read like a large tenured deployment): the workspace header, New chat /
 * Search / Integrations, a filled-out Chats history, the Workspace nav, a full
 * Workflows section, and the Help / Settings footer. Purely decorative -
 * hover/click behavior is owned by the parent's `pointer-events-none` frame.
 */
export function EnterpriseSidebar() {
  return (
    <div className='flex h-full w-[249px] flex-shrink-0 flex-col bg-[var(--surface-1)] pt-3'>
      {/* Workspace header, matching the real product's WorkspaceHeader chip
          (borderless `chipVariants()` geometry: h-[30px] rounded-lg px-2 with
          mx-0.5, 16px logo, text-sm name, 6x10 chevron) and therefore the
          homepage's baked sidebar pixels - logo + name + chevron as a bare
          row, panel toggle right-aligned outside it. */}
      <div className='flex flex-shrink-0 items-center justify-between px-2'>
        <div className='mx-0.5 flex h-[30px] min-w-0 items-center gap-2 rounded-lg px-2'>
          {/* The exact Brightwave mark the homepage capture seeds
              (`readme-tour-capture` sets `logoUrl: '/landing/rivian-logo.svg'`),
              so both platform previews show the same company logo. */}
          <Image
            src='/landing/rivian-logo.svg'
            alt=''
            width={16}
            height={16}
            className='size-[16px] flex-shrink-0 rounded-sm'
          />
          <span className='min-w-0 truncate text-[var(--text-body)] text-sm'>Brightwave</span>
          <ChevronDown className='h-[6px] w-[10px] flex-shrink-0 text-[var(--text-icon)]' />
        </div>
        <PanelLeft className='mr-1.5 size-[16px] flex-shrink-0 text-[var(--text-icon)]' />
      </div>

      <div className='mt-2.5 flex flex-shrink-0 flex-col gap-0.5 px-2'>
        <IconRow icon={Home} label='New chat' active />
        <IconRow icon={Search} label='Search' />
        <IconRow icon={Integration} label='Integrations' />
      </div>

      <div className='mt-3.5 flex flex-shrink-0 flex-col'>
        <SectionLabel label='Chats' />
        <div className='flex flex-col gap-0.5 px-2'>
          {SIDEBAR_CHATS.map((chat) => (
            <TextRow key={chat} label={chat} />
          ))}
        </div>
      </div>

      <div className='mt-3.5 flex flex-shrink-0 flex-col'>
        <SectionLabel label='Workspace' />
        <div className='flex flex-col gap-0.5 px-2'>
          {WORKSPACE_NAV.map((item) => (
            <IconRow key={item.label} icon={item.icon} label={item.label} />
          ))}
        </div>
      </div>

      <div className='flex min-h-0 flex-1 flex-col overflow-hidden pt-3.5'>
        <SectionLabel label='Workflows' actions />
        <div className='flex flex-col gap-0.5 px-2'>
          {SIDEBAR_WORKFLOWS.map((workflow) => (
            <TextRow key={workflow} label={workflow} />
          ))}
        </div>
      </div>

      <div className='flex flex-shrink-0 flex-col gap-0.5 px-2 pt-[9px] pb-2'>
        <IconRow icon={HelpCircle} label='Help' />
        <IconRow icon={Settings} label='Settings' />
      </div>
    </div>
  )
}
