import type {
  InlineContent,
  ParsedMessageContent,
  ToolCallIndicator,
  ToolCallState,
} from '@/types/tool-call'

// Tool ID to display name mapping for better UX
const TOOL_DISPLAY_NAMES: Record<string, string> = {
  docs_search_internal: 'Searching documentation',
  get_user_workflow: 'Analyzing your workflow',
  get_blocks_and_tools: 'Getting context',
  get_blocks_metadata: 'Getting context',
  get_yaml_structure: 'Designing an approach',
  edit_workflow: 'Building your workflow',
}

// Past tense versions for completed tool calls
const TOOL_PAST_TENSE_NAMES: Record<string, string> = {
  docs_search_internal: 'Searched documentation',
  get_user_workflow: 'Analyzed your workflow',
  get_blocks_and_tools: 'Understood context',
  get_blocks_metadata: 'Understood context',
  get_yaml_structure: 'Designed an approach',
  edit_workflow: 'Built your workflow',
}

// Regex patterns to detect structured tool call events
const TOOL_CALL_PATTERNS = {
  // Matches structured tool call events: __TOOL_CALL_EVENT__{"type":"..."}__TOOL_CALL_EVENT__
  toolCallEvent: /__TOOL_CALL_EVENT__(.*?)__TOOL_CALL_EVENT__/g,
  // Fallback patterns for legacy emoji indicators (if needed)
  statusIndicator: /🔄\s+([^🔄\n]+)/gu,
  thinkingPattern: /(\.\.\.|…|💭|🤔)/g,
  functionCall: /(\w+)\s*\(\s*([^)]*)\s*\)/g,
  completionIndicator: /✅|☑️|✓|Done|Complete/g,
  errorIndicator: /❌|⚠️|Error|Failed/g,
}

/**
 * Extract tool names from a status message
 */
export function extractToolNames(statusMessage: string): string[] {
  // Remove the 🔄 indicator and split on • or bullet points
  const cleanMessage = statusMessage.replace(/🔄\s*/, '').trim()

  // Split on common separators
  const toolNames = cleanMessage
    .split(/[•·|,&]/)
    .map((name) => name.trim())
    .filter((name) => name.length > 0)

  return toolNames
}

/**
 * Get display name for a tool
 */
export function getToolDisplayName(toolId: string, isCompleted = false): string {
  if (isCompleted) {
    return TOOL_PAST_TENSE_NAMES[toolId] || TOOL_DISPLAY_NAMES[toolId] || toolId.replace(/_/g, ' ')
  }
  return TOOL_DISPLAY_NAMES[toolId] || toolId.replace(/_/g, ' ')
}

/**
 * Parse structured tool call events from the stream and maintain state transitions
 */
export function parseToolCallEvents(
  content: string,
  existingToolCalls: ToolCallState[] = []
): ToolCallState[] {
  const toolCallsMap = new Map<string, ToolCallState>()

  // Start with existing tool calls
  existingToolCalls.forEach((tc) => {
    toolCallsMap.set(tc.id, { ...tc })
  })

  const matches = content.matchAll(TOOL_CALL_PATTERNS.toolCallEvent)

  for (const match of matches) {
    try {
      const eventData = JSON.parse(match[1])

      switch (eventData.type) {
        case 'tool_call_detected':
          if (!toolCallsMap.has(eventData.toolCall.id)) {
            toolCallsMap.set(eventData.toolCall.id, {
              ...eventData.toolCall,
              startTime: Date.now(),
            })
          }
          break

        case 'tool_calls_start':
          eventData.toolCalls.forEach((toolCall: any) => {
            if (!toolCallsMap.has(toolCall.id)) {
              toolCallsMap.set(toolCall.id, {
                ...toolCall,
                startTime: Date.now(),
              })
            } else {
              // Update existing tool call to executing state
              const existing = toolCallsMap.get(toolCall.id)!
              toolCallsMap.set(toolCall.id, {
                ...existing,
                state: 'executing',
                parameters: toolCall.parameters || existing.parameters,
              })
            }
          })
          break

        case 'tool_call_complete': {
          const completedToolCall = eventData.toolCall
          if (toolCallsMap.has(completedToolCall.id)) {
            // Update existing tool call to completed state
            const existing = toolCallsMap.get(completedToolCall.id)!
            toolCallsMap.set(completedToolCall.id, {
              ...existing,
              state: completedToolCall.state,
              endTime: completedToolCall.endTime,
              duration: completedToolCall.duration,
              result: completedToolCall.result,
              error: completedToolCall.error,
            })
          } else {
            // Create new completed tool call if it doesn't exist
            toolCallsMap.set(completedToolCall.id, completedToolCall)
          }
          break
        }
      }
    } catch (error) {
      console.warn('Failed to parse tool call event:', error)
    }
  }

  return Array.from(toolCallsMap.values())
}

