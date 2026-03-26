'use client'

import { type SVGProps, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { ChevronDown } from '@/components/emcn'
import { Database, File, Library, Table } from '@/components/emcn/icons'
import {
  AnthropicIcon,
  GeminiIcon,
  GmailIcon,
  GroqIcon,
  HubspotIcon,
  OpenAIIcon,
  SalesforceIcon,
  SlackIcon,
  xAIIcon,
} from '@/components/icons'
import { CsvIcon, JsonIcon, MarkdownIcon, PdfIcon } from '@/components/icons/document-icons'
import { cn } from '@/lib/core/utils/cn'

interface FeaturesPreviewProps {
  activeTab: number
}

export function FeaturesPreview({ activeTab }: FeaturesPreviewProps) {
  const isWorkspaceTab = activeTab <= 4

  return (
    <div className='relative h-[350px] w-full md:h-[560px]'>
      <motion.div
        className='absolute inset-0'
        animate={{ opacity: isWorkspaceTab ? 1 : 0 }}
        transition={{ duration: 0.15 }}
        style={{ pointerEvents: isWorkspaceTab ? 'auto' : 'none' }}
      >
        <WorkspacePreview activeTab={activeTab} isActive={isWorkspaceTab} />
      </motion.div>
      <AnimatePresence>
        {!isWorkspaceTab && (
          <motion.div
            key={activeTab}
            className='absolute inset-0'
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.15 }}
          >
            <DefaultPreview />
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

// ─── Mothership Preview ───────────────────────────────────────────

const TYPING_PROMPT = 'Clear all my todos this week'
const TYPE_SPEED = 45
const TYPE_START_DELAY = 500
const PAUSE_AFTER_TYPE = 800
const CARD_SIZE = 100
const CARD_GAP = 8
const GRID_STEP = CARD_SIZE + CARD_GAP
const GRID_PAD = 8

type CardVariant = 'prompt' | 'table' | 'workflow' | 'knowledge' | 'logs' | 'file'

interface CardDef {
  row: number
  col: number
  variant: CardVariant
  label: string
  color?: string
}

const MOTHERSHIP_CARDS: CardDef[] = [
  { row: 0, col: 0, variant: 'prompt', label: 'prompt.md' },
  { row: 1, col: 0, variant: 'table', label: 'Leads' },
  { row: 0, col: 1, variant: 'workflow', label: 'Email Bot', color: '#7C3AED' },
  { row: 1, col: 1, variant: 'knowledge', label: 'Company KB' },
  { row: 2, col: 0, variant: 'logs', label: 'Run Logs' },
  { row: 0, col: 2, variant: 'file', label: 'notes.md' },
  { row: 2, col: 1, variant: 'workflow', label: 'Onboarding', color: '#2563EB' },
  { row: 1, col: 2, variant: 'table', label: 'Contacts' },
  { row: 2, col: 2, variant: 'file', label: 'report.pdf' },
  { row: 3, col: 0, variant: 'table', label: 'Tickets' },
  { row: 0, col: 3, variant: 'knowledge', label: 'Product Wiki' },
  { row: 3, col: 1, variant: 'logs', label: 'Audit Trail' },
  { row: 1, col: 3, variant: 'workflow', label: 'Support', color: '#059669' },
  { row: 2, col: 3, variant: 'file', label: 'data.csv' },
  { row: 3, col: 2, variant: 'table', label: 'Users' },
  { row: 3, col: 3, variant: 'knowledge', label: 'HR Docs' },
  { row: 0, col: 4, variant: 'workflow', label: 'Pipeline', color: '#DC2626' },
  { row: 1, col: 4, variant: 'logs', label: 'API Logs' },
  { row: 2, col: 4, variant: 'table', label: 'Orders' },
  { row: 3, col: 4, variant: 'file', label: 'config.json' },
  { row: 0, col: 5, variant: 'logs', label: 'Deploys' },
  { row: 1, col: 5, variant: 'table', label: 'Campaigns' },
  { row: 2, col: 5, variant: 'workflow', label: 'Intake', color: '#D97706' },
  { row: 3, col: 5, variant: 'knowledge', label: 'Research' },
  { row: 4, col: 0, variant: 'file', label: 'readme.md' },
  { row: 4, col: 1, variant: 'table', label: 'Revenue' },
  { row: 4, col: 2, variant: 'workflow', label: 'Sync', color: '#0891B2' },
  { row: 4, col: 3, variant: 'logs', label: 'Errors' },
  { row: 4, col: 4, variant: 'table', label: 'Inventory' },
  { row: 4, col: 5, variant: 'file', label: 'schema.json' },
  { row: 0, col: 6, variant: 'table', label: 'Analytics' },
  { row: 1, col: 6, variant: 'workflow', label: 'Digest', color: '#6366F1' },
  { row: 0, col: 7, variant: 'file', label: 'brief.md' },
  { row: 2, col: 6, variant: 'knowledge', label: 'Playbooks' },
  { row: 1, col: 7, variant: 'logs', label: 'Webhooks' },
  { row: 3, col: 6, variant: 'file', label: 'export.csv' },
  { row: 2, col: 7, variant: 'workflow', label: 'Alerts', color: '#E11D48' },
  { row: 4, col: 6, variant: 'logs', label: 'Metrics' },
  { row: 3, col: 7, variant: 'table', label: 'Feedback' },
  { row: 4, col: 7, variant: 'knowledge', label: 'Runbooks' },
]

const EXPAND_TARGETS: Record<number, { row: number; col: number }> = {
  1: { row: 1, col: 0 },
  2: { row: 0, col: 2 },
  3: { row: 1, col: 1 },
  4: { row: 2, col: 0 },
}

const EXPAND_ROW_COUNTS: Record<number, number> = {
  1: 8,
  2: 10,
  3: 10,
  4: 7,
}

function WorkspacePreview({ activeTab, isActive }: { activeTab: number; isActive: boolean }) {
  const containerRef = useRef<HTMLDivElement>(null)
  const inView = useInView(containerRef, { once: true, margin: '-80px' })

  const [typedText, setTypedText] = useState('')
  const [showGrid, setShowGrid] = useState(false)
  const hasPlayedTyping = useRef(false)
  const gridAnimateIn = useRef(true)

  const [expandedTab, setExpandedTab] = useState<number | null>(null)
  const [revealedRows, setRevealedRows] = useState(0)

  const isMothership = activeTab === 0 && isActive
  const isExpandTab = activeTab >= 1 && activeTab <= 4 && isActive
  const expandTarget = EXPAND_TARGETS[activeTab] ?? null

  useEffect(() => {
    if (!inView || showGrid || !isActive || activeTab === 0) return
    gridAnimateIn.current = false
    setShowGrid(true)
  }, [inView, isActive, activeTab, showGrid])

  useEffect(() => {
    if (!inView || !isMothership || hasPlayedTyping.current) return
    hasPlayedTyping.current = true

    const timers: ReturnType<typeof setTimeout>[] = []
    let typeTimer: ReturnType<typeof setInterval> | undefined

    timers.push(
      setTimeout(() => {
        let i = 0
        typeTimer = setInterval(() => {
          i++
          setTypedText(TYPING_PROMPT.slice(0, i))
          if (i >= TYPING_PROMPT.length) {
            clearInterval(typeTimer)
            typeTimer = undefined
            timers.push(
              setTimeout(() => {
                gridAnimateIn.current = true
                setShowGrid(true)
              }, PAUSE_AFTER_TYPE)
            )
          }
        }, TYPE_SPEED)
      }, TYPE_START_DELAY)
    )

    return () => {
      timers.forEach(clearTimeout)
      if (typeTimer) clearInterval(typeTimer)
    }
  }, [inView, isMothership])

  useEffect(() => {
    if (!isExpandTab || !showGrid) {
      if (!isExpandTab) {
        setExpandedTab(null)
        setRevealedRows(0)
      }
      return
    }
    setExpandedTab(null)
    setRevealedRows(0)
    const timer = setTimeout(() => setExpandedTab(activeTab), 300)
    return () => clearTimeout(timer)
  }, [isExpandTab, activeTab, showGrid])

  useEffect(() => {
    const maxRows = expandedTab !== null ? (EXPAND_ROW_COUNTS[expandedTab] ?? 0) : 0
    if (expandedTab === null || revealedRows >= maxRows) return
    const delay = revealedRows === 0 ? 800 : 150
    const timer = setTimeout(() => setRevealedRows((prev) => prev + 1), delay)
    return () => clearTimeout(timer)
  }, [expandedTab, revealedRows])

  const isExpanded = expandedTab !== null

  return (
    <div ref={containerRef} className='relative h-[350px] w-full overflow-hidden md:h-[560px]'>
      <motion.div
        aria-hidden='true'
        className='absolute inset-0'
        animate={{ opacity: isExpanded ? 0 : 1 }}
        transition={{ duration: 0.3 }}
        style={{
          backgroundImage: 'radial-gradient(circle, #D4D4D4 0.75px, transparent 0.75px)',
          backgroundSize: '12px 12px',
          maskImage: 'radial-gradient(ellipse 70% 65% at 48% 50%, black 30%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 65% at 48% 50%, black 30%, transparent 80%)',
        }}
      />

      <AnimatePresence>
        {isMothership && !showGrid && inView && (
          <motion.div
            key='mock-input'
            className='absolute inset-0 z-10 flex items-center justify-center'
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.5, x: -280, y: -180 }}
            transition={{ duration: 0.45, ease: [0.4, 0, 0.2, 1] }}
          >
            <MockUserInput text={typedText} />
          </motion.div>
        )}
      </AnimatePresence>

      {showGrid && (
        <div
          className='absolute inset-0'
          style={{
            maskImage:
              'linear-gradient(to right, black 80%, transparent 100%), linear-gradient(to bottom, black 75%, transparent 100%)',
            WebkitMaskImage:
              'linear-gradient(to right, black 80%, transparent 100%), linear-gradient(to bottom, black 75%, transparent 100%)',
            maskComposite: 'intersect',
            WebkitMaskComposite: 'source-in' as string,
          }}
        >
          {MOTHERSHIP_CARDS.map((card) => (
            <motion.div
              key={`${card.row}-${card.col}`}
              className='absolute'
              initial={gridAnimateIn.current ? { opacity: 0, scale: 0.7, y: 6 } : false}
              animate={isExpanded ? { opacity: 0, scale: 0.95 } : { opacity: 1, scale: 1, y: 0 }}
              transition={{
                duration: isExpanded ? 0.25 : 0.3,
                delay: isExpanded ? 0 : gridAnimateIn.current ? (card.row + card.col) * 0.12 : 0,
                ease: [0.4, 0, 0.2, 1],
              }}
              style={{
                top: GRID_PAD + card.row * GRID_STEP,
                left: GRID_PAD + card.col * GRID_STEP,
                width: CARD_SIZE,
                height: CARD_SIZE,
              }}
            >
              <MiniCard variant={card.variant} label={card.label} color={card.color} />
            </motion.div>
          ))}
        </div>
      )}

      {isExpanded && expandTarget && (
        <motion.div
          key={expandedTab}
          className='absolute inset-0 overflow-hidden border border-[#E5E5E5] bg-white'
          initial={{ opacity: 0, scale: 0.15 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.55, ease: [0.4, 0, 0.2, 1] }}
          style={{
            transformOrigin: `${GRID_PAD + expandTarget.col * GRID_STEP + CARD_SIZE / 2}px ${GRID_PAD + expandTarget.row * GRID_STEP + CARD_SIZE / 2}px`,
          }}
        >
          {expandedTab === 1 && <MockFullTable revealedRows={revealedRows} />}
          {expandedTab === 2 && <MockFullFiles />}
          {expandedTab === 3 && <MockFullKnowledgeBase revealedRows={revealedRows} />}
          {expandedTab === 4 && <MockFullLogs revealedRows={revealedRows} />}
        </motion.div>
      )}
    </div>
  )
}

// ─── Mock User Input ──────────────────────────────────────────────

function MockUserInput({ text }: { text: string }) {
  return (
    <div className='flex w-[380px] items-center gap-[6px] rounded-[16px] border border-[#E0E0E0] bg-white px-[10px] py-[8px] shadow-[0_2px_8px_rgba(0,0,0,0.06)]'>
      <div className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-full border border-[#E8E8E8]'>
        <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
          <path d='M6 2.5v7M2.5 6h7' stroke='#999' strokeWidth='1.5' strokeLinecap='round' />
        </svg>
      </div>
      <div className='min-h-[20px] flex-1 font-[430] text-[#1C1C1C] text-[13px] leading-[20px]'>
        {text}
        <motion.span
          className='ml-[1px] inline-block h-[14px] w-[1.5px] bg-[#1C1C1C] align-text-bottom'
          animate={{ opacity: [1, 0] }}
          transition={{ duration: 0.5, repeat: Number.POSITIVE_INFINITY, repeatType: 'reverse' }}
        />
      </div>
      <div className='flex h-[24px] w-[24px] flex-shrink-0 items-center justify-center rounded-full bg-[#383838]'>
        <svg width='12' height='12' viewBox='0 0 12 12' fill='none'>
          <path
            d='M6 9V3M3.5 5L6 2.5L8.5 5'
            stroke='white'
            strokeWidth='1.5'
            strokeLinecap='round'
            strokeLinejoin='round'
          />
        </svg>
      </div>
    </div>
  )
}

// ─── Mini Card Components ─────────────────────────────────────────

function MiniCard({
  variant,
  label,
  color,
}: {
  variant: CardVariant
  label: string
  color?: string
}) {
  return (
    <div className='flex h-full w-full flex-col overflow-hidden rounded-[2px] border border-[#E5E5E5] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.04)]'>
      <MiniCardHeader variant={variant} label={label} color={color} />
      <div className='flex-1 overflow-hidden'>
        <MiniCardBody variant={variant} color={color} />
      </div>
    </div>
  )
}

function MiniCardHeader({
  variant,
  label,
  color,
}: {
  variant: CardVariant
  label: string
  color?: string
}) {
  return (
    <div className='flex items-center gap-[4px] border-[#F0F0F0] border-b px-[8px] py-[5px]'>
      <MiniCardIcon variant={variant} color={color} />
      <span className='truncate font-medium text-[#888] text-[7px] leading-none'>{label}</span>
    </div>
  )
}

function MiniCardIcon({ variant, color }: { variant: CardVariant; color?: string }) {
  const cls = 'h-[7px] w-[7px] flex-shrink-0 text-[#BBB]'

  switch (variant) {
    case 'prompt':
    case 'file':
      return <File className={cls} />
    case 'table':
      return <Table className={cls} />
    case 'workflow': {
      const c = color ?? '#7C3AED'
      return (
        <div
          className='h-[7px] w-[7px] flex-shrink-0 rounded-[1.5px] border'
          style={{
            backgroundColor: c,
            borderColor: `${c}60`,
            backgroundClip: 'padding-box',
          }}
        />
      )
    }
    case 'knowledge':
      return <Database className={cls} />
    case 'logs':
      return <Library className={cls} />
  }
}

function MiniCardBody({ variant, color }: { variant: CardVariant; color?: string }) {
  switch (variant) {
    case 'prompt':
      return <PromptCardBody />
    case 'file':
      return <FileCardBody />
    case 'table':
      return <TableCardBody />
    case 'workflow':
      return <WorkflowCardBody color={color ?? '#7C3AED'} />
    case 'knowledge':
      return <KnowledgeCardBody />
    case 'logs':
      return <LogsCardBody />
  }
}

function PromptCardBody() {
  return (
    <div className='px-[8px] py-[6px]'>
      <p className='break-words text-[#AAAAAA] text-[6.5px] leading-[10px]'>{TYPING_PROMPT}</p>
    </div>
  )
}

function FileCardBody() {
  return (
    <div className='flex flex-col gap-[3px] px-[8px] py-[6px]'>
      <div className='h-[2px] w-[78%] rounded-full bg-[#E8E8E8]' />
      <div className='h-[2px] w-[92%] rounded-full bg-[#E8E8E8]' />
      <div className='h-[2px] w-[62%] rounded-full bg-[#E8E8E8]' />
      <div className='mt-[3px] h-[2px] w-[70%] rounded-full bg-[#F0F0F0]' />
      <div className='h-[2px] w-[85%] rounded-full bg-[#F0F0F0]' />
      <div className='h-[2px] w-[50%] rounded-full bg-[#F0F0F0]' />
    </div>
  )
}

const TABLE_ROW_WIDTHS = [
  [22, 18, 14],
  [16, 20, 10],
  [24, 12, 16],
  [18, 16, 12],
  [20, 22, 18],
  [14, 18, 8],
] as const

function TableCardBody() {
  return (
    <div className='flex flex-col'>
      <div className='flex items-center gap-[4px] bg-[#FAFAFA] px-[6px] py-[3px]'>
        <div className='h-[2px] flex-1 rounded-full bg-[#D4D4D4]' />
        <div className='h-[2px] flex-1 rounded-full bg-[#D4D4D4]' />
        <div className='h-[2px] flex-1 rounded-full bg-[#D4D4D4]' />
      </div>
      {TABLE_ROW_WIDTHS.map((row, i) => (
        <div
          key={i}
          className='flex items-center gap-[4px] border-[#F5F5F5] border-b px-[6px] py-[3.5px]'
        >
          <div className='h-[1.5px] rounded-full bg-[#EBEBEB]' style={{ width: `${row[0]}%` }} />
          <div className='h-[1.5px] rounded-full bg-[#EBEBEB]' style={{ width: `${row[1]}%` }} />
          <div className='h-[1.5px] rounded-full bg-[#EBEBEB]' style={{ width: `${row[2]}%` }} />
        </div>
      ))}
    </div>
  )
}

function WorkflowCardBody({ color }: { color: string }) {
  return (
    <div className='relative h-full w-full'>
      <div className='absolute top-[10px] left-[10px] h-[14px] w-[14px] rounded-[3px] border border-[#E0E0E0] bg-[#F8F8F8]' />
      <div className='absolute top-[16px] left-[24px] h-[1px] w-[16px] bg-[#D8D8D8]' />
      <div
        className='absolute top-[10px] left-[40px] h-[14px] w-[14px] rounded-[3px] border-[2px]'
        style={{
          backgroundColor: color,
          borderColor: `${color}60`,
          backgroundClip: 'padding-box',
        }}
      />
      <div className='absolute top-[24px] left-[46px] h-[12px] w-[1px] bg-[#D8D8D8]' />
      <div className='absolute top-[36px] left-[40px] h-[14px] w-[14px] rounded-[3px] border border-[#E0E0E0] bg-[#F8F8F8]' />
      <div className='absolute top-[42px] left-[54px] h-[1px] w-[14px] bg-[#D8D8D8]' />
      <div
        className='absolute top-[36px] left-[68px] h-[14px] w-[14px] rounded-[3px] border-[2px]'
        style={{
          backgroundColor: color,
          borderColor: `${color}60`,
          backgroundClip: 'padding-box',
          opacity: 0.5,
        }}
      />
    </div>
  )
}

const KB_WIDTHS = [70, 85, 55, 80, 48] as const

function KnowledgeCardBody() {
  return (
    <div className='flex flex-col gap-[5px] px-[8px] py-[6px]'>
      {KB_WIDTHS.map((w, i) => (
        <div key={i} className='flex items-center gap-[4px]'>
          <div className='h-[3px] w-[3px] flex-shrink-0 rounded-full bg-[#D4D4D4]' />
          <div className='h-[1.5px] rounded-full bg-[#E8E8E8]' style={{ width: `${w}%` }} />
        </div>
      ))}
    </div>
  )
}

const LOG_ENTRIES = [
  { color: '#22C55E', width: 65 },
  { color: '#22C55E', width: 78 },
  { color: '#EAB308', width: 52 },
  { color: '#22C55E', width: 70 },
  { color: '#EF4444', width: 58 },
  { color: '#22C55E', width: 74 },
] as const

function LogsCardBody() {
  return (
    <div className='flex flex-col gap-[3px] px-[6px] py-[4px]'>
      {LOG_ENTRIES.map((entry, i) => (
        <div key={i} className='flex items-center gap-[4px] py-[1px]'>
          <div
            className='h-[3px] w-[3px] flex-shrink-0 rounded-full'
            style={{ backgroundColor: entry.color }}
          />
          <div
            className='h-[1.5px] rounded-full bg-[#E8E8E8]'
            style={{ width: `${entry.width}%` }}
          />
          <div className='ml-auto h-[1.5px] w-[10px] flex-shrink-0 rounded-full bg-[#F0F0F0]' />
        </div>
      ))}
    </div>
  )
}

// ─── Tables Mock Data ─────────────────────────────────────────────

const MOCK_TABLE_COLUMNS = ['Name', 'Email', 'Company', 'Status'] as const

const MOCK_TABLE_DATA = [
  ['Sarah Chen', 'sarah@acme.co', 'Acme Inc', 'Qualified'],
  ['James Park', 'james@globex.io', 'Globex', 'New'],
  ['Maria Santos', 'maria@initech.com', 'Initech', 'Contacted'],
  ['Alex Kim', 'alex@umbrella.co', 'Umbrella Corp', 'Qualified'],
  ['Emma Wilson', 'emma@stark.io', 'Stark Industries', 'New'],
  ['David Lee', 'david@waystar.com', 'Waystar', 'Contacted'],
  ['Priya Patel', 'priya@hooli.io', 'Hooli', 'New'],
  ['Tom Zhang', 'tom@weyland.co', 'Weyland Corp', 'Qualified'],
  ['Nina Kowalski', 'nina@oscorp.io', 'Oscorp', 'Contacted'],
  ['Ryan Murphy', 'ryan@massiveD.co', 'Massive Dynamic', 'New'],
] as const

const MOCK_MD_SOURCE = `# Meeting Notes

## Action Items

- Review Q1 metrics with Sarah
- Update API documentation
- Schedule design review for v2.0

## Discussion Points

The team agreed to prioritize the new onboarding flow. Key decisions:

1. Migrate to the new auth provider by end of March
2. Ship the dashboard redesign in two phases
3. Add automated testing for all critical paths

## Next Steps

Follow up with engineering on the timeline for the API v2 migration. Draft the proposal for the board meeting next week.`

const MOCK_KB_COLUMNS = ['Name', 'Size', 'Tokens', 'Chunks', 'Status'] as const

const KB_FILE_ICONS: Record<string, React.ComponentType<SVGProps<SVGSVGElement>>> = {
  pdf: PdfIcon,
  md: MarkdownIcon,
  csv: CsvIcon,
  json: JsonIcon,
}

function getKBFileIcon(filename: string) {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  return KB_FILE_ICONS[ext] ?? File
}

const MOCK_KB_DATA = [
  ['product-specs.pdf', '4.2 MB', '12.4k', '86', 'enabled'],
  ['eng-handbook.md', '1.8 MB', '8.2k', '54', 'enabled'],
  ['api-reference.json', '920 KB', '4.1k', '32', 'enabled'],
  ['release-notes.md', '340 KB', '2.8k', '18', 'enabled'],
  ['onboarding-guide.pdf', '2.1 MB', '6.5k', '42', 'processing'],
  ['data-export.csv', '560 KB', '3.4k', '24', 'enabled'],
  ['runbook.md', '280 KB', '1.9k', '14', 'enabled'],
  ['compliance.pdf', '180 KB', '1.2k', '8', 'disabled'],
  ['style-guide.md', '410 KB', '2.6k', '20', 'enabled'],
  ['metrics.csv', '1.4 MB', '5.8k', '38', 'enabled'],
] as const

const MD_COMPONENTS: Components = {
  h1: ({ children }) => (
    <p
      role='presentation'
      className='mb-4 border-[#E5E5E5] border-b pb-2 font-semibold text-[#1C1C1C] text-[20px]'
    >
      {children}
    </p>
  ),
  h2: ({ children }) => (
    <h2 className='mt-5 mb-3 border-[#E5E5E5] border-b pb-1.5 font-semibold text-[#1C1C1C] text-[16px]'>
      {children}
    </h2>
  ),
  ul: ({ children }) => <ul className='mb-3 list-disc pl-[24px]'>{children}</ul>,
  ol: ({ children }) => <ol className='mb-3 list-decimal pl-[24px]'>{children}</ol>,
  li: ({ children }) => (
    <li className='mb-1 text-[#1C1C1C] text-[14px] leading-[1.6]'>{children}</li>
  ),
  p: ({ children }) => <p className='mb-3 text-[#1C1C1C] text-[14px] leading-[1.6]'>{children}</p>,
}

function MockFullFiles() {
  const [source, setSource] = useState(MOCK_MD_SOURCE)

  return (
    <div className='flex h-full flex-col'>
      <div className='flex h-[44px] shrink-0 items-center border-[#E5E5E5] border-b px-[24px]'>
        <div className='flex items-center gap-[6px]'>
          <File className='h-[14px] w-[14px] text-[#999]' />
          <span className='text-[#999] text-[13px]'>Files</span>
          <span className='text-[#D4D4D4] text-[13px]'>/</span>
          <span className='font-medium text-[#1C1C1C] text-[13px]'>meeting-notes.md</span>
        </div>
      </div>

      <div className='flex flex-1 overflow-hidden'>
        <motion.div
          className='h-full w-1/2 shrink-0 overflow-hidden'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          <textarea
            value={source}
            onChange={(e) => setSource(e.target.value)}
            spellCheck={false}
            autoCorrect='off'
            className='h-full w-full resize-none overflow-auto whitespace-pre-wrap bg-transparent p-[24px] font-[300] font-mono text-[#1C1C1C] text-[12px] leading-[1.7] outline-none'
          />
        </motion.div>

        <div className='h-full w-px shrink-0 bg-[#E5E5E5]' />

        <motion.div
          className='h-full min-w-0 flex-1 overflow-hidden'
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4, delay: 0.5 }}
        >
          <div className='h-full overflow-auto p-[24px]'>
            <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
              {source}
            </ReactMarkdown>
          </div>
        </motion.div>
      </div>
    </div>
  )
}

