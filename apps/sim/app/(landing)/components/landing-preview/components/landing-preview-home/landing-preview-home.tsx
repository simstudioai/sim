'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp, Table } from 'lucide-react'
import { Blimp, Checkbox, ChevronDown } from '@/components/emcn'
import { TypeBoolean, TypeNumber, TypeText } from '@/components/emcn/icons'
import { captureClientEvent } from '@/lib/posthog/client'
import { useLandingSubmit } from '@/app/(landing)/components/landing-preview/components/landing-preview-panel/landing-preview-panel'
import { EASE_OUT } from '@/app/(landing)/components/landing-preview/components/landing-preview-workflow/workflow-data'
import { useAnimatedPlaceholder } from '@/hooks/use-animated-placeholder'

const C = {
  SURFACE: '#292929',
  BORDER: '#3d3d3d',
  TEXT_PRIMARY: '#e6e6e6',
  TEXT_BODY: '#cdcdcd',
  TEXT_SECONDARY: '#b3b3b3',
  TEXT_TERTIARY: '#939393',
  TEXT_ICON: '#939393',
} as const

const AUTO_PROMPT = 'Analyze our customer leads and identify the top prospects'

const MOCK_RESPONSE =
  'I analyzed your **Customer Leads** table and found **3 top prospects** with the highest lead scores:\n\n1. **Carol Davis** (StartupCo) — Score: 94\n2. **Frank Lee** (Ventures) — Score: 88\n3. **Alice Johnson** (Acme Corp) — Score: 87\n\nAll three are qualified leads. Want me to draft outreach emails?'

const HOME_TYPE_MS = 40
const HOME_TYPE_START_MS = 600
const TOOL_CALL_DELAY_MS = 500
const RESPONSE_DELAY_MS = 800
const RESOURCE_PANEL_DELAY_MS = 600

const MINI_TABLE_COLUMNS = [
  { id: 'name', label: 'Name', type: 'text' as const, width: '32%' },
  { id: 'company', label: 'Company', type: 'text' as const, width: '30%' },
  { id: 'score', label: 'Score', type: 'number' as const, width: '18%' },
  { id: 'qualified', label: 'Qualified', type: 'boolean' as const, width: '20%' },
]

const MINI_TABLE_ROWS = [
  { name: 'Alice Johnson', company: 'Acme Corp', score: '87', qualified: 'true' },
  { name: 'Bob Williams', company: 'TechCo', score: '62', qualified: 'false' },
  { name: 'Carol Davis', company: 'StartupCo', score: '94', qualified: 'true' },
  { name: 'Dan Miller', company: 'BigCorp', score: '71', qualified: 'true' },
  { name: 'Eva Chen', company: 'Design IO', score: '45', qualified: 'false' },
  { name: 'Frank Lee', company: 'Ventures', score: '88', qualified: 'true' },
]

const COLUMN_TYPE_ICONS = {
  text: TypeText,
  number: TypeNumber,
  boolean: TypeBoolean,
} as const

interface LandingPreviewHomeProps {
  autoType?: boolean
}

type ChatPhase = 'input' | 'sent' | 'tool-call' | 'responding' | 'done'

/**
 * Landing preview replica of the workspace Home view.
 *
 * When `autoType` is true, automatically types a prompt, sends it,
 * shows a mothership agent group with tool calls, types a response,
 * and opens a resource panel — matching the real workspace chat UI.
 */