/**
 * Parse a tool call status message and extract tool information (fallback for legacy)
 */
export function parseToolCallStatus(content: string): ToolCallIndicator | null {
  // First check for structured events
  const structuredEvents = parseToolCallEvents(content)
  if (structuredEvents.length > 0) {
    return {
      type: 'status',
      content: content,
      toolNames: structuredEvents.map((e) => e.displayName || e.name),
    }
  }

  // Fallback to legacy emoji parsing
  const statusMatch = content.match(TOOL_CALL_PATTERNS.statusIndicator)

  if (statusMatch) {
    const statusText = statusMatch[0]
    const toolNames = extractToolNames(statusText)

    return {
      type: 'status',
      content: statusText,
      toolNames,
    }
  }

  // Check for thinking patterns
  if (TOOL_CALL_PATTERNS.thinkingPattern.test(content)) {
    return {
      type: 'thinking',
      content: content.trim(),
    }
  }

  // Check for function call patterns
  const functionMatch = content.match(TOOL_CALL_PATTERNS.functionCall)
  if (functionMatch) {
    return {
      type: 'execution',
      content: content.trim(),
    }
  }

  return null
}

/**
 * Create a tool call state from detected information
 */
export function createToolCallState(
  name: string,
  parameters?: Record<string, any>,
  state: ToolCallState['state'] = 'detecting'
): ToolCallState {
  return {
    id: `${name}-${Date.now()}-${Math.random().toString(36).slice(2)}`,
    name,
    displayName: getToolDisplayName(name),
    parameters,
    state,
    startTime: Date.now(),
  }
}

/**
 * Parse message content and maintain inline positioning of tool calls
 */
export function parseMessageContent(
  content: string,
  existingToolCalls: ToolCallState[] = []
): ParsedMessageContent {
  // Get all tool call events with state transitions
  const toolCallEvents = parseToolCallEvents(content, existingToolCalls)
  const toolCallsMap = new Map<string, ToolCallState>()

  toolCallEvents.forEach((tc) => {
    toolCallsMap.set(tc.id, tc)
  })

  // Parse content maintaining inline positioning and deduplicating tool calls
  const inlineContent: InlineContent[] = []
  const toolCallPositions = new Map<string, number>() // Track where each tool call first appears
  let currentTextBuffer = ''

  // Split content into segments, preserving tool call markers inline
  const segments = content.split(/(__TOOL_CALL_EVENT__.*?__TOOL_CALL_EVENT__)/)

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i]

    if (segment.match(/__TOOL_CALL_EVENT__.*?__TOOL_CALL_EVENT__/)) {
      // This is a tool call event

      try {
        const eventMatch = segment.match(/__TOOL_CALL_EVENT__(.*?)__TOOL_CALL_EVENT__/)
        if (eventMatch) {
          const eventData = JSON.parse(eventMatch[1])
          let toolCallId: string | undefined
          let toolCall: ToolCallState | undefined

          switch (eventData.type) {
            case 'tool_call_detected': {
              const id = eventData.toolCall?.id
              if (id) {
                toolCallId = id
                toolCall = toolCallsMap.get(id)
              }
              break
            }
            case 'tool_calls_start': {
              // For multiple tool calls, use the first one
              const id = eventData.toolCalls?.[0]?.id
              if (id) {
                toolCallId = id
                toolCall = toolCallsMap.get(id)
              }
              break
            }
            case 'tool_call_complete': {
              const id = eventData.toolCall?.id
              if (id) {
                toolCallId = id
                toolCall = toolCallsMap.get(id)
              }
              break
            }
          }

          if (toolCallId && toolCall) {
            if (toolCallPositions.has(toolCallId)) {
              // Update existing tool call in place
              const existingIndex = toolCallPositions.get(toolCallId)!
              if (
                inlineContent[existingIndex] &&
                inlineContent[existingIndex].type === 'tool_call'
              ) {
                inlineContent[existingIndex].toolCall = toolCall
              }
            } else {
              // First time seeing this tool call - add accumulated text first
              if (currentTextBuffer.trim()) {
                inlineContent.push({
                  type: 'text',
                  content: currentTextBuffer.trim(),
                })
                currentTextBuffer = ''
              }

              // Add new tool call and remember its position
              const newIndex = inlineContent.length
              inlineContent.push({
                type: 'tool_call',
                content: segment,
                toolCall,
              })
              toolCallPositions.set(toolCallId, newIndex)
            }
          } else {
            // If parsing fails or no tool call found, treat as text
            currentTextBuffer += segment
          }
        }
      } catch (error) {
        // If parsing fails, treat as text
        currentTextBuffer += segment
      }
    } else {
      // Regular text content
      currentTextBuffer += segment
    }
  }

  // Add any remaining text
  if (currentTextBuffer.trim()) {
    inlineContent.push({
      type: 'text',
      content: currentTextBuffer.trim(),
    })
  }

  // Create clean text content for fallback
  const cleanTextContent = content.replace(TOOL_CALL_PATTERNS.toolCallEvent, '').trim()

  return {
    textContent: cleanTextContent,
    toolCalls: Array.from(toolCallsMap.values()),
    toolGroups: [], // No grouping for inline display
    inlineContent,
  }
}

