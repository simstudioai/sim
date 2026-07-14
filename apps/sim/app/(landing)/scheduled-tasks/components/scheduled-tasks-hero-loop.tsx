'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { cn } from '@sim/emcn'
import { AgentIcon, GmailIcon, GoogleSheetsIcon, ScheduleIcon, SlackIcon } from '@/components/icons'
import { HeroWorkflowStage } from '@/app/(landing)/components/hero/components/hero-platform-loop/hero-workflow-stage'
import type { BlockDef } from '@/app/(landing)/components/hero/components/hero-visual/workflow-data'
import { EnterpriseSidebar } from '@/app/(landing)/enterprise/components/enterprise-platform-loop'

/**
 * The window interior's design space - the same 1280x735 "mini app" geometry
 * the enterprise platform loop uses, so both heroes read at the identical
 * scale inside the shared demo window.
 */
const DESIGN = { width: 1280, height: 735 } as const

/** Sidebar content for the scheduled-tasks hero - a recurring-ops workspace. */
const SIDEBAR_CHATS = [
  'Morning digest setup',
  'Move sync to nightly',
  'Weekly KPI report',
  'Retry failed runs',
] as const

/** Deployed workflows in the sidebar - five fill the design height. */
const SIDEBAR_WORKFLOWS = [
  'Morning digest',
  'Nightly data sync',
  'Weekly KPI report',
  'Invoice sweep',
  'Churn-risk alerts',
] as const

/**
 * The complete scheduled digest workflow on the editor canvas - a schedule
 * trigger holding the cadence, the digest agent, and a three-way fan-out to
 * Slack, Gmail, and Sheets. The schedule trigger is the block the "editing"
 * beat selects, since the cadence is this page's story. Colors follow the
 * stage convention - grey ramp for platform blocks, brand tiles only for
 * real third-party marks (multicolor Gmail/Sheets glyphs sit on white
 * tiles with a hairline, the Jira treatment).
 *
 * Ordered by build sequence; an edge draws once both endpoints are on canvas.
 */
const EDITOR_BLOCKS: BlockDef[] = [
  {
    id: 'schedule',
    name: 'Schedule',
    icon: ScheduleIcon,
    bgColor: 'var(--text-muted)',
    isTrigger: true,
    rows: [
      { title: 'Cadence', value: 'Weekdays' },
      { title: 'Time', value: '9:00 AM PT' },
    ],
    x: 555,
    y: 20,
  },
  {
    id: 'agent',
    name: 'Digest agent',
    icon: AgentIcon,
    bgColor: 'var(--text-primary)',
    rows: [
      { title: 'Messages', value: '-' },
      { title: 'Model', value: '-' },
    ],
    x: 555,
    y: 280,
  },
  {
    id: 'slack',
    name: 'Post to Slack',
    icon: SlackIcon,
    bgColor: '#611F69',
    isTerminal: true,
    rows: [
      { title: 'Channel', value: '-' },
      { title: 'Message', value: '-' },
    ],
    x: 100,
    y: 560,
  },
  {
    id: 'gmail',
    name: 'Send by email',
    icon: GmailIcon,
    bgColor: '#FFFFFF',
    tileBorder: true,
    isTerminal: true,
    rows: [
      { title: 'To', value: '-' },
      { title: 'Subject', value: '-' },
    ],
    x: 555,
    y: 560,
  },
  {
    id: 'sheets',
    name: 'Append to Sheets',
    icon: GoogleSheetsIcon,
    bgColor: '#FFFFFF',
    tileBorder: true,
    isTerminal: true,
    rows: [
      { title: 'Spreadsheet', value: '-' },
      { title: 'Range', value: '-' },
    ],
    x: 1010,
    y: 560,
  },
]

/** Source → target pairs, drawn in order as their endpoints land on canvas. */
const EDITOR_EDGES: ReadonlyArray<readonly [string, string]> = [
  ['schedule', 'agent'],
  ['agent', 'slack'],
  ['agent', 'gmail'],
  ['agent', 'sheets'],
]

/** Design-space bounding box of the layout above. */
const EDITOR_CANVAS = { width: 1360, height: 780 } as const

/** The empty canvas holds this long before the first block lands. */
const IDLE_HOLD_MS = 900
/** Block N (build order) pops in at IDLE_HOLD_MS + N * BUILD_STEP_MS. */
const BUILD_STEP_MS = 620
/** The schedule block gets its selection ring this long after the last block. */
const SELECT_AFTER_MS = 700
/** The finished, selected canvas holds this long before the fade. */
const SELECTED_HOLD_MS = 5200
/** Fade-out length before the cycle restarts. */
const RESET_FADE_MS = 300

/** The block the "editing" beat selects once the flow is assembled - the cadence. */
const SELECTED_BLOCK_ID = 'schedule'

/**
 * The scheduled-tasks hero's editor loop - the chat-free sibling of the
 * enterprise platform loop, in the workflows hero's exact architecture (a
 * fixed 1280x735 design-space layer scaled to the window via ResizeObserver +
 * `transform: scale`, a parent-owned clock driving a presentational stage,
 * reduced-motion showing the finished frame) and the same live
 * {@link EnterpriseSidebar}. The workspace pane is the editor canvas: the
 * morning-digest workflow assembles block by block behind its schedule
 * trigger (edges stroke-draw as endpoints land), then the schedule block
 * picks up the real editor's selection ring - the cadence being edited, this
 * page's story - before the scene fades and the cycle restarts.
 *
 * Everything is `pointer-events-none` decorative, matching the hero's
 * `aria-hidden` frame. Under `prefers-reduced-motion` the loop never starts:
 * the fully-built, selected canvas renders statically.
 */
export function ScheduledTasksHeroLoop() {
  const regionRef = useRef<HTMLDivElement>(null)
  const [builtCount, setBuiltCount] = useState(0)
  const [selected, setSelected] = useState(false)
  const [fading, setFading] = useState(false)
  const [cycleId, setCycleId] = useState(0)
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
      setBuiltCount(EDITOR_BLOCKS.length)
      setSelected(true)
    }

    const runCycle = () => {
      setFading(false)
      setBuiltCount(0)
      setSelected(false)
      setCycleId((c) => c + 1)
      const selectAt = IDLE_HOLD_MS + (EDITOR_BLOCKS.length - 1) * BUILD_STEP_MS + SELECT_AFTER_MS
      const total = selectAt + SELECTED_HOLD_MS
      timers = [
        ...EDITOR_BLOCKS.map((_, i) =>
          setTimeout(() => setBuiltCount(i + 1), IDLE_HOLD_MS + i * BUILD_STEP_MS)
        ),
        setTimeout(() => setSelected(true), selectAt),
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
        />
        <div className='h-full min-w-0 flex-1 py-[7px] pr-[8px]'>
          <div className='h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
            <div
              className={cn(
                'h-full w-full transition-opacity duration-300 ease-out',
                fading ? 'opacity-0' : 'opacity-100'
              )}
            >
              <HeroWorkflowStage
                key={cycleId}
                builtCount={builtCount}
                blocks={EDITOR_BLOCKS}
                edges={EDITOR_EDGES}
                canvas={EDITOR_CANVAS}
                selectedId={selected ? SELECTED_BLOCK_ID : undefined}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