export const LandingPreviewHome = memo(function LandingPreviewHome({
  autoType = false,
}: LandingPreviewHomeProps) {
  const landingSubmit = useLandingSubmit()
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const animatedPlaceholder = useAnimatedPlaceholder()

  const [chatPhase, setChatPhase] = useState<ChatPhase>('input')
  const [responseTypedLength, setResponseTypedLength] = useState(0)
  const [showResourcePanel, setShowResourcePanel] = useState(false)
  const [toolsExpanded, setToolsExpanded] = useState(true)

  const typeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const responseIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearAllTimers = useCallback(() => {
    for (const t of timersRef.current) clearTimeout(t)
    timersRef.current = []
    if (typeIntervalRef.current) clearInterval(typeIntervalRef.current)
    if (responseIntervalRef.current) clearInterval(responseIntervalRef.current)
    typeIntervalRef.current = null
    responseIntervalRef.current = null
  }, [])

  useEffect(() => {
    if (!autoType) return

    setChatPhase('input')
    setResponseTypedLength(0)
    setShowResourcePanel(false)
    setToolsExpanded(true)
    setInputValue('')

    const t1 = setTimeout(() => {
      let idx = 0
      typeIntervalRef.current = setInterval(() => {
        idx++
        setInputValue(AUTO_PROMPT.slice(0, idx))
        if (idx >= AUTO_PROMPT.length) {
          if (typeIntervalRef.current) clearInterval(typeIntervalRef.current)
          typeIntervalRef.current = null

          const t2 = setTimeout(() => {
            setChatPhase('sent')

            const t3 = setTimeout(() => {
              setChatPhase('tool-call')

              const t4 = setTimeout(() => {
                setShowResourcePanel(true)
              }, RESOURCE_PANEL_DELAY_MS)
              timersRef.current.push(t4)

              const t5 = setTimeout(() => {
                setToolsExpanded(false)
                setChatPhase('responding')
                let rIdx = 0
                responseIntervalRef.current = setInterval(() => {
                  rIdx++
                  setResponseTypedLength(rIdx)
                  if (rIdx >= MOCK_RESPONSE.length) {
                    if (responseIntervalRef.current) clearInterval(responseIntervalRef.current)
                    responseIntervalRef.current = null
                    setChatPhase('done')
                  }
                }, 8)
              }, TOOL_CALL_DELAY_MS + RESPONSE_DELAY_MS)
              timersRef.current.push(t5)
            }, TOOL_CALL_DELAY_MS)
            timersRef.current.push(t3)
          }, 400)
          timersRef.current.push(t2)
        }
      }, HOME_TYPE_MS)
    }, HOME_TYPE_START_MS)
    timersRef.current.push(t1)

    return clearAllTimers
  }, [autoType, clearAllTimers])

  const isEmpty = inputValue.trim().length === 0

  const handleSubmit = useCallback(() => {
    if (isEmpty) return
    captureClientEvent('landing_prompt_submitted', {})
    landingSubmit(inputValue)
  }, [isEmpty, inputValue, landingSubmit])

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        handleSubmit()
      }
    },
    [handleSubmit]
  )

  const handleInput = useCallback((e: React.FormEvent<HTMLTextAreaElement>) => {
    const target = e.target as HTMLTextAreaElement
    target.style.height = 'auto'
    target.style.height = `${Math.min(target.scrollHeight, 200)}px`
  }, [])

  if (chatPhase !== 'input') {
    const isResponding = chatPhase === 'responding' || chatPhase === 'done'
    const showToolCall = chatPhase === 'tool-call' || isResponding

    return (
      <div className='flex min-w-0 flex-1 overflow-hidden'>
        {/* Chat area — matches mothership-view layout */}
        <div className='min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-6 pt-4 pb-8'>
          <div className='mx-auto max-w-[42rem] space-y-6'>
            {/* User message — rounded bubble, right-aligned */}
            <motion.div
              className='flex flex-col items-end gap-[6px] pt-3'
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.3, ease: EASE_OUT }}
            >
              <div className='max-w-[70%] overflow-hidden rounded-[16px] bg-[#363636] px-3.5 py-2'>
                <p
                  className='font-body text-[14px] leading-[1.5]'
                  style={{ color: C.TEXT_PRIMARY }}
                >
                  {AUTO_PROMPT}
                </p>
              </div>
            </motion.div>

            {/* Assistant — no bubble, full-width prose */}
            <AnimatePresence>
              {showToolCall && (
                <motion.div
                  className='space-y-2.5'
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.3, ease: EASE_OUT }}
                >
                  {/* Agent group header — icon + label + chevron */}
                  <button
                    type='button'
                    onClick={() => setToolsExpanded((p) => !p)}
                    className='flex cursor-pointer items-center gap-2'
                  >
                    <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>
                      <Blimp className='h-[16px] w-[16px]' style={{ color: C.TEXT_ICON }} />
                    </div>
                    <span className='font-base text-sm' style={{ color: C.TEXT_BODY }}>
                      Mothership
                    </span>
                    <ChevronDown
                      className='h-[7px] w-[9px] transition-transform duration-150'
                      style={{
                        color: C.TEXT_ICON,
                        transform: toolsExpanded ? 'rotate(0deg)' : 'rotate(-90deg)',
                      }}
                    />
                  </button>

                  {/* Tool call items — collapsible */}
                  <div
                    className='grid transition-[grid-template-rows] duration-200 ease-out'
                    style={{
                      gridTemplateRows: toolsExpanded ? '1fr' : '0fr',
                    }}
                  >
                    <div className='overflow-hidden'>
                      <div className='flex flex-col gap-1.5 pt-0.5'>
                        <ToolCallRow
                          icon={
                            <Table
                              className='h-[15px] w-[15px]'
                              style={{ color: C.TEXT_TERTIARY }}
                            />
                          }
                          title='Read Customer Leads'
                        />
                      </div>
                    </div>
                  </div>

                  {/* Response prose — full width, no card */}
                  {isResponding && (
                    <motion.div
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ duration: 0.2, ease: EASE_OUT }}
                    >
                      <ChatMarkdown
                        content={MOCK_RESPONSE}
                        visibleLength={responseTypedLength}
                        isTyping={chatPhase === 'responding'}
                      />
                    </motion.div>
                  )}
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </div>

        {/* Resource panel — slides in from right */}
        <AnimatePresence>
          {showResourcePanel && (
            <motion.div
              className='hidden h-full flex-shrink-0 overflow-hidden border-[#2c2c2c] border-l lg:flex'
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: '55%', opacity: 1 }}
              transition={{ duration: 0.35, ease: EASE_OUT }}
            >
              <MiniTablePanel />
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    )
  }

  return (
    <div className='flex min-w-0 flex-1 flex-col items-center justify-center px-6 pb-[2vh]'>
      <motion.p
        role='presentation'
        className='mb-6 max-w-[42rem] font-[430] font-season text-[32px] tracking-[-0.02em]'
        style={{ color: C.TEXT_PRIMARY }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, ease: EASE_OUT }}
      >
        What should we get done?
      </motion.p>

      <motion.div
        className='w-full max-w-[32rem]'
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4, delay: 0.1, ease: EASE_OUT }}
      >
        <div
          className='cursor-text rounded-[20px] border px-2.5 py-2'
          style={{ borderColor: C.BORDER, backgroundColor: C.SURFACE }}
          onClick={() => textareaRef.current?.focus()}
        >
          <textarea
            ref={textareaRef}
            value={inputValue}
            onChange={(e) => {
              if (!autoType) setInputValue(e.target.value)
            }}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder={animatedPlaceholder}
            rows={1}
            readOnly={autoType}
            className='m-0 box-border min-h-[24px] w-full resize-none overflow-y-auto border-0 bg-transparent px-1 py-1 font-body text-[15px] leading-[24px] tracking-[-0.015em] outline-none placeholder:font-[380] placeholder:text-[#787878] focus-visible:ring-0'
            style={{
              color: C.TEXT_PRIMARY,
              caretColor: autoType ? 'transparent' : C.TEXT_PRIMARY,
              maxHeight: '200px',
            }}
          />
          <div className='flex items-center justify-end'>
            <button
              type='button'
              onClick={handleSubmit}
              disabled={isEmpty}
              className='flex h-[28px] w-[28px] items-center justify-center rounded-full border-0 p-0 transition-colors'
              style={{
                background: isEmpty ? '#808080' : '#e0e0e0',
                cursor: isEmpty ? 'not-allowed' : 'pointer',
              }}
            >
              <ArrowUp size={16} strokeWidth={2.25} color='#1b1b1b' />
            </button>
          </div>
        </div>
      </motion.div>
    </div>
  )
})