const KB_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  enabled: { bg: '#DCFCE7', text: '#166534', label: 'Enabled' },
  disabled: { bg: '#F3F4F6', text: '#6B7280', label: 'Disabled' },
  processing: { bg: '#F3E8FF', text: '#7C3AED', label: 'Processing' },
}

function MockFullKnowledgeBase({ revealedRows }: { revealedRows: number }) {
  return (
    <div className='flex h-full flex-col'>
      <div className='flex h-[44px] shrink-0 items-center border-[#E5E5E5] border-b px-[24px]'>
        <div className='flex items-center gap-[6px]'>
          <Database className='h-[14px] w-[14px] text-[#999]' />
          <span className='text-[#999] text-[13px]'>Knowledge Base</span>
          <span className='text-[#D4D4D4] text-[13px]'>/</span>
          <span className='font-medium text-[#1C1C1C] text-[13px]'>Company KB</span>
        </div>
      </div>

      <div className='flex h-[36px] shrink-0 items-center border-[#E5E5E5] border-b px-[24px]'>
        <div className='flex items-center gap-[6px]'>
          <div className='flex h-[24px] items-center gap-[4px] rounded-[6px] border border-[#E5E5E5] px-[8px] text-[#999] text-[12px]'>
            Sort
          </div>
          <div className='flex h-[24px] items-center gap-[4px] rounded-[6px] border border-[#E5E5E5] px-[8px] text-[#999] text-[12px]'>
            Filter
          </div>
        </div>
      </div>

      <div className='flex-1 overflow-hidden'>
        <table className='w-full table-fixed border-separate border-spacing-0 text-[13px]'>
          <colgroup>
            <col style={{ width: 40 }} />
            {MOCK_KB_COLUMNS.map((col) => (
              <col key={col} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className='border-[#E5E5E5] border-r border-b bg-[#FAFAFA] px-[4px] py-[7px] text-center align-middle'>
                <div className='flex items-center justify-center'>
                  <div className='h-[13px] w-[13px] rounded-[2px] border border-[#D4D4D4]' />
                </div>
              </th>
              {MOCK_KB_COLUMNS.map((col) => (
                <th
                  key={col}
                  className='border-[#E5E5E5] border-r border-b bg-[#FAFAFA] px-[8px] py-[7px] text-left align-middle'
                >
                  <span className='font-base text-[#999] text-[13px]'>{col}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_KB_DATA.slice(0, revealedRows).map((row, i) => {
              const status = KB_STATUS_STYLES[row[4]] ?? KB_STATUS_STYLES.enabled
              const DocIcon = getKBFileIcon(row[0])
              return (
                <motion.tr
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                >
                  <td className='border-[#E5E5E5] border-r border-b px-[4px] py-[7px] text-center align-middle'>
                    <span className='text-[#999] text-[11px] tabular-nums'>{i + 1}</span>
                  </td>
                  <td className='border-[#E5E5E5] border-r border-b px-[8px] py-[7px] align-middle'>
                    <span className='flex items-center gap-[8px] text-[#1C1C1C] text-[13px]'>
                      <DocIcon className='h-[14px] w-[14px] shrink-0' />
                      <span className='truncate'>{row[0]}</span>
                    </span>
                  </td>
                  {row.slice(1, 4).map((cell, j) => (
                    <td
                      key={j}
                      className='border-[#E5E5E5] border-r border-b px-[8px] py-[7px] align-middle'
                    >
                      <span className='text-[#999] text-[13px]'>{cell}</span>
                    </td>
                  ))}
                  <td className='border-[#E5E5E5] border-r border-b px-[8px] py-[7px] align-middle'>
                    <span
                      className='inline-flex items-center rounded-full px-[8px] py-[2px] font-medium text-[11px]'
                      style={{ backgroundColor: status.bg, color: status.text }}
                    >
                      {status.label}
                    </span>
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

const MOCK_LOG_COLORS = [
  '#7C3AED',
  '#2563EB',
  '#059669',
  '#DC2626',
  '#D97706',
  '#7C3AED',
  '#0891B2',
]

const MOCK_LOG_DATA = [
  ['Email Bot', 'Mar 17, 2:14 PM', 'success', '$0.003', 'API', '1.2s'],
  ['Lead Scorer', 'Mar 17, 2:10 PM', 'success', '$0.008', 'Schedule', '3.4s'],
  ['Support Bot', 'Mar 17, 1:55 PM', 'error', '$0.002', 'Webhook', '0.8s'],
  ['Onboarding', 'Mar 17, 1:42 PM', 'success', '$0.005', 'Manual', '2.1s'],
  ['Pipeline', 'Mar 17, 1:30 PM', 'success', '$0.012', 'API', '4.6s'],
  ['Email Bot', 'Mar 17, 1:15 PM', 'success', '$0.003', 'Schedule', '1.1s'],
  ['Intake', 'Mar 17, 12:58 PM', 'success', '$0.006', 'Webhook', '2.8s'],
] as const

const LOG_STATUS_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  success: { bg: '#DCFCE7', text: '#166534', label: 'Success' },
  error: { bg: '#FEE2E2', text: '#991B1B', label: 'Error' },
}

interface MockLogDetail {
  output: string
  spans: { name: string; ms: number; depth: number }[]
}

const MOCK_LOG_DETAILS: MockLogDetail[] = [
  {
    output: '{\n  "result": "processed",\n  "emails": 3,\n  "status": "complete"\n}',
    spans: [
      { name: 'Agent Block', ms: 800, depth: 0 },
      { name: 'search_web', ms: 210, depth: 1 },
      { name: 'Function Block', ms: 180, depth: 0 },
    ],
  },
  {
    output: '{\n  "score": 87,\n  "label": "high",\n  "confidence": 0.94\n}',
    spans: [
      { name: 'Agent Block', ms: 2100, depth: 0 },
      { name: 'hubspot_get_contact', ms: 340, depth: 1 },
      { name: 'Function Block', ms: 180, depth: 0 },
      { name: 'Condition', ms: 50, depth: 0 },
    ],
  },
  {
    output: '{\n  "error": "timeout",\n  "message": "LLM request exceeded limit"\n}',
    spans: [
      { name: 'Agent Block', ms: 650, depth: 0 },
      { name: 'search_kb', ms: 120, depth: 1 },
    ],
  },
  {
    output: '{\n  "user": "james@globex.io",\n  "steps_completed": 4,\n  "status": "sent"\n}',
    spans: [
      { name: 'Agent Block', ms: 980, depth: 0 },
      { name: 'send_email', ms: 290, depth: 1 },
      { name: 'Function Block', ms: 210, depth: 0 },
      { name: 'Agent Block', ms: 420, depth: 0 },
    ],
  },
  {
    output: '{\n  "records_processed": 142,\n  "inserted": 138,\n  "errors": 4\n}',
    spans: [
      { name: 'Agent Block', ms: 1800, depth: 0 },
      { name: 'salesforce_query', ms: 820, depth: 1 },
      { name: 'Function Block', ms: 340, depth: 0 },
      { name: 'Agent Block', ms: 1200, depth: 0 },
      { name: 'insert_rows', ms: 610, depth: 1 },
    ],
  },
  {
    output: '{\n  "result": "processed",\n  "emails": 1,\n  "status": "complete"\n}',
    spans: [
      { name: 'Agent Block', ms: 720, depth: 0 },
      { name: 'gmail_read', ms: 190, depth: 1 },
      { name: 'Function Block', ms: 160, depth: 0 },
    ],
  },
  {
    output: '{\n  "ticket_id": "TKT-4291",\n  "priority": "medium",\n  "assigned": "support"\n}',
    spans: [
      { name: 'Agent Block', ms: 1400, depth: 0 },
      { name: 'classify_intent', ms: 380, depth: 1 },
      { name: 'Function Block', ms: 220, depth: 0 },
      { name: 'Agent Block', ms: 780, depth: 0 },
    ],
  },
]

const MOCK_LOG_DETAIL_MAX_MS = MOCK_LOG_DETAILS.map((d) => Math.max(...d.spans.map((s) => s.ms)))

function MockFullLogs({ revealedRows }: { revealedRows: number }) {
  const [showSidebar, setShowSidebar] = useState(false)
  const [selectedRow, setSelectedRow] = useState(0)

  useEffect(() => {
    if (revealedRows < MOCK_LOG_DATA.length) return
    const timer = setTimeout(() => setShowSidebar(true), 400)
    return () => clearTimeout(timer)
  }, [revealedRows])

  return (
    <div className='relative flex h-full'>
      <div className='flex min-w-0 flex-1 flex-col'>
        <div className='flex h-[44px] shrink-0 items-center border-[#E5E5E5] border-b px-[24px]'>
          <div className='flex items-center gap-[6px]'>
            <Library className='h-[14px] w-[14px] text-[#999]' />
            <span className='font-medium text-[#1C1C1C] text-[13px]'>Logs</span>
          </div>
        </div>

        <div className='flex-1 overflow-hidden'>
          <table className='w-full table-fixed text-[13px]'>
            <colgroup>
              {['Workflow', 'Date', 'Status', 'Cost', 'Trigger', 'Duration'].map((col) => (
                <col key={col} />
              ))}
            </colgroup>
            <thead className='shadow-[inset_0_-1px_0_#E5E5E5]'>
              <tr>
                {['Workflow', 'Date', 'Status', 'Cost', 'Trigger', 'Duration'].map((col) => (
                  <th key={col} className='h-10 px-[24px] py-[10px] text-left align-middle'>
                    <span className='font-base text-[#999] text-[13px]'>{col}</span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {MOCK_LOG_DATA.slice(0, revealedRows).map((row, i) => {
                const statusStyle = LOG_STATUS_STYLES[row[2]] ?? LOG_STATUS_STYLES.success
                const isSelected = showSidebar && i === selectedRow
                return (
                  <motion.tr
                    key={i}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.2, ease: 'easeOut' }}
                    className={cn(
                      'cursor-pointer',
                      isSelected ? 'bg-[#F5F5F5]' : 'hover:bg-[#FAFAFA]'
                    )}
                    onClick={() => setSelectedRow(i)}
                  >
                    <td className='px-[24px] py-[10px] align-middle'>
                      <span className='flex items-center gap-[12px] font-medium text-[#1C1C1C] text-[14px]'>
                        <div
                          className='h-[10px] w-[10px] shrink-0 rounded-[3px] border-[1.5px]'
                          style={{
                            backgroundColor: MOCK_LOG_COLORS[i],
                            borderColor: `${MOCK_LOG_COLORS[i]}60`,
                            backgroundClip: 'padding-box',
                          }}
                        />
                        <span className='truncate'>{row[0]}</span>
                      </span>
                    </td>
                    <td className='px-[24px] py-[10px] align-middle'>
                      <span className='font-medium text-[#999] text-[14px]'>{row[1]}</span>
                    </td>
                    <td className='px-[24px] py-[10px] align-middle'>
                      <span
                        className='inline-flex items-center rounded-full px-[8px] py-[2px] font-medium text-[11px]'
                        style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}
                      >
                        {statusStyle.label}
                      </span>
                    </td>
                    <td className='px-[24px] py-[10px] align-middle'>
                      <span className='font-medium text-[#999] text-[14px]'>{row[3]}</span>
                    </td>
                    <td className='px-[24px] py-[10px] align-middle'>
                      <span className='rounded-[4px] bg-[#F5F5F5] px-[6px] py-[2px] text-[#666] text-[11px]'>
                        {row[4]}
                      </span>
                    </td>
                    <td className='px-[24px] py-[10px] align-middle'>
                      <span className='font-medium text-[#999] text-[14px]'>{row[5]}</span>
                    </td>
                  </motion.tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <motion.div
        className='absolute top-0 right-0 bottom-0 z-10 border-[#E5E5E5] border-l bg-white'
        initial={{ x: '100%' }}
        animate={{ x: showSidebar ? 0 : '100%' }}
        transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
        style={{ width: '45%' }}
      >
        <MockLogDetailsSidebar
          selectedRow={selectedRow}
          onPrev={() => setSelectedRow((r) => Math.max(0, r - 1))}
          onNext={() => setSelectedRow((r) => Math.min(MOCK_LOG_DATA.length - 1, r + 1))}
        />
      </motion.div>
    </div>
  )
}

interface MockLogDetailsSidebarProps {
  selectedRow: number
  onPrev: () => void
  onNext: () => void
}

function MockLogDetailsSidebar({ selectedRow, onPrev, onNext }: MockLogDetailsSidebarProps) {
  const row = MOCK_LOG_DATA[selectedRow]
  const detail = MOCK_LOG_DETAILS[selectedRow]
  const statusStyle = LOG_STATUS_STYLES[row[2]] ?? LOG_STATUS_STYLES.success
  const [date, time] = row[1].split(', ')
  const color = MOCK_LOG_COLORS[selectedRow]
  const maxMs = MOCK_LOG_DETAIL_MAX_MS[selectedRow]
  const isPrevDisabled = selectedRow === 0
  const isNextDisabled = selectedRow === MOCK_LOG_DATA.length - 1

  return (
    <div className='flex h-full flex-col overflow-y-auto px-[14px] pt-[12px]'>
      <div className='flex items-center justify-between'>
        <span className='font-medium text-[#1C1C1C] text-[14px]'>Log Details</span>
        <div className='flex items-center gap-[1px]'>
          <button
            type='button'
            onClick={onPrev}
            disabled={isPrevDisabled}
            className={cn(
              'flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-[#999]',
              isPrevDisabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-[#F5F5F5]'
            )}
          >
            <ChevronDown className='h-[14px] w-[14px] rotate-180' />
          </button>
          <button
            type='button'
            onClick={onNext}
            disabled={isNextDisabled}
            className={cn(
              'flex h-[24px] w-[24px] items-center justify-center rounded-[4px] text-[#999]',
              isNextDisabled ? 'cursor-not-allowed opacity-40' : 'hover:bg-[#F5F5F5]'
            )}
          >
            <ChevronDown className='h-[14px] w-[14px]' />
          </button>
        </div>
      </div>

      <div className='mt-[20px] flex flex-col gap-[10px]'>
        <div className='flex items-center gap-[16px] px-[1px]'>
          <div className='flex w-[120px] shrink-0 flex-col gap-[8px]'>
            <span className='font-medium text-[#999] text-[12px]'>Timestamp</span>
            <div className='flex items-center gap-[6px]'>
              <span className='font-medium text-[#666] text-[13px]'>{date}</span>
              <span className='font-medium text-[#666] text-[13px]'>{time}</span>
            </div>
          </div>
          <div className='flex min-w-0 flex-1 flex-col gap-[8px]'>
            <span className='font-medium text-[#999] text-[12px]'>Workflow</span>
            <div className='flex items-center gap-[8px]'>
              <div
                className='h-[10px] w-[10px] shrink-0 rounded-[3px] border-[1.5px]'
                style={{
                  backgroundColor: color,
                  borderColor: `${color}60`,
                  backgroundClip: 'padding-box',
                }}
              />
              <span className='truncate font-medium text-[#666] text-[13px]'>{row[0]}</span>
            </div>
          </div>
        </div>

        <div className='flex flex-col'>
          <div className='flex h-[42px] items-center justify-between border-[#E5E5E5] border-b px-[8px]'>
            <span className='font-medium text-[#999] text-[12px]'>Level</span>
            <span
              className='inline-flex items-center rounded-full px-[8px] py-[2px] font-medium text-[11px]'
              style={{ backgroundColor: statusStyle.bg, color: statusStyle.text }}
            >
              {statusStyle.label}
            </span>
          </div>
          <div className='flex h-[42px] items-center justify-between border-[#E5E5E5] border-b px-[8px]'>
            <span className='font-medium text-[#999] text-[12px]'>Trigger</span>
            <span className='rounded-[4px] bg-[#F5F5F5] px-[6px] py-[2px] text-[#666] text-[11px]'>
              {row[4]}
            </span>
          </div>
          <div className='flex h-[42px] items-center justify-between px-[8px]'>
            <span className='font-medium text-[#999] text-[12px]'>Duration</span>
            <span className='font-medium text-[#666] text-[13px]'>{row[5]}</span>
          </div>
        </div>

        <div className='flex flex-col gap-[6px] rounded-[6px] border border-[#E5E5E5] bg-[#FAFAFA] px-[10px] py-[8px]'>
          <span className='font-medium text-[#999] text-[12px]'>Workflow Output</span>
          <div className='rounded-[6px] bg-[#F0F0F0] p-[10px] font-mono text-[#555] text-[11px] leading-[1.5]'>
            {detail.output}
          </div>
        </div>

        <div className='flex flex-col gap-[6px] rounded-[6px] border border-[#E5E5E5] bg-[#FAFAFA] px-[10px] py-[8px]'>
          <span className='font-medium text-[#999] text-[12px]'>Trace Spans</span>
          <div className='flex flex-col gap-[6px]'>
            {detail.spans.map((span, i) => (
              <div
                key={i}
                className={cn('flex flex-col gap-[3px]', span.depth === 1 && 'ml-[12px]')}
              >
                <div className='flex items-center justify-between'>
                  <span className='font-mono text-[#555] text-[11px]'>{span.name}</span>
                  <span className='font-medium text-[#999] text-[11px]'>{span.ms}ms</span>
                </div>
                <div className='h-[4px] w-full overflow-hidden rounded-full bg-[#F0F0F0]'>
                  <div
                    className='h-full rounded-full bg-[#2F6FED]'
                    style={{ width: `${(span.ms / maxMs) * 100}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

function MockFullTable({ revealedRows }: { revealedRows: number }) {
  const [selectedRow, setSelectedRow] = useState<number | null>(null)

  return (
    <div className='flex h-full flex-col'>
      <div className='flex h-[44px] shrink-0 items-center border-[#E5E5E5] border-b px-[24px]'>
        <div className='flex items-center gap-[6px]'>
          <Table className='h-[14px] w-[14px] text-[#999]' />
          <span className='text-[#999] text-[13px]'>Tables</span>
          <span className='text-[#D4D4D4] text-[13px]'>/</span>
          <span className='font-medium text-[#1C1C1C] text-[13px]'>Leads</span>
        </div>
      </div>

      <div className='flex h-[36px] shrink-0 items-center border-[#E5E5E5] border-b px-[24px]'>
        <div className='flex items-center gap-[6px]'>
          <div className='flex h-[24px] items-center gap-[4px] rounded-[6px] border border-[#E5E5E5] px-[8px] text-[#999] text-[12px]'>
            Sort
          </div>
          <div className='flex h-[24px] items-center gap-[4px] rounded-[6px] border border-[#E5E5E5] px-[8px] text-[#999] text-[12px]'>
            Filter
          </div>
        </div>
      </div>

      <div className='flex-1 overflow-hidden'>
        <table className='w-full table-fixed border-separate border-spacing-0 text-[13px]'>
          <colgroup>
            <col style={{ width: 40 }} />
            {MOCK_TABLE_COLUMNS.map((col) => (
              <col key={col} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className='border-[#E5E5E5] border-r border-b bg-[#FAFAFA] px-[4px] py-[7px] text-center align-middle'>
                <div className='flex items-center justify-center'>
                  <div className='h-[13px] w-[13px] rounded-[2px] border border-[#D4D4D4]' />
                </div>
              </th>
              {MOCK_TABLE_COLUMNS.map((col) => (
                <th
                  key={col}
                  className='border-[#E5E5E5] border-r border-b bg-[#FAFAFA] px-[8px] py-[7px] text-left align-middle'
                >
                  <div className='flex items-center gap-[6px]'>
                    <ColumnTypeIcon />
                    <span className='font-medium text-[#1C1C1C] text-[13px]'>{col}</span>
                    <ChevronDown className='ml-auto h-[7px] w-[9px] shrink-0 text-[#CCC]' />
                  </div>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {MOCK_TABLE_DATA.slice(0, revealedRows).map((row, i) => {
              const isSelected = selectedRow === i
              return (
                <motion.tr
                  key={i}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.2, ease: 'easeOut' }}
                  className='cursor-pointer'
                  onClick={() => setSelectedRow(i)}
                >
                  <td
                    className={cn(
                      'border-[#E5E5E5] border-r border-b px-[4px] py-[7px] text-center align-middle',
                      isSelected ? 'bg-[rgba(37,99,235,0.06)]' : 'hover:bg-[#FAFAFA]'
                    )}
                  >
                    <span className='text-[#999] text-[11px] tabular-nums'>{i + 1}</span>
                  </td>
                  {row.map((cell, j) => (
                    <td
                      key={j}
                      className={cn(
                        'relative border-[#E5E5E5] border-r border-b px-[8px] py-[7px] align-middle',
                        isSelected ? 'bg-[rgba(37,99,235,0.06)]' : 'hover:bg-[#FAFAFA]'
                      )}
                    >
                      {isSelected && (
                        <div
                          className={cn(
                            '-bottom-px -top-px pointer-events-none absolute left-0 z-[5] border-[#1a5cf6] border-t border-b',
                            j === 0 && 'border-l',
                            j === row.length - 1 ? '-right-px border-r' : 'right-0'
                          )}
                        />
                      )}
                      <span className='block truncate text-[#1C1C1C] text-[13px]'>{cell}</span>
                    </td>
                  ))}
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function ColumnTypeIcon() {
  return (
    <svg
      className='h-3 w-3 shrink-0 text-[#999]'
      viewBox='0 0 16 16'
      fill='none'
      stroke='currentColor'
      strokeWidth='1.5'
    >
      <path d='M3 4h10M3 8h7M3 12h5' strokeLinecap='round' />
    </svg>
  )
}

// ─── Default Preview (scattered icons for other tabs) ─────────────

interface IconEntry {
  key: string
  icon: React.ComponentType<SVGProps<SVGSVGElement>>
  label: string
  top: string
  left: string
  color?: string
}

const SCATTERED_ICONS: IconEntry[] = [
  { key: 'slack', icon: SlackIcon, label: 'Slack', top: '8%', left: '14%' },
  { key: 'openai', icon: OpenAIIcon, label: 'OpenAI', top: '8%', left: '44%' },
  { key: 'anthropic', icon: AnthropicIcon, label: 'Anthropic', top: '10%', left: '78%' },
  { key: 'gmail', icon: GmailIcon, label: 'Gmail', top: '24%', left: '90%' },
  { key: 'salesforce', icon: SalesforceIcon, label: 'Salesforce', top: '28%', left: '6%' },
  {
    key: 'table',
    icon: Table,
    label: 'Tables',
    top: '22%',
    left: '30%',
    color: 'var(--text-icon)',
  },
  { key: 'xai', icon: xAIIcon, label: 'xAI', top: '26%', left: '66%' },
  {
    key: 'hubspot',
    icon: HubspotIcon,
    label: 'HubSpot',
    top: '55%',
    left: '4%',
    color: '#FF7A59',
  },
  {
    key: 'database',
    icon: Database,
    label: 'Database',
    top: '74%',
    left: '68%',
    color: 'var(--text-icon)',
  },
  { key: 'file', icon: File, label: 'Files', top: '70%', left: '18%', color: 'var(--text-icon)' },
  { key: 'gemini', icon: GeminiIcon, label: 'Gemini', top: '58%', left: '86%' },
  {
    key: 'logs',
    icon: Library,
    label: 'Logs',
    top: '86%',
    left: '44%',
    color: 'var(--text-icon)',
  },
  { key: 'groq', icon: GroqIcon, label: 'Groq', top: '90%', left: '82%' },
]

const EXPLODE_STAGGER = 0.04
const EXPLODE_BASE_DELAY = 0.1

function DefaultPreview() {
  const containerRef = useRef<HTMLDivElement>(null)
  const inView = useInView(containerRef, { once: true, margin: '-80px' })

  return (
    <div ref={containerRef} className='relative h-[350px] w-full overflow-hidden md:h-[560px]'>
      <div
        aria-hidden='true'
        className='absolute inset-0'
        style={{
          backgroundImage: 'radial-gradient(circle, #D4D4D4 0.75px, transparent 0.75px)',
          backgroundSize: '12px 12px',
          maskImage: 'radial-gradient(ellipse 70% 65% at 48% 50%, black 30%, transparent 80%)',
          WebkitMaskImage:
            'radial-gradient(ellipse 70% 65% at 48% 50%, black 30%, transparent 80%)',
        }}
      />

      {SCATTERED_ICONS.map(({ key, icon: Icon, label, top, left, color }, index) => {
        const explodeDelay = EXPLODE_BASE_DELAY + index * EXPLODE_STAGGER

        return (
          <motion.div
            key={key}
            className='absolute flex items-center justify-center rounded-xl border border-[#E5E5E5] bg-white p-[10px] shadow-[0_2px_4px_0_rgba(0,0,0,0.06)]'
            initial={{ top: '50%', left: '50%', opacity: 0, scale: 0, x: '-50%', y: '-50%' }}
            animate={inView ? { top, left, opacity: 1, scale: 1, x: '-50%', y: '-50%' } : undefined}
            transition={{
              type: 'spring',
              stiffness: 50,
              damping: 12,
              delay: explodeDelay,
            }}
            style={{ color }}
            aria-label={label}
          >
            <Icon className='h-6 w-6' />
          </motion.div>
        )
      })}

      <motion.div
        className='absolute top-1/2 left-[48%]'
        initial={{ opacity: 0, x: '-50%', y: '-50%' }}
        animate={inView ? { opacity: 1, x: '-50%', y: '-50%' } : undefined}
        transition={{ duration: 0.4, ease: 'easeOut', delay: 0 }}
      >
        <div className='flex h-[36px] items-center gap-[8px] rounded-[8px] border border-[#E5E5E5] bg-white px-[10px] shadow-[0_2px_6px_0_rgba(0,0,0,0.08)]'>
          <div className='flex h-[22px] w-[22px] flex-shrink-0 items-center justify-center rounded-[5px] bg-[#1e1e1e]'>
            <svg width='11' height='11' viewBox='0 0 10 10' fill='none'>
              <path
                d='M1 9C1 4.58 4.58 1 9 1'
                stroke='white'
                strokeWidth='1.8'
                strokeLinecap='round'
              />
            </svg>
          </div>
          <span className='whitespace-nowrap font-medium font-season text-[#1C1C1C] text-[13px] tracking-[0.02em]'>
            My Workspace
          </span>
          <ChevronDown className='h-[8px] w-[10px] flex-shrink-0 text-[#999]' />
        </div>
      </motion.div>
    </div>
  )
}
