'use client'

import { memo, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronUp, LayoutList } from 'lucide-react'
import Editor from 'react-simple-code-editor'
import { Button, Code, getCodeEditorProps, highlight, languages } from '@/components/emcn'
import { ClientToolCallState } from '@/lib/copilot/tools/client/base-tool'
import { getClientTool } from '@/lib/copilot/tools/client/manager'
import { getRegisteredTools } from '@/lib/copilot/tools/client/registry'
import '@/lib/copilot/tools/client/init-tool-configs'
import {
  getSubagentLabels as getSubagentLabelsFromConfig,
  getToolUIConfig,
  hasInterrupt as hasInterruptFromConfig,
  isSpecialTool as isSpecialToolFromConfig,
} from '@/lib/copilot/tools/client/ui-config'
import { formatDuration } from '@/lib/core/utils/formatting'
import { CopilotMarkdownRenderer } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/markdown-renderer'
import { SmoothStreamingText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/smooth-streaming'
import { ThinkingBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/thinking-block'
import { LoopTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/loop/loop-config'
import { ParallelTool } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/subflows/parallel/parallel-config'
import { getDisplayValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { getBlock } from '@/blocks/registry'
import type { CopilotToolCall } from '@/stores/panel'
import { useCopilotStore } from '@/stores/panel'
import { CLASS_TOOL_METADATA } from '@/stores/panel/copilot/store'
import type { SubAgentContentBlock } from '@/stores/panel/copilot/types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/** Plan step can be a string or an object with title and optional plan content */
type PlanStep = string | { title: string; plan?: string }

/** Option can be a string or an object with title and optional description */
type OptionItem = string | { title: string; description?: string }

/** Result of parsing special XML tags from message content */
interface ParsedTags {
  /** Parsed plan steps, keyed by step number */
  plan?: Record<string, PlanStep>
  /** Whether the plan tag is complete (has closing tag) */
  planComplete?: boolean
  /** Parsed options, keyed by option number */
  options?: Record<string, OptionItem>
  /** Whether the options tag is complete (has closing tag) */
  optionsComplete?: boolean
  /** Content with special tags removed */
  cleanContent: string
}

/**
 * Extracts plan steps from plan_respond tool calls in subagent blocks.
 * @param blocks - The subagent content blocks to search
 * @returns Object containing steps in the format expected by PlanSteps component, and completion status
 */
function extractPlanFromBlocks(blocks: SubAgentContentBlock[] | undefined): {
  steps: Record<string, PlanStep> | undefined
  isComplete: boolean
} {
  if (!blocks) return { steps: undefined, isComplete: false }

  const planRespondBlock = blocks.find(
    (b) => b.type === 'subagent_tool_call' && b.toolCall?.name === 'plan_respond'
  )

  if (!planRespondBlock?.toolCall) {
    return { steps: undefined, isComplete: false }
  }

  const tc = planRespondBlock.toolCall as any
  const args = tc.params || tc.parameters || tc.input || tc.arguments || tc.data?.arguments || {}
  const stepsArray = args.steps

  if (!Array.isArray(stepsArray) || stepsArray.length === 0) {
    return { steps: undefined, isComplete: false }
  }

  const steps: Record<string, PlanStep> = {}
  for (const step of stepsArray) {
    if (step.number !== undefined && step.title) {
      steps[String(step.number)] = step.title
    }
  }

  const isComplete =
    planRespondBlock.toolCall.state === ClientToolCallState.success ||
    planRespondBlock.toolCall.state === ClientToolCallState.error

  return {
    steps: Object.keys(steps).length > 0 ? steps : undefined,
    isComplete,
  }
}

/**
 * Parses partial JSON for streaming options, extracting complete key-value pairs from incomplete JSON.
 * @param jsonStr - The potentially incomplete JSON string
 * @returns Parsed options record or null if no valid options found
 */
function parsePartialOptionsJson(jsonStr: string): Record<string, OptionItem> | null {
  // Try parsing as-is first (might be complete)
  try {
    return JSON.parse(jsonStr)
  } catch {
    // Continue to partial parsing
  }

  // Try to extract complete key-value pairs from partial JSON
  // Match patterns like "1": "some text" or "1": {"title": "text", "description": "..."}
  const result: Record<string, OptionItem> = {}

  // Match complete string values: "key": "value"
  const stringPattern = /"(\d+)":\s*"([^"]*?)"/g
  let match
  while ((match = stringPattern.exec(jsonStr)) !== null) {
    result[match[1]] = match[2]
  }

  // Match complete object values with title and optional description
  // Pattern matches: "1": {"title": "...", "description": "..."} or "1": {"title": "..."}
  const objectPattern =
    /"(\d+)":\s*\{\s*"title":\s*"((?:[^"\\]|\\.)*)"\s*(?:,\s*"description":\s*"((?:[^"\\]|\\.)*)")?\s*\}/g
  while ((match = objectPattern.exec(jsonStr)) !== null) {
    const key = match[1]
    const title = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
    const description = match[3]?.replace(/\\"/g, '"').replace(/\\n/g, '\n')
    result[key] = description ? { title, description } : { title }
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Parses partial JSON for streaming plan steps, extracting complete key-value pairs from incomplete JSON.
 * @param jsonStr - The potentially incomplete JSON string
 * @returns Parsed plan steps record or null if no valid steps found
 */
function parsePartialPlanJson(jsonStr: string): Record<string, PlanStep> | null {
  // Try parsing as-is first (might be complete)
  try {
    return JSON.parse(jsonStr)
  } catch {
    // Continue to partial parsing
  }

  // Try to extract complete key-value pairs from partial JSON
  // Match patterns like "1": "step text" or "1": {"title": "text", "plan": "..."}
  const result: Record<string, PlanStep> = {}

  // Match complete string values: "key": "value"
  const stringPattern = /"(\d+)":\s*"((?:[^"\\]|\\.)*)"/g
  let match
  while ((match = stringPattern.exec(jsonStr)) !== null) {
    result[match[1]] = match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n')
  }

  // Match complete object values: "key": {"title": "text"}
  // Use a more robust pattern that handles nested content
  const objectPattern = /"(\d+)":\s*\{[^{}]*"title":\s*"((?:[^"\\]|\\.)*)"/g
  while ((match = objectPattern.exec(jsonStr)) !== null) {
    result[match[1]] = { title: match[2].replace(/\\"/g, '"').replace(/\\n/g, '\n') }
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Parses special XML tags (`<plan>` and `<options>`) from message content.
 * Handles both complete and streaming/incomplete tags.
 * @param content - The message content to parse
 * @returns Parsed tags with plan, options, and clean content
 */
export function parseSpecialTags(content: string): ParsedTags {
  const result: ParsedTags = { cleanContent: content }

  // Parse <plan> tag - check for complete tag first
  const planMatch = content.match(/<plan>([\s\S]*?)<\/plan>/i)
  if (planMatch) {
    // Always strip the tag from display, even if JSON is invalid
    result.cleanContent = result.cleanContent.replace(planMatch[0], '').trim()
    try {
      result.plan = JSON.parse(planMatch[1])
      result.planComplete = true
    } catch {
      // JSON.parse failed - use regex fallback to extract plan from malformed JSON
      const fallbackPlan = parsePartialPlanJson(planMatch[1])
      if (fallbackPlan) {
        result.plan = fallbackPlan
        result.planComplete = true
      }
    }
  } else {
    // Check for streaming/incomplete plan tag
    const streamingPlanMatch = content.match(/<plan>([\s\S]*)$/i)
    if (streamingPlanMatch) {
      const partialPlan = parsePartialPlanJson(streamingPlanMatch[1])
      if (partialPlan) {
        result.plan = partialPlan
        result.planComplete = false
      }
      // Strip the incomplete tag from clean content
      result.cleanContent = result.cleanContent.replace(streamingPlanMatch[0], '').trim()
    }
  }

  // Parse <options> tag - check for complete tag first
  const optionsMatch = content.match(/<options>([\s\S]*?)<\/options>/i)
  if (optionsMatch) {
    // Always strip the tag from display, even if JSON is invalid
    result.cleanContent = result.cleanContent.replace(optionsMatch[0], '').trim()
    try {
      result.options = JSON.parse(optionsMatch[1])
      result.optionsComplete = true
    } catch {
      // JSON.parse failed - use regex fallback to extract options from malformed JSON
      const fallbackOptions = parsePartialOptionsJson(optionsMatch[1])
      if (fallbackOptions) {
        result.options = fallbackOptions
        result.optionsComplete = true
      }
    }
  } else {
    // Check for streaming/incomplete options tag
    const streamingOptionsMatch = content.match(/<options>([\s\S]*)$/i)
    if (streamingOptionsMatch) {
      const partialOptions = parsePartialOptionsJson(streamingOptionsMatch[1])
      if (partialOptions) {
        result.options = partialOptions
        result.optionsComplete = false
      }
      // Strip the incomplete tag from clean content
      result.cleanContent = result.cleanContent.replace(streamingOptionsMatch[0], '').trim()
    }
  }

  // Strip partial opening tags like "<opt" or "<pla" at the very end of content
  // Simple approach: remove any trailing < followed by partial tag text
  result.cleanContent = result.cleanContent.replace(/<[a-z]*$/i, '').trim()

  return result
}

/**
 * Renders workflow plan steps as a numbered to-do list.
 * @param steps - Plan steps keyed by step number
 * @param streaming - When true, uses smooth streaming animation for step titles
 */
function PlanSteps({
  steps,
  streaming = false,
}: {
  steps: Record<string, PlanStep>
  streaming?: boolean
}) {
  const sortedSteps = useMemo(() => {
    return Object.entries(steps)
      .sort(([a], [b]) => {
        const numA = Number.parseInt(a, 10)
        const numB = Number.parseInt(b, 10)
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
        return a.localeCompare(b)
      })
      .map(([num, step]) => {
        // Extract title from step - handle both string and object formats
        const title = typeof step === 'string' ? step : step.title
        return [num, title] as const
      })
  }, [steps])

  if (sortedSteps.length === 0) return null

  return (
    <div className='mt-0 overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
      <div className='flex items-center gap-[8px] border-[var(--border-1)] border-b bg-[var(--surface-2)] p-[8px]'>
        <LayoutList className='ml-[2px] h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]' />
        <span className='font-medium text-[12px] text-[var(--text-primary)]'>To-dos</span>
        <span className='flex-shrink-0 font-medium text-[12px] text-[var(--text-tertiary)]'>
          {sortedSteps.length}
        </span>
      </div>
      <div className='flex flex-col gap-[6px] px-[10px] py-[6px]'>
        {sortedSteps.map(([num, title], index) => {
          const isLastStep = index === sortedSteps.length - 1
          return (
            <div key={num} className='flex items-baseline gap-[6px]'>
              <span className='w-[14px] flex-shrink-0 text-right text-[12px] text-[var(--text-tertiary)]'>
                {index + 1}.
              </span>
              <div className='min-w-0 flex-1 text-[12px] text-[var(--text-secondary)] leading-[18px] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_p]:m-0 [&_p]:text-[12px] [&_p]:leading-[18px]'>
                {streaming && isLastStep ? (
                  <SmoothStreamingText content={title} isStreaming={true} />
                ) : (
                  <CopilotMarkdownRenderer content={title} />
                )}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

/**
 * Renders selectable options from the agent with keyboard navigation and click selection.
 * After selection, shows the chosen option highlighted and others struck through.
 */
export function OptionsSelector({
  options,
  onSelect,
  disabled = false,
  enableKeyboardNav = false,
  streaming = false,
  selectedOptionKey = null,
}: {
  options: Record<string, OptionItem>
  onSelect: (optionKey: string, optionText: string) => void
  disabled?: boolean
  /** Only enable keyboard navigation for the active options (last message) */
  enableKeyboardNav?: boolean
  /** When true, looks enabled but interaction is disabled (for streaming state) */
  streaming?: boolean
  /** Pre-selected option key (for restoring selection from history) */
  selectedOptionKey?: string | null
}) {
  const isInteractionDisabled = disabled || streaming
  const sortedOptions = useMemo(() => {
    return Object.entries(options)
      .sort(([a], [b]) => {
        const numA = Number.parseInt(a, 10)
        const numB = Number.parseInt(b, 10)
        if (!Number.isNaN(numA) && !Number.isNaN(numB)) return numA - numB
        return a.localeCompare(b)
      })
      .map(([key, option]) => {
        const title = typeof option === 'string' ? option : option.title
        const description = typeof option === 'string' ? undefined : option.description
        return { key, title, description }
      })
  }, [options])

  const [hoveredIndex, setHoveredIndex] = useState(-1)
  const [chosenKey, setChosenKey] = useState<string | null>(selectedOptionKey)
  const containerRef = useRef<HTMLDivElement>(null)

  const isLocked = chosenKey !== null

  // Handle keyboard navigation - only for the active options selector
  useEffect(() => {
    if (isInteractionDisabled || !enableKeyboardNav || isLocked) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return

      const activeElement = document.activeElement
      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.getAttribute('contenteditable') === 'true'

      if (isInputFocused) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHoveredIndex((prev) => (prev < 0 ? 0 : Math.min(prev + 1, sortedOptions.length - 1)))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHoveredIndex((prev) => (prev < 0 ? sortedOptions.length - 1 : Math.max(prev - 1, 0)))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const indexToSelect = hoveredIndex < 0 ? 0 : hoveredIndex
        const selected = sortedOptions[indexToSelect]
        if (selected) {
          setChosenKey(selected.key)
          onSelect(selected.key, selected.title)
        }
      } else if (/^[1-9]$/.test(e.key)) {
        // Number keys select that option directly
        const optionIndex = sortedOptions.findIndex((opt) => opt.key === e.key)
        if (optionIndex !== -1) {
          e.preventDefault()
          const selected = sortedOptions[optionIndex]
          setChosenKey(selected.key)
          onSelect(selected.key, selected.title)
        }
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isInteractionDisabled, enableKeyboardNav, isLocked, sortedOptions, hoveredIndex, onSelect])

  if (sortedOptions.length === 0) return null

  return (
    <div ref={containerRef} className='flex flex-col gap-[4px] pt-[4px]'>
      {sortedOptions.map((option, index) => {
        const isHovered = index === hoveredIndex && !isLocked
        const isChosen = option.key === chosenKey
        const isRejected = isLocked && !isChosen

        return (
          <div
            key={option.key}
            onClick={() => {
              if (!isInteractionDisabled && !isLocked) {
                setChosenKey(option.key)
                onSelect(option.key, option.title)
              }
            }}
            onMouseEnter={() => {
              if (!isLocked && !streaming) setHoveredIndex(index)
            }}
            onMouseLeave={() => {
              if (!isLocked && !streaming && sortedOptions.length === 1) setHoveredIndex(-1)
            }}
            className={clsx(
              'group flex cursor-pointer items-start gap-2 rounded-[6px] p-1',
              'hover:bg-[var(--surface-4)]',
              disabled && !isChosen && 'cursor-not-allowed opacity-50',
              streaming && 'pointer-events-none',
              isLocked && 'cursor-default',
              isHovered && !streaming && 'is-hovered bg-[var(--surface-4)]'
            )}
          >
            <Button
              variant='3d'
              className='group-hover:-translate-y-0.5 group-[.is-hovered]:-translate-y-0.5 w-[22px] py-[2px] text-[11px] group-hover:text-[var(--text-primary)] group-hover:shadow-[0_4px_0_0_rgba(48,48,48,1)] group-[.is-hovered]:text-[var(--text-primary)] group-[.is-hovered]:shadow-[0_4px_0_0_rgba(48,48,48,1)]'
            >
              {option.key}
            </Button>

            <span
              className={clsx(
                'min-w-0 flex-1 pt-0.5 font-season text-[12px] text-[var(--text-tertiary)] leading-5 group-hover:text-[var(--text-primary)] group-[.is-hovered]:text-[var(--text-primary)] [&_code]:px-1 [&_code]:py-0.5 [&_code]:text-[11px] [&_p]:m-0 [&_p]:leading-5',
                isRejected && 'text-[var(--text-tertiary)] line-through opacity-50'
              )}
            >
              {streaming ? (
                <SmoothStreamingText content={option.title} isStreaming={true} />
              ) : (
                <CopilotMarkdownRenderer content={option.title} />
              )}
            </span>
          </div>
        )
      })}
    </div>
  )
}

/** Props for the ToolCall component */
interface ToolCallProps {
  /** Tool call data object */
  toolCall?: CopilotToolCall
  /** Tool call ID for store lookup */
  toolCallId?: string
  /** Callback when tool call state changes */
  onStateChange?: (state: any) => void
  /** Whether this tool call is from the current/latest message. Controls shimmer and action buttons. */
  isCurrentMessage?: boolean
}

/** Props for the ShimmerOverlayText component */
interface ShimmerOverlayTextProps {
  /** Text content to display */
  text: string
  /** Whether shimmer animation is active */
  active?: boolean
  /** Additional class names for the wrapper */
  className?: string
  /** Whether to use special gradient styling for important actions */
  isSpecial?: boolean
}

/** Action verbs at the start of tool display names, highlighted for visual hierarchy */
const ACTION_VERBS = [
  'Analyzing',
  'Analyzed',
  'Exploring',
  'Explored',
  'Fetching',
  'Fetched',
  'Retrieved',
  'Retrieving',
  'Reading',
  'Read',
  'Listing',
  'Listed',
  'Editing',
  'Edited',
  'Executing',
  'Executed',
  'Running',
  'Ran',
  'Designing',
  'Designed',
  'Searching',
  'Searched',
  'Debugging',
  'Debugged',
  'Validating',
  'Validated',
  'Adjusting',
  'Adjusted',
  'Summarizing',
  'Summarized',
  'Marking',
  'Marked',
  'Planning',
  'Planned',
  'Preparing',
  'Prepared',
  'Failed',
  'Aborted',
  'Skipped',
  'Review',
  'Finding',
  'Found',
  'Evaluating',
  'Evaluated',
  'Finished',
  'Setting',
  'Set',
  'Applied',
  'Applying',
  'Rejected',
  'Deploy',
  'Deploying',
  'Deployed',
  'Redeploying',
  'Redeployed',
  'Redeploy',
  'Undeploy',
  'Undeploying',
  'Undeployed',
  'Checking',
  'Checked',
  'Opening',
  'Opened',
  'Create',
  'Creating',
  'Created',
  'Generating',
  'Generated',
  'Rendering',
  'Rendered',
  'Sleeping',
  'Slept',
  'Resumed',
  'Connecting',
  'Connected',
  'Disconnecting',
  'Disconnected',
  'Loading',
  'Loaded',
  'Saving',
  'Saved',
  'Updating',
  'Updated',
  'Deleting',
  'Deleted',
  'Sending',
  'Sent',
  'Receiving',
  'Received',
  'Completing',
  'Completed',
  'Interrupting',
  'Interrupted',
  'Accessing',
  'Accessed',
  'Managing',
  'Managed',
  'Scraping',
  'Scraped',
  'Crawling',
  'Crawled',
  'Getting',
] as const

/**
 * Splits text into action verb and remainder for two-tone rendering.
 * @param text - The text to split
 * @returns Tuple of [actionVerb, remainder] or [null, text] if no match
 */
function splitActionVerb(text: string): [string | null, string] {
  for (const verb of ACTION_VERBS) {
    if (text.startsWith(`${verb} `)) {
      return [verb, text.slice(verb.length)]
    }
    // Handle cases like "Review your workflow changes" where verb is the only word before "your"
    if (text === verb || text.startsWith(verb)) {
      // Check if it's followed by a space or is the whole text
      const afterVerb = text.slice(verb.length)
      if (afterVerb === '' || afterVerb.startsWith(' ')) {
        return [verb, afterVerb]
      }
    }
  }
  return [null, text]
}

/**
 * Renders text with a shimmer overlay animation when active.
 * Special tools use a gradient color; normal tools highlight action verbs.
 * Uses CSS truncation to clamp to one line with ellipsis.
 */
const ShimmerOverlayText = memo(function ShimmerOverlayText({
  text,
  active = false,
  className,
  isSpecial = false,
}: ShimmerOverlayTextProps) {
  const [actionVerb, remainder] = splitActionVerb(text)

  // Base classes for single-line truncation with ellipsis
  const truncateClasses = 'block w-full overflow-hidden text-ellipsis whitespace-nowrap'

  // Special tools: use tertiary-2 color for entire text with shimmer
  if (isSpecial) {
    return (
      <span className={`relative ${truncateClasses} ${className || ''}`}>
        <span className='text-[var(--brand-tertiary-2)]'>{text}</span>
        {active ? (
          <span
            aria-hidden='true'
            className='pointer-events-none absolute inset-0 select-none overflow-hidden'
          >
            <span
              className='block overflow-hidden text-ellipsis whitespace-nowrap text-transparent'
              style={{
                backgroundImage:
                  'linear-gradient(90deg, rgba(51,196,129,0) 0%, rgba(255,255,255,0.6) 50%, rgba(51,196,129,0) 100%)',
                backgroundSize: '200% 100%',
                backgroundRepeat: 'no-repeat',
                WebkitBackgroundClip: 'text',
                backgroundClip: 'text',
                animation: 'toolcall-shimmer 1.4s ease-in-out infinite',
                mixBlendMode: 'screen',
              }}
            >
              {text}
            </span>
          </span>
        ) : null}
        <style>{`
          @keyframes toolcall-shimmer {
            0% { background-position: 150% 0; }
            50% { background-position: 0% 0; }
            100% { background-position: -150% 0; }
          }
        `}</style>
      </span>
    )
  }

  // Normal tools: two-tone rendering - action verb darker, noun lighter
  // Light mode: primary (#2d2d2d) vs muted (#737373) for good contrast
  // Dark mode: tertiary (#b3b3b3) vs muted (#787878) for good contrast
  return (
    <span className={`relative ${truncateClasses} ${className || ''}`}>
      {actionVerb ? (
        <>
          <span className='text-[var(--text-primary)] dark:text-[var(--text-tertiary)]'>
            {actionVerb}
          </span>
          <span className='text-[var(--text-muted)]'>{remainder}</span>
        </>
      ) : (
        <span>{text}</span>
      )}
      {active ? (
        <span
          aria-hidden='true'
          className='pointer-events-none absolute inset-0 select-none overflow-hidden'
        >
          <span
            className='block overflow-hidden text-ellipsis whitespace-nowrap text-transparent'
            style={{
              backgroundImage:
                'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)',
              backgroundSize: '200% 100%',
              backgroundRepeat: 'no-repeat',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              animation: 'toolcall-shimmer 1.4s ease-in-out infinite',
              mixBlendMode: 'screen',
            }}
          >
            {text}
          </span>
        </span>
      ) : null}
      <style>{`
        @keyframes toolcall-shimmer {
          0% { background-position: 150% 0; }
          50% { background-position: 0% 0; }
          100% { background-position: -150% 0; }
        }
      `}</style>
    </span>
  )
})

/**
 * Gets the collapse header label for completed subagent tools.
 * @param toolName - The tool name to get the label for
 * @returns The completion label from UI config, defaults to 'Thought'
 */
function getSubagentCompletionLabel(toolName: string): string {
  const labels = getSubagentLabelsFromConfig(toolName, false)
  return labels?.completed ?? 'Thought'
}

/**
 * Renders subagent blocks as thinking text within regular tool calls.
 * @param blocks - The subagent content blocks to render
 * @param isStreaming - Whether streaming animations should be shown (caller should pre-compute currentMessage check)
 */
function SubAgentThinkingContent({
  blocks,
  isStreaming = false,
}: {
  blocks: SubAgentContentBlock[]
  isStreaming?: boolean
}) {
  let allRawText = ''
  let cleanText = ''
  for (const block of blocks) {
    if (block.type === 'subagent_text' && block.content) {
      allRawText += block.content
      const parsed = parseSpecialTags(block.content)
      cleanText += parsed.cleanContent
    }
  }

  // Extract plan from plan_respond tool call (preferred) or fall back to <plan> tags
  const { steps: planSteps, isComplete: planComplete } = extractPlanFromBlocks(blocks)
  const allParsed = parseSpecialTags(allRawText)

  // Prefer plan_respond tool data over <plan> tags
  const hasPlan =
    !!(planSteps && Object.keys(planSteps).length > 0) ||
    !!(allParsed.plan && Object.keys(allParsed.plan).length > 0)
  const planToRender = planSteps || allParsed.plan
  const isPlanStreaming = planSteps ? !planComplete : isStreaming

  if (!cleanText.trim() && !hasPlan) return null

  const hasSpecialTags = hasPlan

  return (
    <div className='space-y-[4px]'>
      {cleanText.trim() && (
        <ThinkingBlock
          content={cleanText}
          isStreaming={isStreaming}
          hasFollowingContent={false}
          hasSpecialTags={hasSpecialTags}
        />
      )}
      {hasPlan && planToRender && <PlanSteps steps={planToRender} streaming={isPlanStreaming} />}
    </div>
  )
}

/** Subagents that collapse into summary headers when done streaming */
const COLLAPSIBLE_SUBAGENTS = new Set(['plan', 'debug', 'research'])

/**
 * Handles rendering of subagent content with streaming and collapse behavior.
 */
const SubagentContentRenderer = memo(function SubagentContentRenderer({
  toolCall,
  shouldCollapse,
  isCurrentMessage = true,
}: {
  toolCall: CopilotToolCall
  shouldCollapse: boolean
  /** Whether this is from the current/latest message. Controls shimmer animations. */
  isCurrentMessage?: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [duration, setDuration] = useState(0)
  const startTimeRef = useRef<number>(Date.now())
  const maskCredentialValue = useCopilotStore((s) => s.maskCredentialValue)
  const wasStreamingRef = useRef(false)

  // Only show streaming animations for current message
  const isStreaming = isCurrentMessage && !!toolCall.subAgentStreaming

  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      startTimeRef.current = Date.now()
      wasStreamingRef.current = true
    } else if (!isStreaming && wasStreamingRef.current) {
      setDuration(Date.now() - startTimeRef.current)
      wasStreamingRef.current = false
    }
  }, [isStreaming])

  useEffect(() => {
    if (!isStreaming && shouldCollapse) {
      setIsExpanded(false)
    }
  }, [isStreaming, shouldCollapse])

  const segments: Array<
    { type: 'text'; content: string } | { type: 'tool'; block: SubAgentContentBlock }
  > = []
  let currentText = ''
  let allRawText = ''

  for (const block of toolCall.subAgentBlocks || []) {
    if (block.type === 'subagent_text' && block.content) {
      allRawText += block.content
      const parsed = parseSpecialTags(block.content)
      currentText += parsed.cleanContent
    } else if (block.type === 'subagent_tool_call' && block.toolCall) {
      if (currentText.trim()) {
        // Mask any credential IDs in the accumulated text before displaying
        segments.push({ type: 'text', content: maskCredentialValue(currentText) })
        currentText = ''
      }
      segments.push({ type: 'tool', block })
    }
  }
  if (currentText.trim()) {
    // Mask any credential IDs in the accumulated text before displaying
    segments.push({ type: 'text', content: maskCredentialValue(currentText) })
  }

  const allParsed = parseSpecialTags(allRawText)

  // Extract plan from plan_respond tool call (preferred) or fall back to <plan> tags
  const { steps: planSteps, isComplete: planComplete } = extractPlanFromBlocks(
    toolCall.subAgentBlocks
  )
  const hasPlan =
    !!(planSteps && Object.keys(planSteps).length > 0) ||
    !!(allParsed.plan && Object.keys(allParsed.plan).length > 0)
  const planToRender = planSteps || allParsed.plan
  const isPlanStreaming = planSteps ? !planComplete : isStreaming

  const hasSpecialTags = !!(
    hasPlan ||
    (allParsed.options && Object.keys(allParsed.options).length > 0)
  )

  const outerLabel = getSubagentCompletionLabel(toolCall.name)
  // Round to nearest second (minimum 1s) to match original behavior
  const roundedMs = Math.max(1000, Math.round(duration / 1000) * 1000)
  const durationText = `${outerLabel} for ${formatDuration(roundedMs)}`

  const renderCollapsibleContent = () => (
    <>
      {segments.map((segment, index) => {
        if (segment.type === 'text') {
          const isLastSegment = index === segments.length - 1
          const hasFollowingTool = segments.slice(index + 1).some((s) => s.type === 'tool')

          return (
            <ThinkingBlock
              key={`thinking-${index}`}
              content={segment.content}
              isStreaming={isStreaming && isLastSegment}
              hasFollowingContent={hasFollowingTool || !isLastSegment}
              label='Thought'
              hasSpecialTags={hasSpecialTags}
            />
          )
        }
        if (segment.type === 'tool' && segment.block.toolCall) {
          if (toolCall.name === 'edit' && segment.block.toolCall.name === 'edit_workflow') {
            return (
              <div key={`tool-${segment.block.toolCall.id || index}`}>
                <WorkflowEditSummary toolCall={segment.block.toolCall} />
              </div>
            )
          }
          return (
            <div key={`tool-${segment.block.toolCall.id || index}`}>
              <ToolCall
                toolCallId={segment.block.toolCall.id}
                toolCall={segment.block.toolCall}
                isCurrentMessage={isCurrentMessage}
              />
            </div>
          )
        }
        return null
      })}
    </>
  )

  if (isStreaming || !shouldCollapse) {
    return (
      <div className='w-full space-y-[4px]'>
        {renderCollapsibleContent()}
        {hasPlan && planToRender && <PlanSteps steps={planToRender} streaming={isPlanStreaming} />}
      </div>
    )
  }

  return (
    <div className='w-full'>
      <button
        onClick={() => setIsExpanded((v) => !v)}
        className='group inline-flex items-center gap-1 text-left font-[470] font-season text-[var(--text-secondary)] text-sm transition-colors hover:text-[var(--text-primary)]'
        type='button'
      >
        <span className='text-[var(--text-tertiary)]'>{durationText}</span>
        <ChevronUp
          className={clsx(
            'h-3 w-3 transition-all group-hover:opacity-100',
            isExpanded ? 'rotate-180 opacity-100' : 'rotate-90 opacity-0'
          )}
          aria-hidden='true'
        />
      </button>

      <div
        className={clsx(
          'overflow-hidden transition-all duration-150 ease-out',
          isExpanded ? 'mt-1.5 max-h-[5000px] space-y-[4px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        {renderCollapsibleContent()}
      </div>

      {hasPlan && planToRender && (
        <div className='mt-[6px]'>
          <PlanSteps steps={planToRender} />
        </div>
      )}
    </div>
  )
})

/**
 * Determines if a tool call should display with special gradient styling.
 */
function isSpecialToolCall(toolCall: CopilotToolCall): boolean {
  return isSpecialToolFromConfig(toolCall.name)
}

/**
 * Displays a summary of workflow edits with added, edited, and deleted blocks.
 */
const WorkflowEditSummary = memo(function WorkflowEditSummary({
  toolCall,
}: {
  toolCall: CopilotToolCall
}) {
  const blocks = useWorkflowStore((s) => s.blocks)
  const maskCredentialValue = useCopilotStore((s) => s.maskCredentialValue)

  const cachedBlockInfoRef = useRef<Record<string, { name: string; type: string }>>({})

  useEffect(() => {
    for (const [blockId, block] of Object.entries(blocks)) {
      if (!cachedBlockInfoRef.current[blockId]) {
        cachedBlockInfoRef.current[blockId] = {
          name: block.name || '',
          type: block.type || '',
        }
      }
    }
  }, [blocks])

  if (toolCall.name !== 'edit_workflow') {
    return null
  }

  const params =
    (toolCall as any).parameters || (toolCall as any).input || (toolCall as any).params || {}
  let operations = Array.isArray(params.operations) ? params.operations : []

  if (operations.length === 0 && Array.isArray((toolCall as any).operations)) {
    operations = (toolCall as any).operations
  }

  interface SubBlockPreview {
    id: string
    title: string
    value: any
    isPassword?: boolean
    isCredential?: boolean
  }

  interface BlockChange {
    blockId: string
    blockName: string
    blockType: string
    /** All subblocks for add operations */
    subBlocks?: SubBlockPreview[]
    /** Only changed subblocks for edit operations */
    changedSubBlocks?: SubBlockPreview[]
  }

  const addedBlocks: BlockChange[] = []
  const editedBlocks: BlockChange[] = []
  const deletedBlocks: BlockChange[] = []

  for (const op of operations) {
    const blockId = op.block_id
    if (!blockId) continue

    const currentBlock = blocks[blockId]
    const cachedBlock = cachedBlockInfoRef.current[blockId]
    let blockName = currentBlock?.name || cachedBlock?.name || ''
    let blockType = currentBlock?.type || cachedBlock?.type || ''

    if (op.operation_type === 'add' && op.params) {
      blockName = blockName || op.params.name || ''
      blockType = blockType || op.params.type || ''
    }

    if (op.operation_type === 'edit' && op.params && !blockType) {
      blockType = op.params.type || ''
    }

    if (op.operation_type === 'edit' && op.params) {
      const paramKeys = Object.keys(op.params)
      const isEdgeOnlyEdit = paramKeys.length === 1 && paramKeys[0] === 'connections'
      if (isEdgeOnlyEdit) {
        continue
      }
    }

    if (op.operation_type === 'delete') {
      blockName = blockName || op.block_name || ''
      blockType = blockType || op.block_type || ''
    }

    if (!blockName) blockName = blockType || ''
    if (!blockName && !blockType) {
      continue
    }

    const change: BlockChange = { blockId, blockName, blockType }

    if (op.params?.inputs && typeof op.params.inputs === 'object') {
      const inputs = op.params.inputs as Record<string, unknown>
      const blockConfig = getBlock(blockType)

      const subBlocks: SubBlockPreview[] = []

      if (blockType === 'condition' && 'conditions' in inputs) {
        const conditionsValue = inputs.conditions
        const raw = typeof conditionsValue === 'string' ? conditionsValue : undefined

        try {
          if (raw) {
            const parsed = JSON.parse(raw) as unknown
            if (Array.isArray(parsed)) {
              parsed.forEach((item: unknown, index: number) => {
                const conditionItem = item as { id?: string; value?: unknown }
                const title = index === 0 ? 'if' : index === parsed.length - 1 ? 'else' : 'else if'
                subBlocks.push({
                  id: conditionItem?.id ?? `cond-${index}`,
                  title,
                  value: typeof conditionItem?.value === 'string' ? conditionItem.value : '',
                  isPassword: false,
                })
              })
            }
          }
        } catch {
          subBlocks.push({ id: 'if', title: 'if', value: '', isPassword: false })
          subBlocks.push({ id: 'else', title: 'else', value: '', isPassword: false })
        }
      } else {
        const visibleSubBlocks =
          blockConfig?.subBlocks?.filter((sb) => {
            if (sb.hidden) return false
            if (sb.hideFromPreview) return false
            if (sb.mode === 'advanced') return false
            if (sb.mode === 'trigger') return false
            return true
          }) ?? []

        const seenIds = new Set<string>()

        for (const subBlockConfig of visibleSubBlocks) {
          if (seenIds.has(subBlockConfig.id)) continue

          if (subBlockConfig.id in inputs) {
            const value = inputs[subBlockConfig.id]
            if (value === null || value === undefined || value === '') continue
            seenIds.add(subBlockConfig.id)
            subBlocks.push({
              id: subBlockConfig.id,
              title: subBlockConfig.title ?? subBlockConfig.id,
              value,
              isPassword: subBlockConfig.password === true,
              isCredential: subBlockConfig.type === 'oauth-input',
            })
          }
        }
      }

      if (subBlocks.length > 0) {
        if (op.operation_type === 'add') {
          change.subBlocks = subBlocks
        } else if (op.operation_type === 'edit') {
          change.changedSubBlocks = subBlocks
        }
      }
    }

    switch (op.operation_type) {
      case 'add':
        addedBlocks.push(change)
        break
      case 'edit':
        editedBlocks.push(change)
        break
      case 'delete':
        deletedBlocks.push(change)
        break
    }
  }

  const hasChanges = addedBlocks.length > 0 || editedBlocks.length > 0 || deletedBlocks.length > 0

  if (!hasChanges) {
    return null
  }

  const getBlockConfig = (blockType: string) => {
    if (blockType === 'loop') {
      return { icon: LoopTool.icon, bgColor: LoopTool.bgColor }
    }
    if (blockType === 'parallel') {
      return { icon: ParallelTool.icon, bgColor: ParallelTool.bgColor }
    }
    return getBlock(blockType)
  }

  const renderBlockItem = (change: BlockChange, type: 'add' | 'edit' | 'delete') => {
    const blockConfig = getBlockConfig(change.blockType)
    const Icon = blockConfig?.icon
    const bgColor = blockConfig?.bgColor || '#6B7280'

    const actionIcons = {
      add: { symbol: '+', color: 'text-[#22c55e]' },
      edit: { symbol: '~', color: 'text-[#f97316]' },
      delete: { symbol: '-', color: 'text-[#ef4444]' },
    }
    const { symbol, color } = actionIcons[type]

    const subBlocksToShow =
      type === 'add' ? change.subBlocks : type === 'edit' ? change.changedSubBlocks : undefined

    return (
      <div
        key={`${type}-${change.blockId}`}
        className='overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-1)]'
      >
        {/* Block header - gray background like plan/table headers */}
        <div className='flex items-center justify-between p-[8px]'>
          <div className='flex min-w-0 flex-1 items-center gap-[8px]'>
            {/* Toolbar-style icon: colored square with white icon */}
            <div
              className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-[4px]'
              style={{ background: bgColor }}
            >
              {Icon && <Icon className='h-[12px] w-[12px] text-white' />}
            </div>
            <span
              className={`truncate font-medium text-[14px] ${type === 'delete' ? 'text-[var(--text-tertiary)]' : 'text-[var(--text-primary)]'}`}
            >
              {change.blockName}
            </span>
          </div>
          {/* Action icon in top right */}
          <span className={`flex-shrink-0 font-bold font-mono text-[14px] ${color}`}>{symbol}</span>
        </div>

        {/* Subblock details - dark background like table/plan body */}
        {subBlocksToShow && subBlocksToShow.length > 0 && (
          <div className='border-[var(--border-1)] border-t px-2.5 py-1.5'>
            {subBlocksToShow.map((sb) => {
              // Mask password fields and credential IDs
              let displayValue: string
              if (sb.isPassword) {
                displayValue = '•••'
              } else {
                // Get display value first, then mask any credential IDs that might be in it
                const rawValue = getDisplayValue(sb.value)
                displayValue = maskCredentialValue(rawValue)
              }
              return (
                <div key={sb.id} className='flex items-start gap-1.5 py-0.5 text-[11px]'>
                  <span
                    className={`font-medium ${type === 'edit' ? 'text-[#f97316]' : 'text-[var(--text-tertiary)]'}`}
                  >
                    {sb.title}:
                  </span>
                  <span className='line-clamp-1 break-all text-[var(--text-muted)]'>
                    {displayValue}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className='flex flex-col gap-1.5'>
      {addedBlocks.map((change) => renderBlockItem(change, 'add'))}
      {editedBlocks.map((change) => renderBlockItem(change, 'edit'))}
      {deletedBlocks.map((change) => renderBlockItem(change, 'delete'))}
    </div>
  )
})

/** Checks if a tool is server-side executed (not a client tool) */
function isIntegrationTool(toolName: string): boolean {
  return !CLASS_TOOL_METADATA[toolName]
}

function shouldShowRunSkipButtons(toolCall: CopilotToolCall): boolean {
  if (hasInterruptFromConfig(toolCall.name) && toolCall.state === 'pending') {
    return true
  }

  const instance = getClientTool(toolCall.id)
  let hasInterrupt = !!instance?.getInterruptDisplays?.()
  if (!hasInterrupt) {
    try {
      const def = getRegisteredTools()[toolCall.name]
      if (def) {
        hasInterrupt =
          typeof def.hasInterrupt === 'function'
            ? !!def.hasInterrupt(toolCall.params || {})
            : !!def.hasInterrupt
      }
    } catch {}
  }

  if (hasInterrupt && toolCall.state === 'pending') {
    return true
  }

  const mode = useCopilotStore.getState().mode
  if (mode === 'build' && isIntegrationTool(toolCall.name) && toolCall.state === 'pending') {
    return true
  }

  return false
}

async function handleRun(
  toolCall: CopilotToolCall,
  setToolCallState: any,
  onStateChange?: any,
  editedParams?: any
) {
  const instance = getClientTool(toolCall.id)

  if (!instance && isIntegrationTool(toolCall.name)) {
    onStateChange?.('executing')
    try {
      await useCopilotStore.getState().executeIntegrationTool(toolCall.id)
    } catch (e) {
      setToolCallState(toolCall, 'error', { error: e instanceof Error ? e.message : String(e) })
      onStateChange?.('error')
      try {
        await fetch('/api/copilot/tools/mark-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: toolCall.id,
            name: toolCall.name,
            status: 500,
            message: e instanceof Error ? e.message : 'Tool execution failed',
            data: { error: e instanceof Error ? e.message : String(e) },
          }),
        })
      } catch {
        console.error('[handleRun] Failed to notify backend of tool error:', toolCall.id)
      }
    }
    return
  }

  if (!instance) return
  try {
    const mergedParams =
      editedParams ||
      (toolCall as any).params ||
      (toolCall as any).parameters ||
      (toolCall as any).input ||
      {}
    await instance.handleAccept?.(mergedParams)
    onStateChange?.('executing')
  } catch (e) {
    setToolCallState(toolCall, 'error', { error: e instanceof Error ? e.message : String(e) })
  }
}

async function handleSkip(toolCall: CopilotToolCall, setToolCallState: any, onStateChange?: any) {
  const instance = getClientTool(toolCall.id)

  if (!instance && isIntegrationTool(toolCall.name)) {
    setToolCallState(toolCall, 'rejected')
    onStateChange?.('rejected')

    let notified = false
    for (let attempt = 0; attempt < 3 && !notified; attempt++) {
      try {
        const res = await fetch('/api/copilot/tools/mark-complete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            id: toolCall.id,
            name: toolCall.name,
            status: 400,
            message: 'Tool execution skipped by user',
            data: { skipped: true, reason: 'user_skipped' },
          }),
        })
        if (res.ok) {
          notified = true
        }
      } catch (e) {
        if (attempt < 2) {
          await new Promise((resolve) => setTimeout(resolve, 500))
        }
      }
    }

    if (!notified) {
      console.error('[handleSkip] Failed to notify backend after 3 attempts:', toolCall.id)
    }
    return
  }

  if (instance) {
    try {
      await instance.handleReject?.()
    } catch {}
  }
  setToolCallState(toolCall, 'rejected')
  onStateChange?.('rejected')
}

function getDisplayName(toolCall: CopilotToolCall): string {
  const fromStore = (toolCall as any).display?.text
  if (fromStore) return fromStore
  try {
    const def = getRegisteredTools()[toolCall.name] as any
    const byState = def?.metadata?.displayNames?.[toolCall.state]
    if (byState?.text) return byState.text
  } catch {}

  const stateVerb = getStateVerb(toolCall.state)
  const formattedName = formatToolName(toolCall.name)
  return `${stateVerb} ${formattedName}`
}

/** Gets verb prefix based on tool call state */
function getStateVerb(state: string): string {
  switch (state) {
    case 'pending':
    case 'executing':
      return 'Running'
    case 'success':
      return 'Ran'
    case 'error':
      return 'Failed'
    case 'rejected':
    case 'aborted':
      return 'Skipped'
    default:
      return 'Running'
  }
}

/**
 * Formats tool name for display (e.g., "google_calendar_list_events" -> "Google Calendar List Events")
 */
function formatToolName(name: string): string {
  const baseName = name.replace(/_v\d+$/, '')
  return baseName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')
}

function RunSkipButtons({
  toolCall,
  onStateChange,
  editedParams,
}: {
  toolCall: CopilotToolCall
  onStateChange?: (state: any) => void
  editedParams?: any
}) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [buttonsHidden, setButtonsHidden] = useState(false)
  const actionInProgressRef = useRef(false)
  const { setToolCallState, addAutoAllowedTool } = useCopilotStore()

  const onRun = async () => {
    // Prevent race condition - check ref synchronously
    if (actionInProgressRef.current) return
    actionInProgressRef.current = true
    setIsProcessing(true)
    setButtonsHidden(true)
    try {
      await handleRun(toolCall, setToolCallState, onStateChange, editedParams)
    } finally {
      setIsProcessing(false)
      actionInProgressRef.current = false
    }
  }

  const onAlwaysAllow = async () => {
    // Prevent race condition - check ref synchronously
    if (actionInProgressRef.current) return
    actionInProgressRef.current = true
    setIsProcessing(true)
    setButtonsHidden(true)
    try {
      await addAutoAllowedTool(toolCall.name)
      if (!isIntegrationTool(toolCall.name)) {
        await handleRun(toolCall, setToolCallState, onStateChange, editedParams)
      }
    } finally {
      setIsProcessing(false)
      actionInProgressRef.current = false
    }
  }

  const onSkip = async () => {
    // Prevent race condition - check ref synchronously
    if (actionInProgressRef.current) return
    actionInProgressRef.current = true
    setIsProcessing(true)
    setButtonsHidden(true)
    try {
      await handleSkip(toolCall, setToolCallState, onStateChange)
    } finally {
      setIsProcessing(false)
      actionInProgressRef.current = false
    }
  }

  if (buttonsHidden) return null

  // Show "Always Allow" for all tools that require confirmation
  const showAlwaysAllow = true

  // Standardized buttons for all interrupt tools: Allow, Always Allow, Skip
  return (
    <div className='mt-[10px] flex gap-[6px]'>
      <Button onClick={onRun} disabled={isProcessing} variant='tertiary'>
        {isProcessing ? 'Allowing...' : 'Allow'}
      </Button>
      {showAlwaysAllow && (
        <Button onClick={onAlwaysAllow} disabled={isProcessing} variant='default'>
          {isProcessing ? 'Allowing...' : 'Always Allow'}
        </Button>
      )}
      <Button onClick={onSkip} disabled={isProcessing} variant='default'>
        Skip
      </Button>
    </div>
  )
}

export function ToolCall({
  toolCall: toolCallProp,
  toolCallId,
  onStateChange,
  isCurrentMessage = true,
}: ToolCallProps) {
  const [, forceUpdate] = useState({})
  // Get live toolCall from store to ensure we have the latest state
  const effectiveId = toolCallId || toolCallProp?.id
  const liveToolCall = useCopilotStore((s) =>
    effectiveId ? s.toolCallsById[effectiveId] : undefined
  )
  const toolCall = liveToolCall || toolCallProp

  // Guard: nothing to render without a toolCall
  if (!toolCall) return null

  const isExpandablePending =
    toolCall?.state === 'pending' &&
    (toolCall.name === 'make_api_request' || toolCall.name === 'set_global_workflow_variables')

  const [expanded, setExpanded] = useState(isExpandablePending)
  const [showRemoveAutoAllow, setShowRemoveAutoAllow] = useState(false)

  // State for editable parameters
  const params = (toolCall as any).parameters || (toolCall as any).input || toolCall.params || {}
  const [editedParams, setEditedParams] = useState(params)
  const paramsRef = useRef(params)

  // Check if this integration tool is auto-allowed
  // Subscribe to autoAllowedTools so we re-render when it changes
  const autoAllowedTools = useCopilotStore((s) => s.autoAllowedTools)
  const { removeAutoAllowedTool } = useCopilotStore()
  const isAutoAllowed = isIntegrationTool(toolCall.name) && autoAllowedTools.includes(toolCall.name)

  // Update edited params when toolCall params change (deep comparison to avoid resetting user edits on ref change)
  useEffect(() => {
    if (JSON.stringify(params) !== JSON.stringify(paramsRef.current)) {
      setEditedParams(params)
      paramsRef.current = params
    }
  }, [params])

  // Skip rendering some internal tools
  if (
    toolCall.name === 'checkoff_todo' ||
    toolCall.name === 'mark_todo_in_progress' ||
    toolCall.name === 'tool_search_tool_regex' ||
    toolCall.name === 'user_memory' ||
    toolCall.name === 'edit_respond' ||
    toolCall.name === 'debug_respond' ||
    toolCall.name === 'plan_respond' ||
    toolCall.name === 'research_respond' ||
    toolCall.name === 'info_respond' ||
    toolCall.name === 'deploy_respond' ||
    toolCall.name === 'superagent_respond'
  )
    return null

  // Special rendering for subagent tools - show as thinking text with tool calls at top level
  const SUBAGENT_TOOLS = [
    'plan',
    'edit',
    'debug',
    'test',
    'deploy',
    'evaluate',
    'auth',
    'research',
    'knowledge',
    'custom_tool',
    'tour',
    'info',
    'workflow',
    'superagent',
  ]
  const isSubagentTool = SUBAGENT_TOOLS.includes(toolCall.name)

  // For ALL subagent tools, don't show anything until we have blocks with content
  if (isSubagentTool) {
    // Check if we have any meaningful content in blocks
    const hasContent = toolCall.subAgentBlocks?.some(
      (block) =>
        (block.type === 'subagent_text' && block.content?.trim()) ||
        (block.type === 'subagent_tool_call' && block.toolCall)
    )

    if (!hasContent) {
      return null
    }
  }

  if (isSubagentTool && toolCall.subAgentBlocks && toolCall.subAgentBlocks.length > 0) {
    // Render subagent content using the dedicated component
    return (
      <SubagentContentRenderer
        toolCall={toolCall}
        shouldCollapse={COLLAPSIBLE_SUBAGENTS.has(toolCall.name)}
        isCurrentMessage={isCurrentMessage}
      />
    )
  }

  // Get current mode from store to determine if we should render integration tools
  const mode = useCopilotStore.getState().mode

  // Check if this is a completed/historical tool call (not pending/executing)
  // Use string comparison to handle both enum values and string values from DB
  const stateStr = String(toolCall.state)
  const isCompletedToolCall =
    stateStr === 'success' ||
    stateStr === 'error' ||
    stateStr === 'rejected' ||
    stateStr === 'aborted'

  // Allow rendering if:
  // 1. Tool is in CLASS_TOOL_METADATA (client tools), OR
  // 2. We're in build mode (integration tools are executed server-side), OR
  // 3. Tool call is already completed (historical - should always render)
  const isClientTool = !!CLASS_TOOL_METADATA[toolCall.name]
  const isIntegrationToolInBuildMode = mode === 'build' && !isClientTool

  if (!isClientTool && !isIntegrationToolInBuildMode && !isCompletedToolCall) {
    return null
  }
  // Check if tool has params table config (meaning it's expandable)
  const hasParamsTable = !!getToolUIConfig(toolCall.name)?.paramsTable
  const isRunWorkflow = toolCall.name === 'run_workflow'
  const isExpandableTool =
    hasParamsTable ||
    toolCall.name === 'make_api_request' ||
    toolCall.name === 'set_global_workflow_variables'

  const showButtons = isCurrentMessage && shouldShowRunSkipButtons(toolCall)

  // Check UI config for secondary action - only show for current message tool calls
  const toolUIConfig = getToolUIConfig(toolCall.name)
  const secondaryAction = toolUIConfig?.secondaryAction
  const showSecondaryAction = secondaryAction?.showInStates.includes(
    toolCall.state as ClientToolCallState
  )
  const isExecuting =
    toolCall.state === (ClientToolCallState.executing as any) ||
    toolCall.state === ('executing' as any)

  // Legacy fallbacks for tools that haven't migrated to UI config
  const showMoveToBackground =
    isCurrentMessage &&
    ((showSecondaryAction && secondaryAction?.text === 'Move to Background') ||
      (!secondaryAction && toolCall.name === 'run_workflow' && isExecuting))

  const showWake =
    isCurrentMessage &&
    ((showSecondaryAction && secondaryAction?.text === 'Wake') ||
      (!secondaryAction && toolCall.name === 'sleep' && isExecuting))

  const handleStateChange = (state: any) => {
    forceUpdate({})
    onStateChange?.(state)
  }

  const displayName = getDisplayName(toolCall)

  const isLoadingState =
    toolCall.state === ClientToolCallState.generating ||
    toolCall.state === ClientToolCallState.pending ||
    toolCall.state === ClientToolCallState.executing

  const shouldShowShimmer = isCurrentMessage && isLoadingState

  const isSpecial = isSpecialToolCall(toolCall)

  const renderPendingDetails = () => {
    if (toolCall.name === 'make_api_request') {
      const url = editedParams.url || ''
      const method = (editedParams.method || '').toUpperCase()
      return (
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
          <table className='w-full table-fixed bg-transparent'>
            <thead className='bg-transparent'>
              <tr className='border-[var(--border-1)] border-b bg-transparent'>
                <th className='w-[26%] border-[var(--border-1)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Method
                </th>
                <th className='w-[74%] bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Endpoint
                </th>
              </tr>
            </thead>
            <tbody className='bg-transparent'>
              <tr className='group relative border-[var(--border-1)] border-t bg-transparent'>
                <td className='relative w-[26%] border-[var(--border-1)] border-r bg-transparent p-0'>
                  <div className='px-[10px] py-[8px]'>
                    <input
                      type='text'
                      value={method || 'GET'}
                      onChange={(e) => setEditedParams({ ...editedParams, method: e.target.value })}
                      className='w-full bg-transparent font-mono text-muted-foreground text-xs outline-none focus:text-foreground'
                    />
                  </div>
                </td>
                <td className='relative w-[74%] bg-transparent p-0'>
                  <div className='min-w-0 px-[10px] py-[8px]'>
                    <input
                      type='text'
                      value={url || ''}
                      onChange={(e) => setEditedParams({ ...editedParams, url: e.target.value })}
                      placeholder='URL not provided'
                      className='w-full bg-transparent font-mono text-muted-foreground text-xs outline-none focus:text-foreground'
                    />
                  </div>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )
    }

    if (toolCall.name === 'set_environment_variables') {
      const variables =
        editedParams.variables && typeof editedParams.variables === 'object'
          ? editedParams.variables
          : {}

      // Normalize variables - handle both direct key-value and nested {name, value} format
      // Store [originalKey, displayName, displayValue]
      const normalizedEntries: Array<[string, string, string]> = []
      Object.entries(variables).forEach(([key, value]) => {
        if (typeof value === 'object' && value !== null && 'name' in value && 'value' in value) {
          // Handle { name: "KEY", value: "VAL" } format (common in arrays or structured objects)
          normalizedEntries.push([key, String((value as any).name), String((value as any).value)])
        } else {
          // Handle direct key-value format
          normalizedEntries.push([key, key, String(value)])
        }
      })

      return (
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
          <table className='w-full table-fixed bg-transparent'>
            <thead className='bg-transparent'>
              <tr className='border-[var(--border-1)] border-b bg-transparent'>
                <th className='w-[36%] border-[var(--border-1)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Name
                </th>
                <th className='w-[64%] bg-transparent px-[10px] py-[5px] text-left font-medium text-[14px] text-[var(--text-tertiary)]'>
                  Value
                </th>
              </tr>
            </thead>
            <tbody className='bg-transparent'>
              {normalizedEntries.length === 0 ? (
                <tr className='border-[var(--border-1)] border-t bg-transparent'>
                  <td colSpan={2} className='px-[10px] py-[8px] text-[var(--text-muted)] text-xs'>
                    No variables provided
                  </td>
                </tr>
              ) : (
                normalizedEntries.map(([originalKey, name, value]) => (
                  <tr
                    key={originalKey}
                    className='group relative border-[var(--border-1)] border-t bg-transparent'
                  >
                    <td className='relative w-[36%] border-[var(--border-1)] border-r bg-transparent p-0'>
                      <div className='px-[10px] py-[8px]'>
                        <input
                          type='text'
                          value={name}
                          onChange={(e) => {
                            const newName = e.target.value
                            const newVariables = Array.isArray(variables)
                              ? [...variables]
                              : { ...variables }

                            if (Array.isArray(newVariables)) {
                              // Array format: update .name property
                              const idx = Number(originalKey)
                              const item = newVariables[idx]
                              if (typeof item === 'object' && item !== null && 'name' in item) {
                                newVariables[idx] = { ...item, name: newName }
                              }
                            } else {
                              // Object format: rename key
                              // We need to preserve the value but change the key
                              const value = newVariables[originalKey as keyof typeof newVariables]
                              delete newVariables[originalKey as keyof typeof newVariables]
                              newVariables[newName as keyof typeof newVariables] = value
                            }
                            setEditedParams({ ...editedParams, variables: newVariables })
                          }}
                          className='w-full bg-transparent font-medium text-[var(--text-primary)] text-xs outline-none'
                        />
                      </div>
                    </td>
                    <td className='relative w-[64%] bg-transparent p-0'>
                      <div className='min-w-0 px-[10px] py-[8px]'>
                        <input
                          type='text'
                          value={value}
                          onChange={(e) => {
                            // Clone the variables container (works for both Array and Object)
                            const newVariables = Array.isArray(variables)
                              ? [...variables]
                              : { ...variables }

                            const currentVal =
                              newVariables[originalKey as keyof typeof newVariables]

                            if (
                              typeof currentVal === 'object' &&
                              currentVal !== null &&
                              'value' in currentVal
                            ) {
                              // Update value in object structure
                              newVariables[originalKey as keyof typeof newVariables] = {
                                ...(currentVal as any),
                                value: e.target.value,
                              }
                            } else {
                              // Update direct value
                              newVariables[originalKey as keyof typeof newVariables] = e.target
                                .value as any
                            }
                            setEditedParams({ ...editedParams, variables: newVariables })
                          }}
                          className='w-full bg-transparent font-mono text-[var(--text-muted)] text-xs outline-none focus:text-[var(--text-primary)]'
                        />
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      )
    }

    if (toolCall.name === 'set_global_workflow_variables') {
      const ops = Array.isArray(editedParams.operations) ? (editedParams.operations as any[]) : []
      return (
        <div className='w-full overflow-hidden rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
          <div className='grid grid-cols-3 gap-0 border-[var(--border-1)] border-b bg-[var(--surface-4)] py-1.5'>
            <div className='self-start px-2 font-medium font-season text-[10px] text-[var(--text-secondary)] uppercase tracking-wide'>
              Name
            </div>
            <div className='self-start px-2 font-medium font-season text-[10px] text-[var(--text-secondary)] uppercase tracking-wide'>
              Type
            </div>
            <div className='self-start px-2 font-medium font-season text-[10px] text-[var(--text-secondary)] uppercase tracking-wide'>
              Value
            </div>
          </div>
          {ops.length === 0 ? (
            <div className='px-2 py-2 font-[470] font-season text-[var(--text-primary)] text-xs'>
              No operations provided
            </div>
          ) : (
            <div className='divide-y divide-[var(--border-1)]'>
              {ops.map((op, idx) => (
                <div key={idx} className='grid grid-cols-3 gap-0 py-1.5'>
                  <div className='min-w-0 self-start px-2'>
                    <input
                      type='text'
                      value={String(op.name || '')}
                      onChange={(e) => {
                        const newOps = [...ops]
                        newOps[idx] = { ...op, name: e.target.value }
                        setEditedParams({ ...editedParams, operations: newOps })
                      }}
                      className='w-full bg-transparent font-season text-[var(--text-primary)] text-xs outline-none'
                    />
                  </div>
                  <div className='self-start px-2'>
                    <span className='rounded border border-[var(--border-1)] px-1 py-0.5 font-[470] font-season text-[10px] text-[var(--text-primary)]'>
                      {String(op.type || '')}
                    </span>
                  </div>
                  <div className='min-w-0 self-start px-2'>
                    {op.value !== undefined ? (
                      <input
                        type='text'
                        value={String(op.value)}
                        onChange={(e) => {
                          const newOps = [...ops]
                          newOps[idx] = { ...op, value: e.target.value }
                          setEditedParams({ ...editedParams, operations: newOps })
                        }}
                        className='w-full bg-transparent font-[470] font-mono text-[var(--text-muted)] text-xs outline-none focus:text-[var(--text-primary)]'
                      />
                    ) : (
                      <span className='font-[470] font-season text-[var(--text-primary)] text-xs'>
                        —
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )
    }

    if (toolCall.name === 'run_workflow') {
      let inputs = editedParams.input || editedParams.inputs || editedParams.workflow_input
      let isNestedInWorkflowInput = false

      if (typeof inputs === 'string') {
        try {
          inputs = JSON.parse(inputs)
        } catch {
          inputs = {}
        }
      }

      if (editedParams.workflow_input && typeof editedParams.workflow_input === 'object') {
        inputs = editedParams.workflow_input
        isNestedInWorkflowInput = true
      }

      if (!inputs || typeof inputs !== 'object') {
        const { workflowId, workflow_input, ...rest } = editedParams
        inputs = rest
      }

      const safeInputs = inputs && typeof inputs === 'object' ? inputs : {}
      const inputEntries = Object.entries(safeInputs)

      if (inputEntries.length === 0) {
        return null
      }

      /**
       * Format a value for display - handles objects, arrays, and primitives
       */
      const formatValueForDisplay = (value: unknown): string => {
        if (value === null || value === undefined) return ''
        if (typeof value === 'string') return value
        if (typeof value === 'number' || typeof value === 'boolean') return String(value)
        try {
          return JSON.stringify(value, null, 2)
        } catch {
          return String(value)
        }
      }

      /**
       * Parse a string value back to its original type if possible
       */
      const parseInputValue = (value: string, originalValue: unknown): unknown => {
        if (typeof originalValue !== 'object' || originalValue === null) {
          return value
        }
        try {
          return JSON.parse(value)
        } catch {
          return value
        }
      }

      /**
       * Check if a value is a complex type (object or array)
       */
      const isComplexValue = (value: unknown): boolean => {
        return typeof value === 'object' && value !== null
      }

      return (
        <div className='w-full overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-1)]'>
          {/* Header */}
          <div className='flex items-center gap-[8px] border-[var(--border-1)] border-b bg-[var(--surface-2)] p-[8px]'>
            <span className='font-medium text-[12px] text-[var(--text-primary)]'>Edit Input</span>
            <span className='flex-shrink-0 font-medium text-[12px] text-[var(--text-tertiary)]'>
              {inputEntries.length}
            </span>
          </div>
          {/* Input entries */}
          <div className='flex flex-col pt-[6px]'>
            {inputEntries.map(([key, value], index) => {
              const isComplex = isComplexValue(value)
              const displayValue = formatValueForDisplay(value)

              return (
                <div
                  key={key}
                  className={clsx(
                    'flex flex-col gap-[6px] px-[10px] pb-[6px]',
                    index > 0 && 'mt-[6px] border-[var(--border-1)] border-t pt-[6px]'
                  )}
                >
                  {/* Input key */}
                  <span className='font-medium text-[11px] text-[var(--text-primary)]'>{key}</span>
                  {/* Value editor */}
                  {isComplex ? (
                    <Code.Container className='max-h-[168px] min-h-[60px]'>
                      <Code.Content>
                        <Editor
                          value={displayValue}
                          onValueChange={(newCode) => {
                            const parsedValue = parseInputValue(newCode, value)
                            const newInputs = { ...safeInputs, [key]: parsedValue }

                            if (isNestedInWorkflowInput) {
                              setEditedParams({ ...editedParams, workflow_input: newInputs })
                            } else if (typeof editedParams.input === 'string') {
                              setEditedParams({ ...editedParams, input: JSON.stringify(newInputs) })
                            } else if (
                              editedParams.input &&
                              typeof editedParams.input === 'object'
                            ) {
                              setEditedParams({ ...editedParams, input: newInputs })
                            } else if (
                              editedParams.inputs &&
                              typeof editedParams.inputs === 'object'
                            ) {
                              setEditedParams({ ...editedParams, inputs: newInputs })
                            } else {
                              setEditedParams({ ...editedParams, [key]: parsedValue })
                            }
                          }}
                          highlight={(code) => highlight(code, languages.json, 'json')}
                          {...getCodeEditorProps()}
                          className={clsx(getCodeEditorProps().className, 'min-h-[40px]')}
                          style={{ minHeight: '40px' }}
                        />
                      </Code.Content>
                    </Code.Container>
                  ) : (
                    <input
                      type='text'
                      value={displayValue}
                      onChange={(e) => {
                        const parsedValue = parseInputValue(e.target.value, value)
                        const newInputs = { ...safeInputs, [key]: parsedValue }

                        if (isNestedInWorkflowInput) {
                          setEditedParams({ ...editedParams, workflow_input: newInputs })
                        } else if (typeof editedParams.input === 'string') {
                          setEditedParams({ ...editedParams, input: JSON.stringify(newInputs) })
                        } else if (editedParams.input && typeof editedParams.input === 'object') {
                          setEditedParams({ ...editedParams, input: newInputs })
                        } else if (editedParams.inputs && typeof editedParams.inputs === 'object') {
                          setEditedParams({ ...editedParams, inputs: newInputs })
                        } else {
                          setEditedParams({ ...editedParams, [key]: parsedValue })
                        }
                      }}
                      className='w-full rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)] px-[8px] py-[6px] font-medium font-mono text-[13px] text-[var(--text-primary)] outline-none transition-colors placeholder:text-[var(--text-muted)] focus:outline-none'
                    />
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )
    }

    return null
  }

  const isAlwaysExpanded = toolUIConfig?.alwaysExpanded
  if (
    (isAlwaysExpanded || toolCall.name === 'set_environment_variables') &&
    toolCall.state === 'pending'
  ) {
    const isEnvVarsClickable = isAutoAllowed

    const handleEnvVarsClick = () => {
      if (isAutoAllowed) {
        setShowRemoveAutoAllow((prev) => !prev)
      }
    }

    return (
      <div className='w-full'>
        <div className={isEnvVarsClickable ? 'cursor-pointer' : ''} onClick={handleEnvVarsClick}>
          <ShimmerOverlayText
            text={displayName}
            active={shouldShowShimmer}
            isSpecial={isSpecial}
            className='font-[470] font-season text-[var(--text-secondary)] text-sm dark:text-[var(--text-muted)]'
          />
        </div>
        <div className='mt-[10px]'>{renderPendingDetails()}</div>
        {showRemoveAutoAllow && isAutoAllowed && (
          <div className='mt-[10px]'>
            <Button
              onClick={async () => {
                await removeAutoAllowedTool(toolCall.name)
                setShowRemoveAutoAllow(false)
                forceUpdate({})
              }}
              variant='default'
              className='text-xs'
            >
              Remove from Always Allowed
            </Button>
          </div>
        )}
        {showButtons && (
          <RunSkipButtons
            toolCall={toolCall}
            onStateChange={handleStateChange}
            editedParams={editedParams}
          />
        )}
        {/* Render subagent content as thinking text */}
        {toolCall.subAgentBlocks && toolCall.subAgentBlocks.length > 0 && (
          <SubAgentThinkingContent
            blocks={toolCall.subAgentBlocks}
            isStreaming={isCurrentMessage && toolCall.subAgentStreaming}
          />
        )}
      </div>
    )
  }

  if (toolUIConfig?.customRenderer === 'code' || toolCall.name === 'function_execute') {
    const code = params.code || ''
    const isFunctionExecuteClickable = isAutoAllowed

    const handleFunctionExecuteClick = () => {
      if (isAutoAllowed) {
        setShowRemoveAutoAllow((prev) => !prev)
      }
    }

    return (
      <div className='w-full'>
        <div
          className={isFunctionExecuteClickable ? 'cursor-pointer' : ''}
          onClick={handleFunctionExecuteClick}
        >
          <ShimmerOverlayText
            text={displayName}
            active={shouldShowShimmer}
            isSpecial={isSpecial}
            className='font-[470] font-season text-[var(--text-secondary)] text-sm dark:text-[var(--text-muted)]'
          />
        </div>
        {code && (
          <div className='mt-[10px]'>
            <Code.Viewer code={code} language='javascript' showGutter className='min-h-0' />
          </div>
        )}
        {showRemoveAutoAllow && isAutoAllowed && (
          <div className='mt-[10px]'>
            <Button
              onClick={async () => {
                await removeAutoAllowedTool(toolCall.name)
                setShowRemoveAutoAllow(false)
                forceUpdate({})
              }}
              variant='default'
              className='text-xs'
            >
              Remove from Always Allowed
            </Button>
          </div>
        )}
        {showButtons && (
          <RunSkipButtons
            toolCall={toolCall}
            onStateChange={handleStateChange}
            editedParams={editedParams}
          />
        )}
        {/* Render subagent content as thinking text */}
        {toolCall.subAgentBlocks && toolCall.subAgentBlocks.length > 0 && (
          <SubAgentThinkingContent
            blocks={toolCall.subAgentBlocks}
            isStreaming={isCurrentMessage && toolCall.subAgentStreaming}
          />
        )}
      </div>
    )
  }

  const isToolNameClickable = (!isRunWorkflow && isExpandableTool) || isAutoAllowed

  const handleToolNameClick = () => {
    if (isExpandableTool) {
      setExpanded((e) => !e)
    } else if (isAutoAllowed) {
      setShowRemoveAutoAllow((prev) => !prev)
    }
  }

  const isEditWorkflow = toolCall.name === 'edit_workflow'
  const shouldShowDetails = isRunWorkflow || (isExpandableTool && expanded)
  const hasOperations = Array.isArray(params.operations) && params.operations.length > 0
  const hideTextForEditWorkflow = isEditWorkflow && hasOperations

  return (
    <div className='w-full'>
      {!hideTextForEditWorkflow && (
        <div className={isToolNameClickable ? 'cursor-pointer' : ''} onClick={handleToolNameClick}>
          <ShimmerOverlayText
            text={displayName}
            active={shouldShowShimmer}
            isSpecial={isSpecial}
            className='font-[470] font-season text-[var(--text-secondary)] text-sm dark:text-[var(--text-muted)]'
          />
        </div>
      )}
      {shouldShowDetails && <div className='mt-[10px]'>{renderPendingDetails()}</div>}
      {showRemoveAutoAllow && isAutoAllowed && (
        <div className='mt-[10px]'>
          <Button
            onClick={async () => {
              await removeAutoAllowedTool(toolCall.name)
              setShowRemoveAutoAllow(false)
              forceUpdate({})
            }}
            variant='default'
            className='text-xs'
          >
            Remove from Always Allowed
          </Button>
        </div>
      )}
      {showButtons ? (
        <RunSkipButtons
          toolCall={toolCall}
          onStateChange={handleStateChange}
          editedParams={editedParams}
        />
      ) : showMoveToBackground ? (
        <div className='mt-[10px]'>
          <Button
            onClick={async () => {
              try {
                const instance = getClientTool(toolCall.id)
                instance?.setState?.((ClientToolCallState as any).background)
                await instance?.markToolComplete?.(
                  200,
                  'The user has chosen to move the workflow execution to the background. Check back with them later to know when the workflow execution is complete'
                )
                forceUpdate({})
                onStateChange?.('background')
              } catch {}
            }}
            variant='tertiary'
            title='Move to Background'
          >
            Move to Background
          </Button>
        </div>
      ) : showWake ? (
        <div className='mt-[10px]'>
          <Button
            onClick={async () => {
              try {
                const instance = getClientTool(toolCall.id)
                const elapsedSeconds = instance?.getElapsedSeconds?.() || 0
                instance?.setState?.((ClientToolCallState as any).background, {
                  result: { _elapsedSeconds: elapsedSeconds },
                })
                const { updateToolCallParams } = useCopilotStore.getState()
                updateToolCallParams?.(toolCall.id, { _elapsedSeconds: Math.round(elapsedSeconds) })
                await instance?.markToolComplete?.(
                  200,
                  `User woke you up after ${Math.round(elapsedSeconds)} seconds`
                )
                forceUpdate({})
                onStateChange?.('background')
              } catch {}
            }}
            variant='tertiary'
            title='Wake'
          >
            Wake
          </Button>
        </div>
      ) : null}
      {/* Workflow edit summary - shows block changes after edit_workflow completes */}
      <WorkflowEditSummary toolCall={toolCall} />

      {/* Render subagent content as thinking text */}
      {toolCall.subAgentBlocks && toolCall.subAgentBlocks.length > 0 && (
        <SubAgentThinkingContent
          blocks={toolCall.subAgentBlocks}
          isStreaming={isCurrentMessage && toolCall.subAgentStreaming}
        />
      )}
    </div>
  )
}