/**
 * Single tool call row matching the real `ToolCallItem` layout:
 * indented icon + display title.
 */
function ToolCallRow({ icon, title }: { icon: React.ReactNode; title: string }) {
  return (
    <div className='flex items-center gap-[8px] pl-[24px]'>
      <div className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center'>{icon}</div>
      <span className='font-base text-[13px]' style={{ color: C.TEXT_SECONDARY }}>
        {title}
      </span>
    </div>
  )
}

/**
 * Renders chat response as full-width prose with bold markdown
 * and progressive reveal for the typing effect.
 */
function ChatMarkdown({
  content,
  visibleLength,
  isTyping,
}: {
  content: string
  visibleLength: number
  isTyping: boolean
}) {
  const visible = content.slice(0, visibleLength)
  const rendered = visible.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>').replace(/\n/g, '<br />')

  return (
    <div className='font-body text-[14px] leading-[1.6]' style={{ color: C.TEXT_PRIMARY }}>
      <span dangerouslySetInnerHTML={{ __html: rendered }} />
      {isTyping && (
        <motion.span
          className='inline-block h-[14px] w-[1.5px] translate-y-[2px] bg-[#e6e6e6]'
          animate={{ opacity: [1, 0] }}
          transition={{
            duration: 0.6,
            repeat: Number.POSITIVE_INFINITY,
            repeatType: 'reverse',
          }}
        />
      )}
    </div>
  )
}

