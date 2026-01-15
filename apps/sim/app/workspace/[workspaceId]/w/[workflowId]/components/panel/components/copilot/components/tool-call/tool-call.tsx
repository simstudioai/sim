'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
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
import CopilotMarkdownRenderer from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/markdown-renderer'
import { SmoothStreamingText } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/smooth-streaming'
import { ThinkingBlock } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/panel/components/copilot/components/copilot-message/components/thinking-block'
import { getDisplayValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/workflow-block'
import { getBlock } from '@/blocks/registry'
import type { CopilotToolCall } from '@/stores/panel'
import { useCopilotStore } from '@/stores/panel'
import { CLASS_TOOL_METADATA } from '@/stores/panel/copilot/store'
import type { SubAgentContentBlock } from '@/stores/panel/copilot/types'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

/**
 * Parse special tags from content
 */
/**
 * Plan step can be either a string or an object with title and plan
 */
type PlanStep = string | { title: string; plan?: string }

/**
 * Option can be either a string or an object with title and description
 */
type OptionItem = string | { title: string; description?: string }

interface ParsedTags {
  plan?: Record<string, PlanStep>
  planComplete?: boolean
  options?: Record<string, OptionItem>
  optionsComplete?: boolean
  cleanContent: string
}

/**
 * Try to parse partial JSON for streaming options.
 * Attempts to extract complete key-value pairs from incomplete JSON.
 */
function parsePartialOptionsJson(jsonStr: string): Record<string, OptionItem> | null {
  // Try parsing as-is first (might be complete)
  try {
    return JSON.parse(jsonStr)
  } catch {
    // Continue to partial parsing
  }

  // Try to extract complete key-value pairs from partial JSON
  // Match patterns like "1": "some text" or "1": {"title": "text"}
  const result: Record<string, OptionItem> = {}
  // Match complete string values: "key": "value"
  const stringPattern = /"(\d+)":\s*"([^"]*?)"/g
  let match
  while ((match = stringPattern.exec(jsonStr)) !== null) {
    result[match[1]] = match[2]
  }

  // Match complete object values: "key": {"title": "value"}
  const objectPattern = /"(\d+)":\s*\{[^}]*"title":\s*"([^"]*)"[^}]*\}/g
  while ((match = objectPattern.exec(jsonStr)) !== null) {
    result[match[1]] = { title: match[2] }
  }

  return Object.keys(result).length > 0 ? result : null
}

/**
 * Try to parse partial JSON for streaming plan steps.
 * Attempts to extract complete key-value pairs from incomplete JSON.
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
 * Parse <plan> and <options> tags from content
 */
