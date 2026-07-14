'use client'

import { useState } from 'react'
import { cn } from '@sim/emcn'
import { ArrowUpDown, Database, ListFilter, Plus, Search } from '@sim/emcn/icons'
import {
  ConfluenceIcon,
  GithubIcon,
  GoogleDriveIcon,
  IntercomIcon,
  MicrosoftSharepointIcon,
  NotionIcon,
  SalesforceIcon,
  ZendeskIcon,
} from '@/components/icons'
import { HeroLoopShell } from '@/app/(landing)/components/shared/hero-loop-shell'
import { RESET_FADE_MS } from '@/app/(landing)/hooks/use-design-scale'
import { useMotionSafeCycle } from '@/app/(landing)/hooks/use-motion-safe-cycle'

/** Sidebar content for the knowledge hero - a team living in its docs. */
const SIDEBAR_CHATS = [
  'Refund policy question',
  'Onboarding doc digest',
  'Security review answers',
  'Docs freshness audit',
] as const

/** Deployed workflows in the sidebar - five fill the design height. */
const SIDEBAR_WORKFLOWS = [
  'Docs sync monitor',
  'Support answer bot',
  'Doc ingestion pipeline',
  'Weekly KB digest',
  'Stale-doc alerts',
] as const

interface KnowledgeBaseRow {
  /** Knowledge-base name in the leading cell. */
  name: string
  /** Document count at rest. */
  documents: string
  /** Document count after the sync beat lands (sync row only). */
  documentsSynced?: string
  /** Token count at rest. */
  tokens: string
  /** Token count after the sync beat lands (sync row only). */
  tokensSynced?: string
  /** Connector marks clustered in the Connectors cell. */
  connectors: readonly React.ComponentType<{ className?: string }>[]
  /** Created cell text. */
  created: string
}

/**
 * The knowledge-bases table, in the real Knowledge Base module's column
 * vocabulary (Name / Documents / Tokens / Connectors / Created). The first
 * row is the sync-beat row: its counts step up when the "Syncing" beat
 * resolves.
 */
const BASE_ROWS: readonly KnowledgeBaseRow[] = [
  {
    name: 'Product Documentation',
    documents: '847',
    documentsSynced: '861',
    tokens: '1,284,392',
    tokensSynced: '1,309,204',
    connectors: [NotionIcon, GoogleDriveIcon],
    created: '2 days ago',
  },
  {
    name: 'Customer Support KB',
    documents: '1,203',
    tokens: '2,847,293',
    connectors: [ZendeskIcon, IntercomIcon],
    created: '1 week ago',
  },
  {
    name: 'Engineering Wiki',
    documents: '634',
    tokens: '1,932,405',
    connectors: [ConfluenceIcon, GithubIcon],
    created: 'March 12th, 2026',
  },
  {
    name: 'Sales Playbook',
    documents: '92',
    tokens: '418,570',
    connectors: [SalesforceIcon, GoogleDriveIcon],
    created: 'March 5th, 2026',
  },
  {
    name: 'People & Policies',
    documents: '156',
    tokens: '521,882',
    connectors: [MicrosoftSharepointIcon, NotionIcon],
    created: 'February 28th, 2026',
  },
] as const

/** The empty table holds this long before the first row stamps in. */
const IDLE_HOLD_MS = 700
/** Row N stamps in at IDLE_HOLD_MS + N * ROW_STEP_MS. */
const ROW_STEP_MS = 430
/** The sync beat starts this long after the last row lands. */
const SYNC_AFTER_MS = 900
/** How long the first row shows "Syncing" before its counts update. */
const SYNC_MS = 2200
/** The settled, synced table holds this long before the fade. */
const SYNCED_HOLD_MS = 3400

/** Column headers matching the real Knowledge Base table. */
const COL_HEADERS = ['Name', 'Documents', 'Tokens', 'Connectors', 'Created'] as const

/** The sync beat's lifecycle inside one cycle. */
type SyncPhase = 'idle' | 'syncing' | 'synced'

/**
 * The knowledge hero's module loop - the WorkflowsEditorLoop architecture
 * (fixed 1280x735 design-space layer scaled to the window via ResizeObserver
 * + `transform: scale`, a parent-owned clock, reduced-motion showing the
 * finished frame) with the workspace pane retelling the Knowledge Base
 * module: the 44px title bar (Database mark, "New base"), the search /
 * Filter / Sort options bar, and the knowledge-bases table in the real
 * module's column vocabulary. The rows stamp in one by one, then the top
 * base's connector cluster shows a brief "Syncing" beat that resolves into
 * updated document and token counts before the scene fades and the cycle
 * restarts.
 *
 * Everything is `pointer-events-none` decorative, matching the hero's
 * `aria-hidden` frame. Under `prefers-reduced-motion` the loop never starts:
 * the fully-populated, synced table renders statically.
 */
