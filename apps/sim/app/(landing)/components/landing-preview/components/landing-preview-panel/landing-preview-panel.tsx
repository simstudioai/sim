'use client'

import { memo, useCallback, useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ArrowUp } from 'lucide-react'
import dynamic from 'next/dynamic'
import { useRouter } from 'next/navigation'
import { createPortal } from 'react-dom'
import { Blimp, BubbleChatPreview, ChevronDown, MoreHorizontal, Play } from '@/components/emcn'
import { AgentIcon, HubspotIcon, OpenAIIcon, SalesforceIcon } from '@/components/icons'
import { LandingPromptStorage } from '@/lib/core/utils/browser-storage'
import { captureClientEvent } from '@/lib/posthog/client'
import {
  EASE_OUT,
  type EditorPromptData,
  getEditorPrompt,
  getWorkflowAnimationTiming,
  type PreviewWorkflow,
  TYPE_INTERVAL_MS,
  TYPE_START_BUFFER_MS,
} from '@/app/(landing)/components/landing-preview/components/landing-preview-workflow/workflow-data'
import { trackLandingCta } from '@/app/(landing)/landing-analytics'

const AuthModal = dynamic(() =>
  import('@/app/(landing)/components/auth-modal/auth-modal').then((m) => m.AuthModal)
)

type PanelTab = 'copilot' | 'editor'

const EDITOR_BLOCK_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  agent: AgentIcon,
  mothership: Blimp,
}

const TABS_WITH_TOOLBAR: { id: PanelTab | 'toolbar'; label: string; disabled?: boolean }[] = [
  { id: 'copilot', label: 'Copilot' },
  { id: 'toolbar', label: 'Toolbar', disabled: true },
  { id: 'editor', label: 'Editor' },
]

/**
 * Stores the prompt in browser storage and redirects to /signup.
 * Shared by both the copilot panel and the landing home view.
 */
export function useLandingSubmit() {
  const router = useRouter()
  return useCallback(
    (text: string) => {
      const trimmed = text.trim()
      if (!trimmed) return
      LandingPromptStorage.store(trimmed)
      trackLandingCta({
        label: 'Prompt submit',
        section: 'landing_preview',
        destination: '/signup',
      })
      router.push('/signup')
    },
    [router]
  )
}

interface LandingPreviewPanelProps {
  activeWorkflow?: PreviewWorkflow
  animationKey?: number
  onHighlightBlock?: (blockId: string | null) => void
}

/**
 * Workspace panel replica with switchable Copilot / Editor tabs.
 *
 * On every workflow switch (`animationKey` change):
 *  1. Resets to Copilot tab.
 *  2. Waits for blocks + edges to finish animating.
 *  3. Slides the tab indicator to Editor and types the agent's prompt.
 *  4. Highlights the agent block with the blue ring on the canvas.
 */