export function parseSpecialTags(content: string): ParsedTags {
  const result: ParsedTags = { cleanContent: content }

  // Parse <plan> tag - check for complete tag first
  const planMatch = content.match(/<plan>([\s\S]*?)<\/plan>/i)
  if (planMatch) {
    try {
      result.plan = JSON.parse(planMatch[1])
      result.planComplete = true
      result.cleanContent = result.cleanContent.replace(planMatch[0], '').trim()
    } catch {
      // Invalid JSON, ignore
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
    try {
      result.options = JSON.parse(optionsMatch[1])
      result.optionsComplete = true
      result.cleanContent = result.cleanContent.replace(optionsMatch[0], '').trim()
    } catch {
      // Invalid JSON, ignore
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
 * PlanSteps component renders the workflow plan steps from the plan subagent
 * Displays as a to-do list with checkmarks and strikethrough text
 */
function PlanSteps({
  steps,
  streaming = false,
}: {
  steps: Record<string, PlanStep>
  /** When true, uses smooth streaming animation for step titles */
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
    <div className='mt-1.5 overflow-hidden rounded-[6px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
      <div className='flex items-center gap-[8px] border-[var(--border-1)] border-b bg-[var(--surface-2)] p-[8px]'>
        <LayoutList className='ml-[2px] h-3 w-3 flex-shrink-0 text-[var(--text-tertiary)]' />
        <span className='font-medium text-[12px] text-[var(--text-primary)]'>To-dos</span>
        <span className='flex-shrink-0 font-medium text-[12px] text-[var(--text-tertiary)]'>
          {sortedSteps.length}
        </span>
      </div>
      <div className='flex flex-col gap-[6px] px-[10px] py-[8px]'>
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
 * OptionsSelector component renders selectable options from the agent
 * Supports keyboard navigation (arrow up/down, enter) and click selection
 * After selection, shows the chosen option highlighted and others struck through
 */
export function OptionsSelector({
  options,
  onSelect,
  disabled = false,
  enableKeyboardNav = false,
  streaming = false,
}: {
  options: Record<string, OptionItem>
  onSelect: (optionKey: string, optionText: string) => void
  disabled?: boolean
  /** Only enable keyboard navigation for the active options (last message) */
  enableKeyboardNav?: boolean
  /** When true, looks enabled but interaction is disabled (for streaming state) */
  streaming?: boolean
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

  const [hoveredIndex, setHoveredIndex] = useState(0)
  const [chosenKey, setChosenKey] = useState<string | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const isLocked = chosenKey !== null

  // Handle keyboard navigation - only for the active options selector
  useEffect(() => {
    if (isInteractionDisabled || !enableKeyboardNav || isLocked) return

    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle if the container or document body is focused (not when typing in input)
      const activeElement = document.activeElement
      const isInputFocused =
        activeElement?.tagName === 'INPUT' ||
        activeElement?.tagName === 'TEXTAREA' ||
        activeElement?.getAttribute('contenteditable') === 'true'

      if (isInputFocused) return

      if (e.key === 'ArrowDown') {
        e.preventDefault()
        setHoveredIndex((prev) => Math.min(prev + 1, sortedOptions.length - 1))
      } else if (e.key === 'ArrowUp') {
        e.preventDefault()
        setHoveredIndex((prev) => Math.max(prev - 1, 0))
      } else if (e.key === 'Enter') {
        e.preventDefault()
        const selected = sortedOptions[hoveredIndex]
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
    <div ref={containerRef} className='flex flex-col gap-0.5 pb-0.5'>
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

interface ToolCallProps {
  toolCall?: CopilotToolCall
  toolCallId?: string
  onStateChange?: (state: any) => void
}

/**
 * Props for shimmer overlay text component.
 */
interface ShimmerOverlayTextProps {
  /** The text content to display */
  text: string
  /** Whether the shimmer animation is active */
  active?: boolean
  /** Additional class names for the wrapper */
  className?: string
  /** Whether to use special gradient styling (for important actions) */
  isSpecial?: boolean
}

/**
 * Action verbs that appear at the start of tool display names.
 * These will be highlighted in a lighter color for better visual hierarchy.
 */
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
 * Returns [actionVerb, remainder] or [null, text] if no match.
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
 * Renders text with a subtle white shimmer overlay when active, creating a skeleton-like
 * loading effect that passes over the existing words without replacing them.
 * For special tool calls, uses a gradient color. For normal tools, highlights action verbs
 * in a lighter color with the rest in default gray.
 */
function ShimmerOverlayText({
  text,
  active = false,
  className,
  isSpecial = false,
}: ShimmerOverlayTextProps) {
  const [actionVerb, remainder] = splitActionVerb(text)

  // Special tools: use tertiary-2 color for entire text with shimmer
  if (isSpecial) {
    return (
      <span className={`relative inline-block ${className || ''}`}>
        <span className='text-[var(--brand-tertiary-2)]'>{text}</span>
        {active ? (
          <span
            aria-hidden='true'
            className='pointer-events-none absolute inset-0 select-none overflow-hidden'
          >
            <span
              className='block text-transparent'
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
    <span className={`relative inline-block ${className || ''}`}>
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
            className='block text-transparent'
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
}

/**
 * SubAgentToolCall renders a nested tool call from a subagent in a muted/thinking style.
 */
function SubAgentToolCall({ toolCall: toolCallProp }: { toolCall: CopilotToolCall }) {
  // Get live toolCall from store to ensure we have the latest state and params
  const liveToolCall = useCopilotStore((s) =>
    toolCallProp.id ? s.toolCallsById[toolCallProp.id] : undefined
  )
  const toolCall = liveToolCall || toolCallProp

  const displayName = getDisplayNameForSubAgent(toolCall)

  const isLoading =
    toolCall.state === ClientToolCallState.generating ||
    toolCall.state === ClientToolCallState.pending ||
    toolCall.state === ClientToolCallState.executing

  const showButtons = shouldShowRunSkipButtons(toolCall)
  const isSpecial = isSpecialToolCall(toolCall)

  // Get params for table rendering
  const params =
    (toolCall as any).parameters || (toolCall as any).input || (toolCall as any).params || {}

  // Render table for tools that support it
  const renderSubAgentTable = () => {
    if (toolCall.name === 'set_environment_variables') {
      const variables = params.variables || params.env_vars || {}
      const entries = Array.isArray(variables)
        ? variables.map((v: any, i: number) => [v.name || `var_${i}`, v.value || ''])
        : Object.entries(variables).map(([key, val]) => {
            if (typeof val === 'object' && val !== null && 'value' in (val as any)) {
              return [key, (val as any).value]
            }
            return [key, val]
          })
      if (entries.length === 0) return null
      return (
        <div className='mt-1.5 w-full overflow-hidden rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
          <table className='w-full table-fixed bg-transparent'>
            <thead className='bg-transparent'>
              <tr className='border-[var(--border-1)] border-b bg-transparent'>
                <th className='w-[36%] border-[var(--border-1)] border-r bg-transparent px-[10px] py-[5px] text-left font-medium text-[12px] text-[var(--text-tertiary)]'>
                  Variable
                </th>
                <th className='w-[64%] bg-transparent px-[10px] py-[5px] text-left font-medium text-[12px] text-[var(--text-tertiary)]'>
                  Value
                </th>
              </tr>
            </thead>
            <tbody className='bg-transparent'>
              {entries.map((entry) => {
                const [key, value] = entry as [string, any]
                return (
                  <tr key={key} className='border-[var(--border-1)] border-t bg-transparent'>
                    <td className='w-[36%] border-[var(--border-1)] border-r bg-transparent px-[10px] py-[6px]'>
                      <span className='truncate font-medium text-[var(--text-primary)] text-xs'>
                        {key}
                      </span>
                    </td>
                    <td className='w-[64%] bg-transparent px-[10px] py-[6px]'>
                      <span className='font-mono text-[var(--text-muted)] text-xs'>
                        {String(value)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )
    }

    if (toolCall.name === 'set_global_workflow_variables') {
      const ops = Array.isArray(params.operations) ? (params.operations as any[]) : []
      if (ops.length === 0) return null
      return (
        <div className='mt-1.5 w-full overflow-hidden rounded-[4px] border border-[var(--border-1)] bg-[var(--surface-1)]'>
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
          <div className='divide-y divide-[var(--border-1)]'>
            {ops.map((op, idx) => (
              <div key={idx} className='grid grid-cols-3 gap-0 py-1.5'>
                <div className='min-w-0 self-start px-2'>
                  <span className='font-season text-[var(--text-primary)] text-xs'>
                    {String(op.name || '')}
                  </span>
                </div>
                <div className='self-start px-2'>
                  <span className='rounded border border-[var(--border-1)] px-1 py-0.5 font-[470] font-season text-[10px] text-[var(--text-primary)]'>
                    {String(op.type || '')}
                  </span>
                </div>
                <div className='min-w-0 self-start px-2'>
                  <span className='font-[470] font-mono text-[var(--text-muted)] text-xs'>
                    {op.value !== undefined ? String(op.value) : '—'}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )
    }

    if (toolCall.name === 'run_workflow') {
      let inputs = params.input || params.inputs || params.workflow_input
      if (typeof inputs === 'string') {
        try {
          inputs = JSON.parse(inputs)
        } catch {
          inputs = {}
        }
      }
      if (params.workflow_input && typeof params.workflow_input === 'object') {
        inputs = params.workflow_input
      }
      if (!inputs || typeof inputs !== 'object') {
        const { workflowId, workflow_input, ...rest } = params
        inputs = rest
      }
      const safeInputs = inputs && typeof inputs === 'object' ? inputs : {}
      const inputEntries = Object.entries(safeInputs)
      if (inputEntries.length === 0) return null

      /**
       * Format a value for display - handles objects, arrays, and primitives
       */
      const formatValue = (value: unknown): string => {
        if (value === null || value === undefined) return '-'
        if (typeof value === 'string') return value || '-'
        if (typeof value === 'number' || typeof value === 'boolean') return String(value)
        try {
          return JSON.stringify(value, null, 2)
        } catch {
          return String(value)
        }
      }

      /**
       * Check if a value is a complex type (object or array)
       */
      const isComplex = (value: unknown): boolean => {
        return typeof value === 'object' && value !== null
      }

      return (
        <div className='mt-1.5 w-full overflow-hidden rounded-md border border-[var(--border-1)] bg-[var(--surface-1)]'>
          {/* Header */}
          <div className='flex items-center gap-[8px] border-[var(--border-1)] border-b bg-[var(--surface-2)] p-[8px]'>
            <span className='font-medium text-[12px] text-[var(--text-primary)]'>Input</span>
            <span className='flex-shrink-0 font-medium text-[12px] text-[var(--text-tertiary)]'>
              {inputEntries.length}
            </span>
          </div>
          {/* Input entries */}
          <div className='flex flex-col'>
            {inputEntries.map(([key, value], index) => {
              const formattedValue = formatValue(value)
              const needsCodeViewer = isComplex(value)

              return (
                <div
                  key={key}
                  className={clsx(
                    'flex flex-col gap-1 px-[10px] py-[6px]',
                    index > 0 && 'border-[var(--border-1)] border-t'
                  )}
                >
                  {/* Input key */}
                  <span className='font-medium text-[11px] text-[var(--text-primary)]'>{key}</span>
                  {/* Value display */}
                  {needsCodeViewer ? (
                    <Code.Viewer
                      code={formattedValue}
                      language='json'
                      showGutter={false}
                      className='max-h-[80px] min-h-0'
                    />
                  ) : (
                    <span className='font-mono text-[11px] text-[var(--text-muted)] leading-[1.3]'>
                      {formattedValue}
                    </span>
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

  // For edit_workflow, only show the WorkflowEditSummary component (replaces text display)
  const isEditWorkflow = toolCall.name === 'edit_workflow'
  const hasOperations = Array.isArray(params.operations) && params.operations.length > 0

  return (
    <div className='py-0.5'>
      {/* Hide text display for edit_workflow when we have operations to show in summary */}
      {!(isEditWorkflow && hasOperations) && (
        <ShimmerOverlayText
          text={displayName}
          active={isLoading && !showButtons}
          isSpecial={isSpecial}
          className='font-[470] font-season text-[12px] text-[var(--text-tertiary)]'
        />
      )}
      {renderSubAgentTable()}
      {/* WorkflowEditSummary is rendered outside SubAgentContent for edit subagent */}
      {showButtons && <RunSkipButtons toolCall={toolCall} />}
    </div>
  )
}

/**
 * Get display name for subagent tool calls
 */
function getDisplayNameForSubAgent(toolCall: CopilotToolCall): string {
  const fromStore = toolCall.display?.text
  if (fromStore) return fromStore

  const stateVerb = getStateVerb(toolCall.state)
  const formattedName = formatToolName(toolCall.name)
  return `${stateVerb} ${formattedName}`
}

/**
 * Max height for subagent content before internal scrolling kicks in
 */
const SUBAGENT_MAX_HEIGHT = 200

/**
 * Interval for auto-scroll during streaming (ms)
 */
const SUBAGENT_SCROLL_INTERVAL = 100

/**
 * Get the outer collapse header label for completed subagent tools.
 * Uses the tool's UI config.
 */
function getSubagentCompletionLabel(toolName: string): string {
  const labels = getSubagentLabelsFromConfig(toolName, false)
  return labels?.completed ?? 'Thought'
}

/**
 * Get display labels for subagent tools.
 * Uses the tool's UI config.
 */
function getSubagentLabels(toolName: string, isStreaming: boolean): string {
  const labels = getSubagentLabelsFromConfig(toolName, isStreaming)
  if (labels) {
    return isStreaming ? labels.streaming : labels.completed
  }
  return isStreaming ? 'Processing' : 'Processed'
}

/**
 * SubAgentContent renders the streamed content and tool calls from a subagent
 * with thinking-style styling (same as ThinkingBlock).
 * Auto-collapses when streaming ends and has internal scrolling for long content.
 */
function SubAgentContent({
  blocks,
  isStreaming = false,
  toolName = 'debug',
}: {
  blocks?: SubAgentContentBlock[]
  isStreaming?: boolean
  toolName?: string
}) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [userHasScrolledAway, setUserHasScrolledAway] = useState(false)
  const userCollapsedRef = useRef<boolean>(false)
  const scrollContainerRef = useRef<HTMLDivElement>(null)
  const lastScrollTopRef = useRef(0)
  const programmaticScrollRef = useRef(false)

  // Check if there are any tool calls (which means thinking should close)
  const hasToolCalls = useMemo(() => {
    if (!blocks) return false
    return blocks.some((b) => b.type === 'subagent_tool_call' && b.toolCall)
  }, [blocks])

  // Auto-expand when streaming with content, auto-collapse when done or when tool call comes in
  useEffect(() => {
    if (!isStreaming || hasToolCalls) {
      setIsExpanded(false)
      userCollapsedRef.current = false
      setUserHasScrolledAway(false)
      return
    }

    if (!userCollapsedRef.current && blocks && blocks.length > 0) {
      setIsExpanded(true)
    }
  }, [isStreaming, blocks, hasToolCalls])

  // Handle scroll events to detect user scrolling away
  useEffect(() => {
    const container = scrollContainerRef.current
    if (!container || !isExpanded) return

    const handleScroll = () => {
      if (programmaticScrollRef.current) return

      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const isNearBottom = distanceFromBottom <= 20

      const delta = scrollTop - lastScrollTopRef.current
      const movedUp = delta < -2

      if (movedUp && !isNearBottom) {
        setUserHasScrolledAway(true)
      }

      // Re-stick if user scrolls back to bottom
      if (userHasScrolledAway && isNearBottom) {
        setUserHasScrolledAway(false)
      }

      lastScrollTopRef.current = scrollTop
    }

    container.addEventListener('scroll', handleScroll, { passive: true })
    lastScrollTopRef.current = container.scrollTop

    return () => container.removeEventListener('scroll', handleScroll)
  }, [isExpanded, userHasScrolledAway])

  // Smart auto-scroll: only scroll if user hasn't scrolled away
  useEffect(() => {
    if (!isStreaming || !isExpanded || userHasScrolledAway) return

    const intervalId = window.setInterval(() => {
      const container = scrollContainerRef.current
      if (!container) return

      const { scrollTop, scrollHeight, clientHeight } = container
      const distanceFromBottom = scrollHeight - scrollTop - clientHeight
      const isNearBottom = distanceFromBottom <= 50

      if (isNearBottom) {
        programmaticScrollRef.current = true
        container.scrollTo({
          top: container.scrollHeight,
          behavior: 'smooth',
        })
        window.setTimeout(() => {
          programmaticScrollRef.current = false
        }, 150)
      }
    }, SUBAGENT_SCROLL_INTERVAL)

    return () => window.clearInterval(intervalId)
  }, [isStreaming, isExpanded, userHasScrolledAway])

  if (!blocks || blocks.length === 0) return null

  const hasContent = blocks.length > 0
  // Show "done" label when streaming ends OR when tool calls are present
  const isThinkingDone = !isStreaming || hasToolCalls
  const label = getSubagentLabels(toolName, !isThinkingDone)

  return (
    <div>
      {/* Define shimmer keyframes */}
      {!isThinkingDone && (
        <style>{`
          @keyframes thinking-shimmer {
            0% { background-position: 150% 0; }
            50% { background-position: 0% 0; }
            100% { background-position: -150% 0; }
          }
        `}</style>
      )}
      <button
        onClick={() => {
          setIsExpanded((v) => {
            const next = !v
            if (!next && isStreaming) userCollapsedRef.current = true
            return next
          })
        }}
        className='group inline-flex items-center gap-1 text-left font-[470] font-season text-[var(--text-secondary)] text-sm transition-colors hover:text-[var(--text-primary)]'
        type='button'
        disabled={!hasContent}
      >
        <span className='relative inline-block'>
          <span className='text-[var(--text-tertiary)]'>{label}</span>
          {!isThinkingDone && (
            <span
              aria-hidden='true'
              className='pointer-events-none absolute inset-0 select-none overflow-hidden'
            >
              <span
                className='block text-transparent'
                style={{
                  backgroundImage:
                    'linear-gradient(90deg, rgba(255,255,255,0) 0%, rgba(255,255,255,0.85) 50%, rgba(255,255,255,0) 100%)',
                  backgroundSize: '200% 100%',
                  backgroundRepeat: 'no-repeat',
                  WebkitBackgroundClip: 'text',
                  backgroundClip: 'text',
                  animation: 'thinking-shimmer 1.4s ease-in-out infinite',
                  mixBlendMode: 'screen',
                }}
              >
                {label}
              </span>
            </span>
          )}
        </span>
        {hasContent && (
          <ChevronUp
            className={clsx(
              'h-3 w-3 transition-all group-hover:opacity-100',
              isExpanded ? 'rotate-180 opacity-100' : 'rotate-90 opacity-0'
            )}
            aria-hidden='true'
          />
        )}
      </button>

      <div
        ref={scrollContainerRef}
        className={clsx(
          'overflow-y-auto transition-all duration-150 ease-out',
          isExpanded ? 'mt-1.5 max-h-[200px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        {blocks.map((block, index) => {
          if (block.type === 'subagent_text' && block.content) {
            const isLastBlock = index === blocks.length - 1
            // Strip special tags from display (they're rendered separately)
            const parsed = parseSpecialTags(block.content)
            const displayContent = parsed.cleanContent
            if (!displayContent) return null
            return (
              <pre
                key={`subagent-text-${index}`}
                className='whitespace-pre-wrap font-[470] font-season text-[12px] text-[var(--text-tertiary)] leading-[1.15rem]'
              >
                {displayContent}
                {!isThinkingDone && isLastBlock && (
                  <span className='ml-1 inline-block h-2 w-1 animate-pulse bg-[var(--text-tertiary)]' />
                )}
              </pre>
            )
          }

          // All tool calls are rendered at top level, skip here
          return null
        })}
      </div>

      {/* Render PlanSteps for plan subagent when content contains <plan> tag */}
      {toolName === 'plan' &&
        (() => {
          // Combine all text content from blocks
          const allText = blocks
            .filter((b) => b.type === 'subagent_text' && b.content)
            .map((b) => b.content)
            .join('')
          const parsed = parseSpecialTags(allText)
          if (parsed.plan && Object.keys(parsed.plan).length > 0) {
            return <PlanSteps steps={parsed.plan} streaming={!isThinkingDone} />
          }
          return null
        })()}
    </div>
  )
}

/**
 * SubAgentThinkingContent renders subagent blocks as simple thinking text (ThinkingBlock).
 * Used for inline rendering within regular tool calls that have subagent content.
 */
function SubAgentThinkingContent({
  blocks,
  isStreaming = false,
}: {
  blocks: SubAgentContentBlock[]
  isStreaming?: boolean
}) {
  // Combine all text content from blocks
  let allRawText = ''
  let cleanText = ''
  for (const block of blocks) {
    if (block.type === 'subagent_text' && block.content) {
      allRawText += block.content
      const parsed = parseSpecialTags(block.content)
      cleanText += parsed.cleanContent
    }
  }

  // Parse plan from all text
  const allParsed = parseSpecialTags(allRawText)

  if (!cleanText.trim() && !allParsed.plan) return null

  // Check if special tags are present
  const hasSpecialTags = !!(allParsed.plan && Object.keys(allParsed.plan).length > 0)

  return (
    <div className='space-y-1.5'>
      {cleanText.trim() && (
        <ThinkingBlock
          content={cleanText}
          isStreaming={isStreaming}
          hasFollowingContent={false}
          hasSpecialTags={hasSpecialTags}
        />
      )}
      {allParsed.plan && Object.keys(allParsed.plan).length > 0 && (
        <PlanSteps steps={allParsed.plan} streaming={isStreaming} />
      )}
    </div>
  )
}

/**
 * Subagents that should collapse when done streaming.
 * Default behavior is to NOT collapse (stay expanded like edit, superagent, info, etc.).
 * Only plan, debug, and research collapse into summary headers.
 */
const COLLAPSIBLE_SUBAGENTS = new Set(['plan', 'debug', 'research'])

/**
 * SubagentContentRenderer handles the rendering of subagent content.
 * - During streaming: Shows content at top level
 * - When done (not streaming): Most subagents stay expanded, only specific ones collapse
 * - Exception: plan, debug, research, info subagents collapse into a header
 */
function SubagentContentRenderer({
  toolCall,
  shouldCollapse,
}: {
  toolCall: CopilotToolCall
  shouldCollapse: boolean
}) {
  const [isExpanded, setIsExpanded] = useState(true)
  const [duration, setDuration] = useState(0)
  const startTimeRef = useRef<number>(Date.now())

  const isStreaming = !!toolCall.subAgentStreaming

  // Reset start time when streaming begins
  useEffect(() => {
    if (isStreaming) {
      startTimeRef.current = Date.now()
      setDuration(0)
    }
  }, [isStreaming])

  // Update duration timer during streaming
  useEffect(() => {
    if (!isStreaming) return

    const interval = setInterval(() => {
      setDuration(Date.now() - startTimeRef.current)
    }, 100)

    return () => clearInterval(interval)
  }, [isStreaming])

  // Auto-collapse when streaming ends (only for collapsible subagents)
  useEffect(() => {
    if (!isStreaming && shouldCollapse) {
      setIsExpanded(false)
    }
  }, [isStreaming, shouldCollapse])

  // Build segments: each segment is either text content or a tool call
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
        segments.push({ type: 'text', content: currentText })
        currentText = ''
      }
      segments.push({ type: 'tool', block })
    }
  }
  if (currentText.trim()) {
    segments.push({ type: 'text', content: currentText })
  }

  // Parse plan and options
  const allParsed = parseSpecialTags(allRawText)
  const hasSpecialTags = !!(
    (allParsed.plan && Object.keys(allParsed.plan).length > 0) ||
    (allParsed.options && Object.keys(allParsed.options).length > 0)
  )

  const formatDuration = (ms: number) => {
    const seconds = Math.max(1, Math.round(ms / 1000))
    return `${seconds}s`
  }

  // Outer header uses subagent-specific label
  const outerLabel = getSubagentCompletionLabel(toolCall.name)
  const durationText = `${outerLabel} for ${formatDuration(duration)}`

  // Check if we have a plan to render outside the collapsible
  const hasPlan = allParsed.plan && Object.keys(allParsed.plan).length > 0

  // Render the collapsible content (thinking blocks + tool calls, NOT plan)
  // Inner thinking text always uses "Thought" label
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
          // For edit subagent's edit_workflow tool: only show the diff summary, skip the tool call header
          if (toolCall.name === 'edit' && segment.block.toolCall.name === 'edit_workflow') {
            return (
              <div key={`tool-${segment.block.toolCall.id || index}`}>
                <WorkflowEditSummary toolCall={segment.block.toolCall} />
              </div>
            )
          }
          return (
            <div key={`tool-${segment.block.toolCall.id || index}`}>
              <ToolCall toolCallId={segment.block.toolCall.id} toolCall={segment.block.toolCall} />
            </div>
          )
        }
        return null
      })}
    </>
  )

  // During streaming OR for non-collapsible subagents: show content at top level
  if (isStreaming || !shouldCollapse) {
    return (
      <div className='w-full space-y-1.5'>
        {renderCollapsibleContent()}
        {hasPlan && <PlanSteps steps={allParsed.plan!} streaming={isStreaming} />}
      </div>
    )
  }

  // Completed collapsible subagent (plan, debug, research, info): show collapsible header
  // Plan artifact stays outside the collapsible
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
          isExpanded ? 'mt-1.5 max-h-[5000px] opacity-100' : 'max-h-0 opacity-0'
        )}
      >
        {renderCollapsibleContent()}
      </div>

      {/* Plan stays outside the collapsible */}
      {hasPlan && <PlanSteps steps={allParsed.plan!} />}
    </div>
  )
}

/**
 * Determines if a tool call is "special" and should display with gradient styling.
 * Uses the tool's UI config.
 */
function isSpecialToolCall(toolCall: CopilotToolCall): boolean {
  return isSpecialToolFromConfig(toolCall.name)
}

/**
 * WorkflowEditSummary shows a full-width summary of workflow edits (like Cursor's diff).
 * Displays: workflow name with stats (+N green, N orange, -N red)
 * Expands inline on click to show individual blocks with their icons.
 */
function WorkflowEditSummary({ toolCall }: { toolCall: CopilotToolCall }) {
  // Get block data from current workflow state
  const blocks = useWorkflowStore((s) => s.blocks)

  // Cache block info on first render (before diff is applied) so we can show
  // deleted blocks properly even after they're removed from the workflow
  const cachedBlockInfoRef = useRef<Record<string, { name: string; type: string }>>({})

  // Update cache with current block info (only add, never remove)
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

  // Show for edit_workflow regardless of state
  if (toolCall.name !== 'edit_workflow') {
    return null
  }

  // Extract operations from tool call params
  const params =
    (toolCall as any).parameters || (toolCall as any).input || (toolCall as any).params || {}
  let operations = Array.isArray(params.operations) ? params.operations : []

  // Fallback: check if operations are at top level of toolCall
  if (operations.length === 0 && Array.isArray((toolCall as any).operations)) {
    operations = (toolCall as any).operations
  }

  // Group operations by type with block info
  interface SubBlockPreview {
    id: string
    title: string
    value: any
    isPassword?: boolean
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

    // Get block info from current workflow state, cached state, or operation params
    const currentBlock = blocks[blockId]
    const cachedBlock = cachedBlockInfoRef.current[blockId]
    let blockName = currentBlock?.name || cachedBlock?.name || ''
    let blockType = currentBlock?.type || cachedBlock?.type || ''

    // For add operations, get info from params (type is stored as params.type)
    if (op.operation_type === 'add' && op.params) {
      blockName = blockName || op.params.name || ''
      blockType = blockType || op.params.type || ''
    }

    // For edit operations, also check params.type if block not in current state
    if (op.operation_type === 'edit' && op.params && !blockType) {
      blockType = op.params.type || ''
    }

    // Skip edge-only edit operations (like how we don't highlight blocks on canvas for edge changes)
    // An edit is edge-only if params only contains 'connections' and nothing else meaningful
    if (op.operation_type === 'edit' && op.params) {
      const paramKeys = Object.keys(op.params)
      const isEdgeOnlyEdit = paramKeys.length === 1 && paramKeys[0] === 'connections'
      if (isEdgeOnlyEdit) {
        continue
      }
    }

    // For delete operations, check if block info was provided in operation
    if (op.operation_type === 'delete') {
      // Some delete operations may include block_name and block_type
      blockName = blockName || op.block_name || ''
      blockType = blockType || op.block_type || ''
    }

    // Fallback name to type or ID
    if (!blockName) blockName = blockType || blockId

    const change: BlockChange = { blockId, blockName, blockType }

    // Extract subblock info from operation params, ordered by block config
    if (op.params?.inputs && typeof op.params.inputs === 'object') {
      const inputs = op.params.inputs as Record<string, unknown>
      const blockConfig = getBlock(blockType)

      // Build subBlocks array
      const subBlocks: SubBlockPreview[] = []

      // Special handling for condition blocks - parse conditions JSON and render as separate rows
      // This matches how the canvas renders condition blocks with "if", "else if", "else" rows
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
          // Fallback: show default if/else
          subBlocks.push({ id: 'if', title: 'if', value: '', isPassword: false })
          subBlocks.push({ id: 'else', title: 'else', value: '', isPassword: false })
        }
      } else {
        // Filter visible subblocks from config (same logic as canvas preview)
        const visibleSubBlocks =
          blockConfig?.subBlocks?.filter((sb) => {
            // Skip hidden subblocks
            if (sb.hidden) return false
            if (sb.hideFromPreview) return false
            // Skip advanced mode subblocks (not visible by default)
            if (sb.mode === 'advanced') return false
            // Skip trigger mode subblocks
            if (sb.mode === 'trigger') return false
            return true
          }) ?? []

        // Track seen ids to dedupe (same pattern as canvas preview using id as key)
        const seenIds = new Set<string>()

        // Add subblocks that are visible in config, in config order (first config per id wins)
        for (const subBlockConfig of visibleSubBlocks) {
          // Skip if we've already added this id (handles configs with same id but different conditions)
          if (seenIds.has(subBlockConfig.id)) continue

          if (subBlockConfig.id in inputs) {
            const value = inputs[subBlockConfig.id]
            // Skip empty values and connections
            if (value === null || value === undefined || value === '') continue
            seenIds.add(subBlockConfig.id)
            subBlocks.push({
              id: subBlockConfig.id,
              title: subBlockConfig.title ?? subBlockConfig.id,
              value,
              isPassword: subBlockConfig.password === true,
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

  // Get block config by type (for icon and bgColor)
  const getBlockConfig = (blockType: string) => {
    return getBlock(blockType)
  }

  // Render a single block item with action icon and details
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
              // Mask password fields like the canvas does
              const displayValue = sb.isPassword ? '•••' : getDisplayValue(sb.value)
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
}

/**
 * Checks if a tool is an integration tool (server-side executed, not a client tool)
 */
function isIntegrationTool(toolName: string): boolean {
  // Any tool NOT in CLASS_TOOL_METADATA is an integration tool (server-side execution)
  return !CLASS_TOOL_METADATA[toolName]
}

function shouldShowRunSkipButtons(toolCall: CopilotToolCall): boolean {
  // First check UI config for interrupt
  if (hasInterruptFromConfig(toolCall.name) && toolCall.state === 'pending') {
    return true
  }

  // Then check instance-level interrupt
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

  // Show buttons for client tools with interrupts
  if (hasInterrupt && toolCall.state === 'pending') {
    return true
  }

  // Always show buttons for integration tools in pending state (they need user confirmation)
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

  // Handle integration tools (server-side execution)
  if (!instance && isIntegrationTool(toolCall.name)) {
    // Set executing state immediately for UI feedback
    setToolCallState(toolCall, 'executing')
    onStateChange?.('executing')
    try {
      await useCopilotStore.getState().executeIntegrationTool(toolCall.id)
      // Note: executeIntegrationTool handles success/error state updates internally
    } catch (e) {
      // If executeIntegrationTool throws, ensure we update state to error
      setToolCallState(toolCall, 'error', { error: e instanceof Error ? e.message : String(e) })
      onStateChange?.('error')
      // Notify backend about the error so agent doesn't hang
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
        // Last resort: log error if we can't notify backend
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

  // Handle integration tools (skip by marking as rejected and notifying backend)
  if (!instance && isIntegrationTool(toolCall.name)) {
    setToolCallState(toolCall, 'rejected')
    onStateChange?.('rejected')

    // Notify backend that tool was skipped - this is CRITICAL for the agent to continue
    // Retry up to 3 times if the notification fails
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
        // Wait briefly before retry
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
  // Prefer display resolved in the copilot store (SSOT)
  const fromStore = (toolCall as any).display?.text
  if (fromStore) return fromStore
  try {
    const def = getRegisteredTools()[toolCall.name] as any
    const byState = def?.metadata?.displayNames?.[toolCall.state]
    if (byState?.text) return byState.text
  } catch {}

  // For integration tools, format the tool name nicely
  // e.g., "google_calendar_list_events" -> "Running Google Calendar List Events"
  const stateVerb = getStateVerb(toolCall.state)
  const formattedName = formatToolName(toolCall.name)
  return `${stateVerb} ${formattedName}`
}

/**
 * Get verb prefix based on tool state
 */
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
 * Format tool name for display
 * e.g., "google_calendar_list_events" -> "Google Calendar List Events"
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
      // Add to auto-allowed list first
      await addAutoAllowedTool(toolCall.name)
      // Then execute
      await handleRun(toolCall, setToolCallState, onStateChange, editedParams)
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

  // Hide "Always Allow" for integration tools (only show for client tools with interrupts)
  const showAlwaysAllow = !isIntegrationTool(toolCall.name)

  // Standardized buttons for all interrupt tools: Allow, (Always Allow for client tools only), Skip
  return (
    <div className='mt-1.5 flex gap-[6px]'>
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

export function ToolCall({ toolCall: toolCallProp, toolCallId, onStateChange }: ToolCallProps) {
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
    (toolCall.name === 'make_api_request' ||
      toolCall.name === 'set_global_workflow_variables' ||
      toolCall.name === 'run_workflow')

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
    toolCall.name === 'tool_search_tool_regex'
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
  const isExpandableTool =
    hasParamsTable ||
    toolCall.name === 'make_api_request' ||
    toolCall.name === 'set_global_workflow_variables' ||
    toolCall.name === 'run_workflow'

  const showButtons = shouldShowRunSkipButtons(toolCall)

  // Check UI config for secondary action
  const toolUIConfig = getToolUIConfig(toolCall.name)
  const secondaryAction = toolUIConfig?.secondaryAction
  const showSecondaryAction = secondaryAction?.showInStates.includes(
    toolCall.state as ClientToolCallState
  )

  // Legacy fallbacks for tools that haven't migrated to UI config
  const showMoveToBackground =
    showSecondaryAction && secondaryAction?.text === 'Move to Background'
      ? true
      : !secondaryAction &&
        toolCall.name === 'run_workflow' &&
        (toolCall.state === (ClientToolCallState.executing as any) ||
          toolCall.state === ('executing' as any))

  const showWake =
    showSecondaryAction && secondaryAction?.text === 'Wake'
      ? true
      : !secondaryAction &&
        toolCall.name === 'sleep' &&
        (toolCall.state === (ClientToolCallState.executing as any) ||
          toolCall.state === ('executing' as any))

  const handleStateChange = (state: any) => {
    forceUpdate({})
    onStateChange?.(state)
  }

  const displayName = getDisplayName(toolCall)

  const isLoadingState =
    toolCall.state === ClientToolCallState.generating ||
    toolCall.state === ClientToolCallState.pending ||
    toolCall.state === ClientToolCallState.executing

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
      // Get inputs - could be in multiple locations
      let inputs = editedParams.input || editedParams.inputs || editedParams.workflow_input
      let isNestedInWorkflowInput = false

      // If input is a JSON string, parse it
      if (typeof inputs === 'string') {
        try {
          inputs = JSON.parse(inputs)
        } catch {
          inputs = {}
        }
      }

      // Check if workflow_input exists and contains the actual inputs
      if (editedParams.workflow_input && typeof editedParams.workflow_input === 'object') {
        inputs = editedParams.workflow_input
        isNestedInWorkflowInput = true
      }

      // If no inputs object found, treat base editedParams as inputs (excluding system fields)
      if (!inputs || typeof inputs !== 'object') {
        const { workflowId, workflow_input, ...rest } = editedParams
        inputs = rest
      }

      const safeInputs = inputs && typeof inputs === 'object' ? inputs : {}
      const inputEntries = Object.entries(safeInputs)

      // Don't show the section if there are no inputs
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
        // For objects and arrays, use JSON.stringify with formatting
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
        // If original was a primitive, keep as string
        if (typeof originalValue !== 'object' || originalValue === null) {
          return value
        }
        // Try to parse as JSON for objects/arrays
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
          <div className='flex flex-col'>
            {inputEntries.map(([key, value], index) => {
              const isComplex = isComplexValue(value)
              const displayValue = formatValueForDisplay(value)

              return (
                <div
                  key={key}
                  className={clsx(
                    'flex flex-col gap-1.5 px-[10px] py-[8px]',
                    index > 0 && 'border-[var(--border-1)] border-t'
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

  // Special handling for tools with alwaysExpanded config (e.g., set_environment_variables)
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
            active={isLoadingState}
            isSpecial={isSpecial}
            className='font-[470] font-season text-[var(--text-secondary)] text-sm dark:text-[var(--text-muted)]'
          />
        </div>
        <div className='mt-1.5'>{renderPendingDetails()}</div>
        {showRemoveAutoAllow && isAutoAllowed && (
          <div className='mt-1.5'>
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
            isStreaming={toolCall.subAgentStreaming}
          />
        )}
      </div>
    )
  }

  // Special rendering for tools with 'code' customRenderer (e.g., function_execute)
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
            active={isLoadingState}
            isSpecial={isSpecial}
            className='font-[470] font-season text-[var(--text-secondary)] text-sm dark:text-[var(--text-muted)]'
          />
        </div>
        {code && (
          <div className='mt-1.5'>
            <Code.Viewer code={code} language='javascript' showGutter className='min-h-0' />
          </div>
        )}
        {showRemoveAutoAllow && isAutoAllowed && (
          <div className='mt-1.5'>
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
            isStreaming={toolCall.subAgentStreaming}
          />
        )}
      </div>
    )
  }

  // Determine if tool name should be clickable (expandable tools or auto-allowed integration tools)
  const isToolNameClickable = isExpandableTool || isAutoAllowed

  const handleToolNameClick = () => {
    if (isExpandableTool) {
      setExpanded((e) => !e)
    } else if (isAutoAllowed) {
      setShowRemoveAutoAllow((prev) => !prev)
    }
  }

  // For edit_workflow, hide text display when we have operations (WorkflowEditSummary replaces it)
  const isEditWorkflow = toolCall.name === 'edit_workflow'
  const hasOperations = Array.isArray(params.operations) && params.operations.length > 0
  const hideTextForEditWorkflow = isEditWorkflow && hasOperations

  return (
    <div className='w-full'>
      {!hideTextForEditWorkflow && (
        <div className={isToolNameClickable ? 'cursor-pointer' : ''} onClick={handleToolNameClick}>
          <ShimmerOverlayText
            text={displayName}
            active={isLoadingState}
            isSpecial={isSpecial}
            className='font-[470] font-season text-[var(--text-secondary)] text-sm dark:text-[var(--text-muted)]'
          />
        </div>
      )}
      {isExpandableTool && expanded && <div className='mt-1.5'>{renderPendingDetails()}</div>}
      {showRemoveAutoAllow && isAutoAllowed && (
        <div className='mt-1.5'>
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
        <div className='mt-1.5'>
          <Button
            onClick={async () => {
              try {
                const instance = getClientTool(toolCall.id)
                // Transition to background state locally so UI updates immediately
                instance?.setState?.((ClientToolCallState as any).background)
                await instance?.markToolComplete?.(
                  200,
                  'The user has chosen to move the workflow execution to the background. Check back with them later to know when the workflow execution is complete'
                )
                // Optionally force a re-render; store should sync state from server
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
        <div className='mt-1.5'>
          <Button
            onClick={async () => {
              try {
                const instance = getClientTool(toolCall.id)
                // Get elapsed seconds before waking
                const elapsedSeconds = instance?.getElapsedSeconds?.() || 0
                // Transition to background state locally so UI updates immediately
                // Pass elapsed seconds in the result so dynamic text can use it
                instance?.setState?.((ClientToolCallState as any).background, {
                  result: { _elapsedSeconds: elapsedSeconds },
                })
                // Update the tool call params in the store to include elapsed time for display
                const { updateToolCallParams } = useCopilotStore.getState()
                updateToolCallParams?.(toolCall.id, { _elapsedSeconds: Math.round(elapsedSeconds) })
                await instance?.markToolComplete?.(
                  200,
                  `User woke you up after ${Math.round(elapsedSeconds)} seconds`
                )
                // Optionally force a re-render; store should sync state from server
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
          isStreaming={toolCall.subAgentStreaming}
        />
      )}
    </div>
  )
}