export function KnowledgeHeroLoop() {
  const [visibleRows, setVisibleRows] = useState(0)
  const [syncPhase, setSyncPhase] = useState<SyncPhase>('idle')
  const [fading, setFading] = useState(false)

  useMotionSafeCycle({
    scheduleCycle: () => {
      setFading(false)
      setVisibleRows(0)
      setSyncPhase('idle')
      const syncAt = IDLE_HOLD_MS + (BASE_ROWS.length - 1) * ROW_STEP_MS + SYNC_AFTER_MS
      const totalMs = syncAt + SYNC_MS + SYNCED_HOLD_MS
      return {
        timers: [
          ...BASE_ROWS.map((_, i) =>
            setTimeout(() => setVisibleRows(i + 1), IDLE_HOLD_MS + i * ROW_STEP_MS)
          ),
          setTimeout(() => setSyncPhase('syncing'), syncAt),
          setTimeout(() => setSyncPhase('synced'), syncAt + SYNC_MS),
          setTimeout(() => setFading(true), totalMs - RESET_FADE_MS),
        ],
        totalMs,
      }
    },
    showFinished: () => {
      setFading(false)
      setVisibleRows(BASE_ROWS.length)
      setSyncPhase('synced')
    },
  })

  return (
    <HeroLoopShell chats={SIDEBAR_CHATS} workflows={SIDEBAR_WORKFLOWS} activeNav='Knowledge base'>
      <div className='h-full w-full overflow-hidden rounded-[6px] border border-[var(--border)] bg-[var(--bg)]'>
        <div
          className={cn(
            'flex h-full w-full flex-col transition-opacity duration-300 ease-out',
            fading ? 'opacity-0' : 'opacity-100'
          )}
        >
          <div className='flex h-[44px] flex-shrink-0 items-center justify-between border-[var(--border)] border-b px-6'>
            <div className='flex items-center gap-3'>
              <Database className='size-[14px] text-[var(--text-icon)]' />
              <span className='font-medium text-[var(--text-body)] text-sm'>Knowledge Base</span>
            </div>
            <div className='flex items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
              <Plus className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
              New base
            </div>
          </div>

          <div className='flex flex-shrink-0 items-center justify-between border-[var(--border)] border-b px-6 py-2.5'>
            <div className='flex items-center gap-2.5'>
              <Search className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
              <span className='text-[var(--text-subtle)] text-caption'>
                Search knowledge bases...
              </span>
            </div>
            <div className='flex items-center gap-1.5'>
              <div className='flex items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                <ListFilter className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
                Filter
              </div>
              <div className='flex items-center rounded-md px-2 py-1 text-[var(--text-secondary)] text-caption'>
                <ArrowUpDown className='mr-1.5 size-[14px] text-[var(--text-icon)]' />
                Sort
              </div>
            </div>
          </div>

          <div className='min-h-0 flex-1 overflow-hidden'>
            <table className='w-full table-fixed text-sm'>
              <colgroup>
                <col />
                <col style={{ width: 140 }} />
                <col style={{ width: 150 }} />
                <col style={{ width: 170 }} />
                <col style={{ width: 190 }} />
              </colgroup>
              <thead className='shadow-[inset_0_-1px_0_var(--border)]'>
                <tr>
                  {COL_HEADERS.map((header) => (
                    <th
                      key={header}
                      className='h-10 px-6 py-1.5 text-left align-middle font-normal text-[var(--text-muted)] text-caption'
                    >
                      {header}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {BASE_ROWS.map((row, index) => {
                  const isSyncRow = index === 0
                  const synced = isSyncRow && syncPhase === 'synced'
                  return (
                    <tr
                      key={row.name}
                      className={cn(
                        'transition-all duration-300 ease-out',
                        index < visibleRows
                          ? 'translate-y-0 opacity-100'
                          : '-translate-y-1 opacity-0'
                      )}
                    >
                      <td className='px-6 py-2.5 align-middle'>
                        <span className='flex min-w-0 items-center gap-3 font-medium text-[var(--text-body)] text-sm'>
                          <Database className='size-[14px] flex-shrink-0 text-[var(--text-icon)]' />
                          <span className='truncate'>{row.name}</span>
                        </span>
                      </td>
                      <td className='px-6 py-2.5 align-middle font-medium text-[var(--text-secondary)] text-sm'>
                        {synced && row.documentsSynced ? row.documentsSynced : row.documents}
                      </td>
                      <td className='px-6 py-2.5 align-middle font-medium text-[var(--text-secondary)] text-sm'>
                        {synced && row.tokensSynced ? row.tokensSynced : row.tokens}
                      </td>
                      <td className='px-6 py-2.5 align-middle'>
                        <span className='flex items-center gap-2.5'>
                          <span className='flex items-center gap-1'>
                            {row.connectors.map((Icon, iconIndex) => (
                              <Icon key={iconIndex} className='size-3.5 flex-shrink-0' />
                            ))}
                          </span>
                          {isSyncRow && syncPhase === 'syncing' && (
                            <span className='flex items-center gap-1.5 text-[var(--text-muted)] text-caption'>
                              <span className='size-1.5 animate-pulse rounded-full bg-[var(--text-secondary)] motion-reduce:animate-none' />
                              Syncing
                            </span>
                          )}
                          {synced && (
                            <span className='text-[var(--text-muted)] text-caption'>Updated</span>
                          )}
                        </span>
                      </td>
                      <td className='px-6 py-2.5 align-middle font-medium text-[var(--text-secondary)] text-sm'>
                        {row.created}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </HeroLoopShell>
  )
}
