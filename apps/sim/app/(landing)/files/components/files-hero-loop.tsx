'use client'

import type { ReactNode, SVGProps } from 'react'
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { ArrowUpDown, File, ListFilter, Plus, Search } from '@sim/emcn/icons'
import { AgentIcon } from '@/components/icons'
import { CsvIcon, DocxIcon, PdfIcon } from '@/components/icons/document-icons'
import { EnterpriseSidebar } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'

/**
 * The window interior's design space - the same 1280x735 "mini app" geometry
 * the enterprise platform loop uses, so this hero reads at the identical
 * scale inside the shared demo window.
 */
const DESIGN = { width: 1280, height: 735 } as const

/** Sidebar content for the files hero - a file-heavy team's workspace. */
const SIDEBAR_CHATS = [
  'Parse vendor invoices',
  'Draft the weekly report',
  'Summarize the data room',
  'Zip campaign assets',
] as const

/** Deployed workflows in the sidebar - five fill the design height. */
const SIDEBAR_WORKFLOWS = [
  'Invoice parsing',
  'Weekly report',
  'Contract review',
  'Asset export',
  'Data-room sync',
] as const

/** Generic zip-archive glyph - no dedicated component exists in the icon set. */
function ZipIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg
      viewBox='0 0 24 24'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
      strokeLinecap='round'
      strokeLinejoin='round'
      {...props}
    >
      <path d='M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z' />
      <path d='M14 2v4a2 2 0 0 0 2 2h4' />
      <path d='M10 6h1' />
      <path d='M10 10h1' />
      <path d='M10 14h1' />
      <path d='M9 18h2v2h-2z' />
    </svg>
  )
}

interface FileOwner {
  /** Display name in the owner cell. */
  name: string
  /** Initial on the circular badge; agent owners render the agent glyph instead. */
  initial?: string
  /** Marks the owner as a Sim agent, swapping the initial badge for the agent glyph. */
  agent?: boolean
}

interface FileRowData {
  /** File name in the leading column. */
  name: string
  /** Type glyph shared by the name and type columns. */
  icon: React.ComponentType<{ className?: string }>
  /** Human-readable file size. */
  size: string
  /** Short type label (PDF, CSV, ...). */
  type: string
  /** Relative created timestamp. */
  created: string
  /** Owner cell - a teammate or a Sim agent. */
  owner: FileOwner
}

/**
 * The resting library - a believable mix of human uploads and agent-produced
 * artifacts, so the "one store for team and agents" story reads at a glance.
 */
const BASE_ROWS: readonly FileRowData[] = [
  {
    name: 'q3-board-deck.pdf',
    icon: PdfIcon,
    size: '4.2 MB',
    type: 'PDF',
    created: '2 hours ago',
    owner: { name: 'Maya C.', initial: 'M' },
  },
  {
    name: 'invoice-batch-march.csv',
    icon: CsvIcon,
    size: '812 KB',
    type: 'CSV',
    created: '5 hours ago',
    owner: { name: 'Invoice agent', agent: true },
  },
  {
    name: 'brand-guidelines.pdf',
    icon: PdfIcon,
    size: '5.1 MB',
    type: 'PDF',
    created: 'Yesterday',
    owner: { name: 'Jordan L.', initial: 'J' },
  },
  {
    name: 'contract-summary.docx',
    icon: DocxIcon,
    size: '324 KB',
    type: 'DOCX',
    created: 'Yesterday',
    owner: { name: 'Contract agent', agent: true },
  },
  {
    name: 'onboarding-playbook.docx',
    icon: DocxIcon,
    size: '1.1 MB',
    type: 'DOCX',
    created: '3 days ago',
    owner: { name: 'Sam O.', initial: 'S' },
  },
  {
    name: 'product-screenshots.zip',
    icon: ZipIcon,
    size: '18.7 MB',
    type: 'ZIP',
    created: '1 week ago',
    owner: { name: 'Alex M.', initial: 'A' },
  },
  {
    name: 'customer-feedback.csv',
    icon: CsvIcon,
    size: '96 KB',
    type: 'CSV',
    created: '1 week ago',
    owner: { name: 'Maya C.', initial: 'M' },
  },
] as const

/** The agent-produced artifact that drops in at the top of the library. */
const DROPPED_ROW: FileRowData = {
  name: 'weekly-report.pdf',
  icon: PdfIcon,
  size: '1.8 MB',
  type: 'PDF',
  created: 'Just now',
  owner: { name: 'Report agent', agent: true },
}