export const LandingPreviewPanel = memo(function LandingPreviewPanel({
  activeWorkflow,
  animationKey = 0,
  onHighlightBlock,
}: LandingPreviewPanelProps) {
  const landingSubmit = useLandingSubmit()
  const [inputValue, setInputValue] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const [cursorPos, setCursorPos] = useState<{ x: number; y: number } | null>(null)

  const [activeTab, setActiveTab] = useState<PanelTab>('copilot')
  const [typedLength, setTypedLength] = useState(0)

  const workflowRef = useRef(activeWorkflow)
  workflowRef.current = activeWorkflow
  const typeIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const editorPrompt = activeWorkflow ? getEditorPrompt(activeWorkflow) : null

  const userSwitchedTabRef = useRef(false)

  const handleTabSwitch = useCallback(
    (tab: PanelTab) => {
      userSwitchedTabRef.current = true
      setActiveTab(tab)
      if (tab === 'editor' && editorPrompt) {
        onHighlightBlock?.(editorPrompt.blockId)
      } else {
        onHighlightBlock?.(null)
      }
    },
    [editorPrompt, onHighlightBlock]
  )

  useEffect(() => {
    if (userSwitchedTabRef.current) return

    setActiveTab('copilot')
    setTypedLength(0)
    onHighlightBlock?.(null)
    if (typeIntervalRef.current) clearInterval(typeIntervalRef.current)

    const workflow = workflowRef.current
    if (!workflow) return

    const prompt = workflow ? getEditorPrompt(workflow) : null
    if (!prompt) return

    const { editorDelay } = getWorkflowAnimationTiming(workflow)

    const switchTimer = setTimeout(() => {
      if (userSwitchedTabRef.current) return
      setActiveTab('editor')
      onHighlightBlock?.(prompt.blockId)
    }, editorDelay)

    const typeTimer = setTimeout(() => {
      if (userSwitchedTabRef.current) return
      let charIndex = 0
      typeIntervalRef.current = setInterval(() => {
        charIndex++
        setTypedLength(charIndex)
        if (charIndex >= prompt.prompt.length) {
          if (typeIntervalRef.current) clearInterval(typeIntervalRef.current)
          typeIntervalRef.current = null
        }
      }, TYPE_INTERVAL_MS)
    }, editorDelay + TYPE_START_BUFFER_MS)

    return () => {
      clearTimeout(switchTimer)
      clearTimeout(typeTimer)
      if (typeIntervalRef.current) {
        clearInterval(typeIntervalRef.current)
        typeIntervalRef.current = null
      }
    }
  }, [animationKey, onHighlightBlock])

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

  return (
    <div className='flex h-full w-[280px] flex-shrink-0 flex-col bg-[#1e1e1e]'>
      <div className='flex h-full flex-col border-[#2c2c2c] border-l pt-3.5'>
        {/* Header */}
        <div className='flex flex-shrink-0 items-center justify-between px-2'>
          <div className='pointer-events-none flex gap-1.5'>
            <div className='flex h-[30px] w-[30px] items-center justify-center rounded-[5px] border border-[#3d3d3d] bg-[#363636]'>
              <MoreHorizontal className='h-[14px] w-[14px] text-[#e6e6e6]' />
            </div>
            <div className='flex h-[30px] w-[30px] items-center justify-center rounded-[5px] border border-[#3d3d3d] bg-[#363636]'>
              <BubbleChatPreview className='h-[14px] w-[14px] text-[#e6e6e6]' />
            </div>
          </div>
          <AuthModal defaultView='signup' source='landing_preview'>
            <button
              type='button'
              className='flex gap-1.5'
              onMouseMove={(e) => setCursorPos({ x: e.clientX, y: e.clientY })}
              onMouseLeave={() => setCursorPos(null)}
              onClick={() =>
                trackLandingCta({
                  label: 'Deploy',
                  section: 'landing_preview',
                  destination: 'auth_modal',
                })
              }
            >
              <div className='flex h-[30px] items-center rounded-[5px] bg-[#33C482] px-2.5 transition-colors hover:bg-[#2DAC72]'>
                <span className='font-medium text-[#1b1b1b] text-[12px]'>Deploy</span>
              </div>
              <div className='flex h-[30px] items-center gap-2 rounded-[5px] bg-[#33C482] px-2.5 transition-colors hover:bg-[#2DAC72]'>
                <Play className='h-[11.5px] w-[11.5px] text-[#1b1b1b]' />
                <span className='font-medium text-[#1b1b1b] text-[12px]'>Run</span>
              </div>
            </button>
          </AuthModal>
          {cursorPos &&
            createPortal(
              <div
                className='pointer-events-none fixed z-[9999]'
                style={{ left: cursorPos.x + 14, top: cursorPos.y + 14 }}
              >
                <div className='flex h-[4px]'>
                  <div className='h-full w-[8px] bg-[#2ABBF8]' />
                  <div className='h-full w-[14px] bg-[#2ABBF8] opacity-60' />
                  <div className='h-full w-[8px] bg-[#00F701]' />
                  <div className='h-full w-[16px] bg-[#00F701] opacity-60' />
                  <div className='h-full w-[8px] bg-[#FFCC02]' />
                  <div className='h-full w-[10px] bg-[#FFCC02] opacity-60' />
                  <div className='h-full w-[8px] bg-[#FA4EDF]' />
                  <div className='h-full w-[14px] bg-[#FA4EDF] opacity-60' />
                </div>
                <div className='flex items-center gap-[5px] bg-white px-1.5 py-1 font-medium text-[#1C1C1C] text-[11px]'>
                  Get started
                  <ChevronDown className='-rotate-90 h-[7px] w-[7px] text-[#1C1C1C]' />
                </div>
              </div>,
              document.body
            )}
        </div>

        {/* Tabs with sliding active indicator */}
        <div className='flex flex-shrink-0 items-center px-2 pt-3.5'>
          <div className='flex gap-1'>
            {TABS_WITH_TOOLBAR.map((tab) => {
              if (tab.disabled) {
                return (
                  <div
                    key={tab.id}
                    className='pointer-events-none flex h-[28px] items-center rounded-md border border-transparent px-2 py-[5px]'
                  >
                    <span className='font-medium text-[#787878] text-[12.5px]'>{tab.label}</span>
                  </div>
                )
              }
              const isActive = activeTab === tab.id
              return (
                <button
                  key={tab.id}
                  type='button'
                  onClick={() => handleTabSwitch(tab.id as PanelTab)}
                  className='relative flex h-[28px] items-center rounded-md border border-transparent px-2 py-[5px] font-medium text-[12.5px] transition-colors hover:border-[#3d3d3d] hover:bg-[#363636] hover:text-[#e6e6e6]'
                  style={{ color: isActive ? '#e6e6e6' : '#787878' }}
                >
                  {isActive && (
                    <motion.div
                      layoutId='panel-tab-indicator'
                      className='absolute inset-0 rounded-md border border-[#3d3d3d] bg-[#363636]'
                      transition={{ type: 'spring', stiffness: 400, damping: 30 }}
                    />
                  )}
                  <span className='relative z-10'>{tab.label}</span>
                </button>
              )
            })}
          </div>
        </div>

        {/* Tab content with cross-fade */}
        <div className='flex flex-1 flex-col overflow-hidden pt-3'>
          <AnimatePresence mode='wait'>
            {activeTab === 'copilot' && (
              <motion.div
                key='copilot'
                className='flex h-full flex-col'
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
              >
                <div className='pointer-events-none mx-[-1px] flex flex-shrink-0 items-center justify-between gap-2 border border-[#2c2c2c] bg-[#292929] px-3 py-1.5'>
                  <span className='min-w-0 flex-1 truncate font-medium text-[#e6e6e6] text-[14px]'>
                    New Chat
                  </span>
                </div>
                <div className='px-2 pt-3 pb-2'>
                  <div className='rounded-[4px] border border-[#3d3d3d] bg-[#292929] px-1.5 py-1.5'>
                    <textarea
                      ref={textareaRef}
                      value={inputValue}
                      onChange={(e) => setInputValue(e.target.value)}
                      onKeyDown={handleKeyDown}
                      placeholder='Build an AI agent...'
                      rows={2}
                      className='mb-1.5 min-h-[48px] w-full cursor-text resize-none border-0 bg-transparent px-0.5 py-1 font-base text-[#e6e6e6] text-sm leading-[1.25rem] placeholder-[#787878] caret-[#e6e6e6] outline-none'
                    />
                    <div className='flex items-center justify-end'>
                      <button
                        type='button'
                        onClick={handleSubmit}
                        disabled={isEmpty}
                        className='flex h-[22px] w-[22px] items-center justify-center rounded-full border-0 p-0 transition-colors'
                        style={{
                          background: isEmpty ? '#808080' : '#e0e0e0',
                          cursor: isEmpty ? 'not-allowed' : 'pointer',
                        }}
                      >
                        <ArrowUp size={14} strokeWidth={2.25} color='#1b1b1b' />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            )}

            {activeTab === 'editor' && (
              <motion.div
                key='editor'
                className='flex h-full flex-col'
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.15, ease: EASE_OUT }}
              >
                <EditorTabContent editorPrompt={editorPrompt} typedLength={typedLength} />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </div>
  )
})