/**
 * Mini Customer Leads table panel matching the resource panel pattern.
 */
function MiniTablePanel() {
  return (
    <div className='flex h-full w-full flex-col bg-[var(--landing-bg)]'>
      <div className='flex items-center gap-2 border-[#2c2c2c] border-b px-3 py-2'>
        <Table className='h-[14px] w-[14px]' style={{ color: C.TEXT_ICON }} />
        <span className='font-medium text-sm' style={{ color: C.TEXT_PRIMARY }}>
          Customer Leads
        </span>
      </div>
      <div className='min-h-0 flex-1 overflow-auto'>
        <table className='w-full table-fixed border-separate border-spacing-0 text-[12px]'>
          <colgroup>
            {MINI_TABLE_COLUMNS.map((col) => (
              <col key={col.id} style={{ width: col.width }} />
            ))}
          </colgroup>
          <thead className='sticky top-0 z-10'>
            <tr>
              {MINI_TABLE_COLUMNS.map((col) => {
                const Icon = COLUMN_TYPE_ICONS[col.type]
                return (
                  <th
                    key={col.id}
                    className='border-[#2c2c2c] border-r border-b bg-[#1e1e1e] p-0 text-left'
                  >
                    <div className='flex items-center gap-1 px-2 py-1.5'>
                      <Icon className='h-3 w-3 shrink-0' style={{ color: C.TEXT_ICON }} />
                      <span className='font-medium text-[11px]' style={{ color: C.TEXT_PRIMARY }}>
                        {col.label}
                      </span>
                      <ChevronDown
                        className='ml-auto h-[6px] w-[8px]'
                        style={{ color: '#636363' }}
                      />
                    </div>
                  </th>
                )
              })}
            </tr>
          </thead>
          <tbody>
            {MINI_TABLE_ROWS.map((row, i) => (
              <motion.tr
                key={i}
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                transition={{ duration: 0.2, delay: i * 0.04, ease: EASE_OUT }}
              >
                {MINI_TABLE_COLUMNS.map((col) => {
                  const val = row[col.id as keyof typeof row]
                  return (
                    <td
                      key={col.id}
                      className='border-[#2c2c2c] border-r border-b px-2 py-1.5'
                      style={{ color: C.TEXT_BODY }}
                    >
                      {col.type === 'boolean' ? (
                        <div className='flex items-center justify-center'>
                          <Checkbox
                            size='sm'
                            checked={val === 'true'}
                            className='pointer-events-none'
                          />
                        </div>
                      ) : (
                        <span className='block truncate'>{val}</span>
                      )}
                    </td>
                  )
                })}
              </motion.tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