/**
 * Update tool call states based on new content
 */
export function updateToolCallStates(
  existingToolCalls: ToolCallState[],
  newContent: string
): ToolCallState[] {
  const updatedToolCalls = [...existingToolCalls]

  // Look for completion or error indicators
  if (TOOL_CALL_PATTERNS.completionIndicator.test(newContent)) {
    // Mark executing tools as completed
    updatedToolCalls.forEach((toolCall) => {
      if (toolCall.state === 'executing') {
        toolCall.state = 'completed'
        toolCall.endTime = Date.now()
        toolCall.duration = toolCall.endTime - (toolCall.startTime || 0)
      }
    })
  } else if (TOOL_CALL_PATTERNS.errorIndicator.test(newContent)) {
    // Mark executing tools as error
    updatedToolCalls.forEach((toolCall) => {
      if (toolCall.state === 'executing') {
        toolCall.state = 'error'
        toolCall.endTime = Date.now()
        toolCall.duration = toolCall.endTime - (toolCall.startTime || 0)
        toolCall.error = 'Tool execution failed'
      }
    })
  }

  return updatedToolCalls
}

/**
 * Check if content contains tool call indicators
 */
export function hasToolCallIndicators(content: string): boolean {
  return (
    TOOL_CALL_PATTERNS.toolCallEvent.test(content) ||
    TOOL_CALL_PATTERNS.statusIndicator.test(content) ||
    TOOL_CALL_PATTERNS.functionCall.test(content) ||
    TOOL_CALL_PATTERNS.thinkingPattern.test(content)
  )
}

/**
 * Remove tool call indicators from content, leaving only text
 */
export function stripToolCallIndicators(content: string): string {
  return content
    .replace(TOOL_CALL_PATTERNS.toolCallEvent, '')
    .replace(TOOL_CALL_PATTERNS.statusIndicator, '')
    .replace(/\n\s*\n/g, '\n')
    .trim()
}

/**
 * Parse streaming content incrementally
 */
export function parseStreamingContent(
  accumulatedContent: string,
  newChunk: string,
  existingToolCalls: ToolCallState[] = []
): {
  parsedContent: ParsedMessageContent
  updatedToolCalls: ToolCallState[]
} {
  const fullContent = accumulatedContent + newChunk
  const parsedContent = parseMessageContent(fullContent, existingToolCalls)

  // The parseMessageContent now handles state transitions, so we use its tool calls
  const updatedToolCalls = parsedContent.toolCalls

  return {
    parsedContent,
    updatedToolCalls,
  }
}