const TOOL_ICONS: Record<string, React.ComponentType<{ className?: string }>> = {
  hubspot: HubspotIcon,
  salesforce: SalesforceIcon,
}

const MODEL_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  'gpt-': OpenAIIcon,
}

function getModelIcon(model: string) {
  const lower = model.toLowerCase()
  for (const [prefix, icon] of Object.entries(MODEL_ICON_MAP)) {
    if (lower.startsWith(prefix)) return icon
  }
  return null
}

interface EditorTabContentProps {
  editorPrompt: EditorPromptData | null
  typedLength: number
}

/**
 * Editor tab replicating the real agent editor layout:
 * header bar, then scrollable sub-block fields.
 */
function EditorTabContent({ editorPrompt, typedLength }: EditorTabContentProps) {
  if (!editorPrompt) {
    return (
      <div className='flex flex-1 items-center justify-center'>
        <span className='font-medium text-[#787878] text-[13px]'>Select a block to edit</span>
      </div>
    )
  }

  const { blockName, blockType, bgColor, prompt, model, tools } = editorPrompt
  const visibleText = prompt.slice(0, typedLength)
  const isTyping = typedLength < prompt.length
  const BlockIcon = EDITOR_BLOCK_ICONS[blockType]
  const ModelIcon = model ? getModelIcon(model) : null

  return (
    <div className='flex h-full flex-col'>
      {/* Editor header */}
      <div className='mx-[-1px] flex flex-shrink-0 items-center gap-2 border border-[#2c2c2c] bg-[#292929] px-3 py-1.5'>
        {BlockIcon && (
          <div
            className='flex h-[18px] w-[18px] flex-shrink-0 items-center justify-center rounded-sm'
            style={{ background: bgColor }}
          >
            <BlockIcon className='h-[12px] w-[12px] text-white' />
          </div>
        )}
        <span className='min-w-0 flex-1 truncate font-medium text-[#e6e6e6] text-sm'>
          {blockName}
        </span>
      </div>

      {/* Sub-block fields */}
      <div className='flex-1 overflow-y-auto overflow-x-hidden px-2 pt-3 pb-2'>
        <div className='flex flex-col gap-4'>
          {/* System Prompt */}
          <div className='flex flex-col gap-2.5'>
            <div className='flex items-center pl-0.5'>
              <span className='font-medium text-[#e6e6e6] text-small'>System Prompt</span>
            </div>
            <div className='rounded-[4px] border border-[#3d3d3d] bg-[#292929] px-2 py-2'>
              <p className='min-h-[48px] whitespace-pre-wrap break-words font-medium font-sans text-[#e6e6e6] text-sm leading-[1.5]'>
                {visibleText}
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
              </p>
            </div>
          </div>

          {/* Model */}
          {model && (
            <div className='flex flex-col gap-2.5'>
              <div className='flex items-center pl-0.5'>
                <span className='font-medium text-[#e6e6e6] text-small'>Model</span>
              </div>
              <div className='flex h-[32px] items-center gap-2 rounded-[4px] border border-[#3d3d3d] bg-[#292929] px-2'>
                {ModelIcon && <ModelIcon className='h-[14px] w-[14px] text-[#e6e6e6]' />}
                <span className='flex-1 truncate font-medium text-[#e6e6e6] text-sm'>{model}</span>
                <ChevronDown className='h-[7px] w-[9px] text-[#636363]' />
              </div>
            </div>
          )}

          {/* Tools */}
          {tools.length > 0 && (
            <div className='flex flex-col gap-2.5'>
              <div className='flex items-center pl-0.5'>
                <span className='font-medium text-[#e6e6e6] text-small'>Tools</span>
              </div>
              <div className='flex flex-wrap gap-[5px]'>
                {tools.map((tool) => {
                  const ToolIcon = TOOL_ICONS[tool.type]
                  return (
                    <div
                      key={tool.type}
                      className='flex items-center gap-[5px] rounded-[5px] border border-[#3d3d3d] bg-[#2a2a2a] px-[6px] py-[3px]'
                    >
                      {ToolIcon && (
                        <div
                          className='flex h-[16px] w-[16px] flex-shrink-0 items-center justify-center rounded-[4px]'
                          style={{ background: tool.bgColor }}
                        >
                          <ToolIcon className='h-[10px] w-[10px] text-white' />
                        </div>
                      )}
                      <span className='font-normal text-[#e6e6e6] text-[12px]'>{tool.name}</span>
                    </div>
                  )
                })}
              </div>
            </div>
          )}

          {/* Temperature */}
          <div className='flex flex-col gap-2.5'>
            <div className='flex items-center justify-between pl-0.5'>
              <span className='font-medium text-[#e6e6e6] text-small'>Temperature</span>
              <span className='font-medium text-[#787878] text-small'>0.7</span>
            </div>
            <div className='relative h-[6px] rounded-full bg-[#3d3d3d]'>
              <div className='h-full w-[70%] rounded-full bg-[#e6e6e6]' />
              <div
                className='-translate-y-1/2 absolute top-1/2 h-[14px] w-[14px] rounded-full border-[#e6e6e6] border-[2px] bg-[#292929]'
                style={{ left: 'calc(70% - 7px)' }}
              />
            </div>
          </div>

          {/* Response Format */}
          <div className='flex flex-col gap-2.5'>
            <div className='flex items-center pl-0.5'>
              <span className='font-medium text-[#e6e6e6] text-small'>Response Format</span>
            </div>
            <div className='rounded-[4px] border border-[#3d3d3d] bg-[#292929] px-2 py-2'>
              <span className='font-mono text-[#787878] text-[12px]'>plain text</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
