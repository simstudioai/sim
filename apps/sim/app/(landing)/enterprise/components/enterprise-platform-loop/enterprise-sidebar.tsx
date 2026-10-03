import { memo } from 'react'
import {
  ChipChevronDown,
  chipContentIconClass,
  chipContentLabelClass,
  chipVariants,
  cn,
} from '@sim/emcn'
import {
  Database,
  Files,
  HelpCircle,
  Home,
  Integration,
  Library,
  MoreHorizontal,
  PanelLeft,
  Plus,
  Search,
  Table,
} from '@sim/emcn/icons'
import Image from 'next/image'
import {
  SIDEBAR_CHATS,
  SIDEBAR_WORKFLOWS,
} from '@/app/(landing)/enterprise/components/enterprise-platform-loop/stage-data'

const WORKSPACE_NAV = [
  { label: 'Tables', icon: Table },
  { label: 'Files', icon: Files },
  { label: 'Knowledge bases', icon: Database },
  { label: 'Logs', icon: Library },
] as const

export type SidebarItem = 'New chat' | 'Integrations' | (typeof WORKSPACE_NAV)[number]['label']

interface IconRowProps {
  icon: React.ComponentType<{ className?: string }>
  label: string
  active?: boolean
}

/** A sidebar nav row with a leading icon, like the real workspace sidebar. */
function IconRow({ icon: Icon, label, active = false }: IconRowProps) {
  return (
    <div className={chipVariants({ active, fullWidth: true })}>
      <Icon className={chipContentIconClass} />
      <span className={chipContentLabelClass}>{label}</span>
    </div>
  )
}

/** A bare text row - the real sidebar's chat and workflow entries. */
function TextRow({ label }: { label: string }) {
  return (
    <div className={chipVariants({ fullWidth: true })}>
      <span className={chipContentLabelClass}>{label}</span>
    </div>
  )
}

/** Muted section heading (Chats / Workspace / Workflows). */
function SectionLabel({ label, actions }: { label: string; actions?: boolean }) {
  return (
    <div className='flex items-center justify-between px-4 pb-1.5'>
      <span className='text-[var(--text-secondary)] text-caption'>{label}</span>
      {actions && (
        <span className='flex items-center gap-2 text-[var(--text-icon)]'>
          <MoreHorizontal className='size-[14px]' />
          <Plus className='size-[14px]' />
        </span>
      )}
    </div>
  )
}

export interface EnterpriseSidebarProps {
  /** Workspace name in the header chip. Defaults to the enterprise workspace. */
  workspaceName?: string
  /** Viewer name shown in the profile footer. Defaults to the enterprise persona. */
  profileName?: string
  /** Recent-chat entries - four fill the design height. Defaults enterprise. */
  chats?: readonly string[]
  /** Deployed-workflow entries - five fill the design height. Defaults enterprise. */
  workflows?: readonly string[]
  /** Sidebar row to render active. Defaults to New chat. */
  activeItem?: SidebarItem
}

/**
 * The Brightwave workspace sidebar, rendered live across landing previews so
 * every surface stays aligned with the product: the workspace header, New chat /
 * Integrations, a filled-out Chats history, the Workspace nav, a full
 * Workflows section, and the profile / Help footer. Purely decorative -
 * hover/click behavior is owned by the parent's `pointer-events-none` frame.
 * The workspace and profile names plus the chat / workflow entries are injectable
 * so each solutions hero can read like that team's workspace; defaults keep the
 * enterprise page exactly as it renders today. Memoized - the sidebar is
 * fully static per props, and every consuming loop re-renders on each clock
 * tick with stable sidebar props.
 */
export const EnterpriseSidebar = memo(function EnterpriseSidebar({
  workspaceName = 'Brightwave',
  profileName = 'Morgan',
  chats = SIDEBAR_CHATS,
  workflows = SIDEBAR_WORKFLOWS,
  activeItem = 'New chat',
}: EnterpriseSidebarProps = {}) {
  return (
    <div className='isolate flex h-full w-[238px] shrink-0 flex-col bg-[var(--surface-1)] pt-3 will-change-transform'>
      <div className='flex shrink-0 items-center justify-between px-2'>
        <div className={cn(chipVariants(), 'min-w-0 flex-1')}>
          {/* The exact Brightwave mark the homepage capture seeds
              (`readme-tour-capture` sets `logoUrl: '/landing/rivian-logo.svg'`),
              so both platform previews show the same company logo. */}
          <Image
            src='/landing/rivian-logo.svg'
            alt=''
            width={16}
            height={16}
            className='size-[16px] shrink-0 rounded-sm'
          />
          <span className={chipContentLabelClass}>{workspaceName}</span>
          <ChipChevronDown />
        </div>
        <div className='flex h-[30px] w-[65px] shrink-0 items-center gap-[1px]'>
          <span className={chipVariants()}>
            <Search className={chipContentIconClass} />
          </span>
          <span className={chipVariants()}>
            <PanelLeft className={chipContentIconClass} />
          </span>
        </div>
      </div>

      <div className='mt-4 flex shrink-0 flex-col gap-[1px] px-2'>
        <IconRow icon={Home} label='New chat' active={activeItem === 'New chat'} />
        <IconRow icon={Integration} label='Integrations' active={activeItem === 'Integrations'} />
      </div>

      <div className='mt-4 flex shrink-0 flex-col'>
        <SectionLabel label='Chats' />
        <div className='flex flex-col gap-[1px] px-2'>
          {chats.map((chat) => (
            <TextRow key={chat} label={chat} />
          ))}
        </div>
      </div>

      <div className='mt-4 flex shrink-0 flex-col'>
        <SectionLabel label='Workspace' />
        <div className='flex flex-col gap-[1px] px-2'>
          {WORKSPACE_NAV.map((item) => (
            <IconRow
              key={item.label}
              icon={item.icon}
              label={item.label}
              active={item.label === activeItem}
            />
          ))}
        </div>
      </div>

      <div className='flex min-h-0 flex-1 flex-col overflow-hidden pt-4'>
        <SectionLabel label='Workflows' actions />
        <div className='flex flex-col gap-[1px] px-2'>
          {workflows.map((workflow) => (
            <TextRow key={workflow} label={workflow} />
          ))}
        </div>
      </div>

      <div className='flex shrink-0 items-center border-t px-2 pt-[9px] pb-2'>
        <div className='flex min-w-0 flex-1'>
          <div className={cn(chipVariants(), 'min-w-0 max-w-full')}>
            <span className='flex size-[16px] shrink-0 items-center justify-center rounded-full bg-[var(--surface-4)] text-[var(--text-body)] text-micro leading-none'>
              {profileName.charAt(0).toUpperCase()}
            </span>
            <span className={chipContentLabelClass}>{profileName}</span>
          </div>
        </div>
        <span className={cn(chipVariants(), 'shrink-0')}>
          <HelpCircle className={chipContentIconClass} />
        </span>
      </div>
    </div>
  )
})