/** The empty pane holds this long before the first row stamps in. */
const IDLE_HOLD_MS = 700
/** Row N stamps in at IDLE_HOLD_MS + N * ROW_STEP_MS. */
const ROW_STEP_MS = 220
/** The settled library holds this long before the agent's file drops in. */
const DROP_AFTER_MS = 1400
/** The completed frame (with the dropped file) holds this long before the fade. */
const DROPPED_HOLD_MS = 4800
/** Fade-out length before the cycle restarts. */
const RESET_FADE_MS = 300

/** Shared grid template for the header and every file row. */
const ROW_GRID = 'grid grid-cols-[minmax(0,1fr)_110px_130px_170px_200px]'

/** Renders the owner cell - an initial badge for teammates, the agent glyph for agents. */
function OwnerCell({ owner }: { owner: FileOwner }) {
  return (
    <span className='flex min-w-0 items-center gap-3 font-medium text-sm'>
      <span className='flex size-[14px] flex-shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface-3)] font-medium text-[8px] text-[var(--text-secondary)]'>
        {owner.agent ? <AgentIcon className='size-[8px]' /> : owner.initial}
      </span>
      <span className='truncate text-[var(--text-secondary)]'>{owner.name}</span>
    </span>
  )
}

/** One static file row on the shared grid - name, size, type, created, owner. */
function FileRow({ row }: { row: FileRowData }) {
  const Icon = row.icon
  return (
    <div className={cn(ROW_GRID, 'h-[40px] items-center')}>
      <span className='flex min-w-0 items-center gap-3 px-6 font-medium text-[var(--text-body)] text-sm'>
        <Icon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
        <span className='truncate'>{row.name}</span>
      </span>
      <span className='px-6 font-medium text-[var(--text-secondary)] text-sm'>{row.size}</span>
      <span className='flex items-center gap-3 px-6 font-medium text-[var(--text-secondary)] text-sm'>
        <Icon className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
        {row.type}
      </span>
      <span className='px-6 font-medium text-[var(--text-secondary)] text-sm'>{row.created}</span>
      <span className='px-6'>
        <OwnerCell owner={row.owner} />
      </span>
    </div>
  )
}

/** Quiet toolbar chip - the options bar's Filter and Sort affordances. */
function ToolbarChip({ icon, label }: { icon: ReactNode; label: string }) {
  return (
    <span className='flex items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
      {icon}
      {label}
    </span>
  )
}

/**
 * The files hero's platform loop - the workflows editor loop's architecture
 * (a fixed 1280x735 design-space layer scaled to the window via
 * ResizeObserver + `transform: scale`, a parent-owned clock, reduced-motion
 * showing the finished frame) with the same live {@link EnterpriseSidebar}
 * highlighting its Files nav row. The workspace pane is the Files library
 * itself: the 44px title bar (File icon, "Files", "Upload file"), the
 * search/Filter/Sort options bar, and the Name/Size/Type/Created/Owner
 * table holding a mix of human uploads and agent-produced artifacts.
 *
 * The loop's beats: the resting rows stamp in top to bottom, the library
 * settles, then a new agent-produced file ("weekly-report.pdf · Report
 * agent · Just now") drops in at the top of the table - the page's story,
 * an agent writing its output into the shared store - before the scene
 * fades and the cycle restarts.
 *
 * Everything is `pointer-events-none` decorative, matching the hero's
 * `aria-hidden` frame. Under `prefers-reduced-motion` the loop never
 * starts: the full library including the agent's file renders statically.
 */
export function FilesHeroLoop() {
  const regionRef = useRef<HTMLDivElement>(null)
  const [rowCount, setRowCount] = useState(0)
  const [dropped, setDropped] = useState(false)
  const [fading, setFading] = useState(false)
  const [scale, setScale] = useState(1)

  // Track the rendered region width and scale the design-space layer to fill
  // it, keeping the live layer's proportions locked to the window's.
  useLayoutEffect(() => {
    const el = regionRef.current
    if (!el) return
    const measure = () => {
      const w = el.getBoundingClientRect().width
      if (w > 40) setScale(w / DESIGN.width)
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)')
    let timers: ReturnType<typeof setTimeout>[] = []

    const clearScheduled = () => {
      timers.forEach(clearTimeout)
      timers = []
    }

    const showFinished = () => {
      clearScheduled()
      setFading(false)
      setRowCount(BASE_ROWS.length)
      setDropped(true)
    }

    const runCycle = () => {
      setFading(false)
      setRowCount(0)
      setDropped(false)
      const dropAt = IDLE_HOLD_MS + (BASE_ROWS.length - 1) * ROW_STEP_MS + DROP_AFTER_MS
      const total = dropAt + DROPPED_HOLD_MS
      timers = [
        ...BASE_ROWS.map((_, i) =>
          setTimeout(() => setRowCount(i + 1), IDLE_HOLD_MS + i * ROW_STEP_MS)
        ),
        setTimeout(() => setDropped(true), dropAt),
        setTimeout(() => setFading(true), total - RESET_FADE_MS),
        setTimeout(runCycle, total),
      ]
    }

    const syncMotionPreference = () => {
      clearScheduled()
      if (media.matches) {
        showFinished()
        return
      }
      runCycle()
    }

    syncMotionPreference()
    media.addEventListener('change', syncMotionPreference)
    return () => {
      media.removeEventListener('change', syncMotionPreference)
      clearScheduled()
    }
  }, [])

  return (
    <div ref={regionRef} className='pointer-events-none absolute inset-0 overflow-hidden'>
      <div
        className='flex origin-top-left bg-[var(--surface-1)]'
        style={{
          width: DESIGN.width,
          height: DESIGN.height,
          transform: `scale(${scale})`,
        }}
      >
        <EnterpriseSidebar
          workspaceName='Brightwave'
          chats={SIDEBAR_CHATS}
          workflows={SIDEBAR_WORKFLOWS}
          activeNav='Files'
        />
        <div className='h-full min-w-0 flex-1 py-[7px] pr-[8px]'>
          <div className='h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
            <div
              className={cn(
                'flex h-full w-full flex-col transition-opacity duration-300 ease-out',
                fading ? 'opacity-0' : 'opacity-100'
              )}
            >
              {/* Title bar - fixed 44px, matching the real Files page header. */}
              <div className='flex h-[44px] flex-shrink-0 items-center justify-between border-[var(--border)] border-b px-6'>
                <div className='flex items-center gap-3'>
                  <File className='size-[14px] text-[var(--text-icon)]' />
                  <span className='font-medium text-[var(--text-body)] text-sm'>Files</span>
                </div>
                <span className='flex items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                  <Plus className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
                  Upload file
                </span>
              </div>

              {/* Options bar - search on the left, Filter/Sort on the right. */}
              <div className='flex flex-shrink-0 items-center justify-between border-[var(--border)] border-b px-6 py-2.5'>
                <div className='flex flex-1 items-center gap-2.5'>
                  <Search className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                  <span className='text-[var(--text-subtle)] text-caption'>Search files...</span>
                </div>
                <div className='flex items-center gap-1.5'>
                  <ToolbarChip
                    icon={<ListFilter className='mr-1.5 size-[14px] text-[var(--text-icon)]' />}
                    label='Filter'
                  />
                  <ToolbarChip
                    icon={<ArrowUpDown className='mr-1.5 size-[14px] text-[var(--text-icon)]' />}
                    label='Sort'
                  />
                </div>
              </div>

              {/* Column header */}
              <div
                className={cn(
                  ROW_GRID,
                  'h-10 flex-shrink-0 items-center shadow-[inset_0_-1px_0_var(--border)]'
                )}
              >
                {['Name', 'Size', 'Type', 'Created', 'Owner'].map((header) => (
                  <span key={header} className='px-6 text-[var(--text-muted)] text-caption'>
                    {header}
                  </span>
                ))}
              </div>

              {/* File rows - the dropped agent artifact expands in above the base library. */}
              <div className='min-h-0 flex-1 overflow-hidden'>
                <div
                  className={cn(
                    'overflow-hidden transition-all duration-500 ease-out',
                    dropped ? 'max-h-[40px] opacity-100' : 'max-h-0 opacity-0'
                  )}
                >
                  <div
                    className={cn(
                      'bg-[var(--surface-2)] transition-transform duration-500 ease-out',
                      dropped ? 'translate-y-0' : '-translate-y-2'
                    )}
                  >
                    <FileRow row={DROPPED_ROW} />
                  </div>
                </div>
                {BASE_ROWS.map((row, index) => (
                  <div
                    key={row.name}
                    className={cn(
                      'transition-all duration-300 ease-out',
                      index < rowCount ? 'translate-y-0 opacity-100' : '-translate-y-1 opacity-0'
                    )}
                  >
                    <FileRow row={row} />
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
