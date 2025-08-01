'use client'

import { type FC, memo, useEffect, useMemo, useState, useRef } from 'react'
import {
  Check,
  CheckCircle,
  Clipboard,
  Code,
  Copy,
  Database,
  Edit,
  Eye,
  FileText,
  Globe,
  History,
  Lightbulb,
  Loader2,
  Minus,
  RotateCcw,
  Search,
  Settings,
  ThumbsDown,
  ThumbsUp,
  Wrench,
  X,
  XCircle,
  Zap,
} from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import { COPILOT_TOOL_IDS } from '@/stores/copilot/constants'
import { COPILOT_TOOL_DISPLAY_NAMES, COPILOT_TOOL_PAST_TENSE, COPILOT_TOOL_ERROR_NAMES } from '@/stores/constants'
import type { CopilotMessage } from '@/stores/copilot/types'
import type { ToolCallState } from '@/types/tool-call'
import { useCopilotStore } from '@/stores/copilot/store'
import { toolRequiresInterrupt } from '@/stores/copilot/constants'
import { useWorkflowExecution } from '@/app/workspace/[workspaceId]/w/[workflowId]/hooks/use-workflow-execution'
import { useChatStore } from '@/stores/panel/chat/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { cn } from '@/lib/utils'

interface ProfessionalMessageProps {
  message: CopilotMessage
  isStreaming?: boolean
}

// Memoized streaming indicator component for better performance
const StreamingIndicator = memo(() => (
  <div className='flex items-center py-1 text-muted-foreground transition-opacity duration-200 ease-in-out'>
    <div className='flex space-x-0.5'>
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0ms', animationDuration: '1.2s' }}
      />
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0.15s', animationDuration: '1.2s' }}
      />
      <div
        className='h-1 w-1 animate-bounce rounded-full bg-muted-foreground'
        style={{ animationDelay: '0.3s', animationDuration: '1.2s' }}
      />
    </div>
  </div>
))

StreamingIndicator.displayName = 'StreamingIndicator'

// Smooth streaming text component with typewriter effect
interface SmoothStreamingTextProps {
  content: string
  isStreaming: boolean
  markdownComponents: any
}

const SmoothStreamingText = memo(({ content, isStreaming, markdownComponents }: SmoothStreamingTextProps) => {
  const [displayedContent, setDisplayedContent] = useState('')
  const contentRef = useRef(content)
  const timeoutRef = useRef<NodeJS.Timeout | null>(null)
  const indexRef = useRef(0)
  const displayedLengthRef = useRef(0)
  const isAnimatingRef = useRef(false)

  useEffect(() => {
    // Update content reference
    contentRef.current = content
    
    if (content.length === 0) {
      setDisplayedContent('')
      indexRef.current = 0
      displayedLengthRef.current = 0
      return
    }

    // If content increased and we're streaming, animate the new characters
    if (isStreaming && content.length > displayedLengthRef.current) {
      const animateText = () => {
        const currentContent = contentRef.current
        const currentIndex = indexRef.current
        
        if (currentIndex < currentContent.length) {
          // Add characters in small chunks for smoother appearance
          const chunkSize = Math.min(3, currentContent.length - currentIndex)
          const newDisplayed = currentContent.slice(0, currentIndex + chunkSize)
          
          setDisplayedContent(newDisplayed)
          indexRef.current = currentIndex + chunkSize
          displayedLengthRef.current = newDisplayed.length
          
          // Consistent fast speed for all characters
          const delay = 3 // Consistent fast delay in ms for all characters
          
          timeoutRef.current = setTimeout(animateText, delay)
        } else {
          // Animation complete
          isAnimatingRef.current = false
        }
      }

      // Only start new animation if not already animating
      if (!isAnimatingRef.current) {
        // Clear any existing animation
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current)
        }
        
        isAnimatingRef.current = true
        // Start or continue animation from where we left off
        animateText()
      }
    } else if (!isStreaming) {
      // Not streaming, show all content immediately
      setDisplayedContent(content)
      indexRef.current = content.length
      displayedLengthRef.current = content.length
      isAnimatingRef.current = false
    }

    // Cleanup on unmount
    return () => {
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current)
      }
      isAnimatingRef.current = false
    }
  }, [content, isStreaming])

  return (
    <div className='relative' style={{ minHeight: '1.25rem' }}>
      <div className='whitespace-pre-wrap break-words text-foreground'>
        <ReactMarkdown
          remarkPlugins={[remarkGfm]}
          components={markdownComponents}
        >
          {displayedContent}
        </ReactMarkdown>
      </div>
    </div>
  )
}, (prevProps, nextProps) => {
  // Prevent re-renders during streaming unless content actually changed
  return (
    prevProps.content === nextProps.content &&
    prevProps.isStreaming === nextProps.isStreaming
    // markdownComponents is now memoized so no need to compare
  )
})

SmoothStreamingText.displayName = 'SmoothStreamingText'

// Maximum character length for a word before it's broken up
const MAX_WORD_LENGTH = 25

const WordWrap = ({ text }: { text: string }) => {
  if (!text) return null

  // Split text into words, keeping spaces and punctuation
  const parts = text.split(/(\s+)/g)

  return (
    <>
      {parts.map((part, index) => {
        // If the part is whitespace or shorter than the max length, render it as is
        if (part.match(/\s+/) || part.length <= MAX_WORD_LENGTH) {
          return <span key={index}>{part}</span>
        }

        // For long words, break them up into chunks
        const chunks = []
        for (let i = 0; i < part.length; i += MAX_WORD_LENGTH) {
          chunks.push(part.substring(i, i + MAX_WORD_LENGTH))
        }

        return (
          <span key={index} className='break-all'>
            {chunks.map((chunk, chunkIndex) => (
              <span key={chunkIndex}>{chunk}</span>
            ))}
          </span>
        )
      })}
    </>
  )
}

// Helper function to get tool display name based on state
function getToolDisplayName(toolName: string): string {
  return COPILOT_TOOL_DISPLAY_NAMES[toolName] || toolName
}

function getToolDisplayNameByState(toolCall: any): string {
  const toolName = toolCall.name
  const state = toolCall.state
  const isWorkflowTool = toolName === COPILOT_TOOL_IDS.BUILD_WORKFLOW || toolName === COPILOT_TOOL_IDS.EDIT_WORKFLOW
  const isInterruptTool = toolRequiresInterrupt(toolName)
  

  
  // Check if tool is in interrupt state (awaiting approval)
  if (isInterruptTool && (state === 'executing' || state === 'pending')) {
    // Custom display for environment variable tool
    if (toolName === COPILOT_TOOL_IDS.SET_ENVIRONMENT_VARIABLES) {
      // Extract the environment variable name from parameters or args
      const params = toolCall.parameters || toolCall.args || {}
      
      // The tool expects a 'variables' object with key-value pairs
      if (params.variables && typeof params.variables === 'object') {
        const varNames = Object.keys(params.variables)
        if (varNames.length > 0) {
          const firstVarName = varNames[0]
          const truncatedName = firstVarName.length > 15 ? firstVarName.substring(0, 15) + '...' : firstVarName
          // If multiple variables, indicate that
          const suffix = varNames.length > 1 ? ` (+${varNames.length - 1} more)` : ''
          return `Setting environment variable ${truncatedName}${suffix}`
        }
      }
      
      // Fallback if structure is unexpected
      return 'Setting environment variables'
    }
    
    // Custom display for run workflow tool
    if (toolName === COPILOT_TOOL_IDS.RUN_WORKFLOW) {
      // Extract workflow information from parameters or args
      const params = toolCall.parameters || toolCall.args || {}
      
      if (params.description) {
        const truncatedDescription = params.description.length > 30 ? params.description.substring(0, 30) + '...' : params.description
        return `Running workflow: ${truncatedDescription}`
      }
      
      if (params.workflowId) {
        const truncatedId = params.workflowId.length > 20 ? params.workflowId.substring(0, 20) + '...' : params.workflowId
        return `Running workflow: ${truncatedId}`
      }
      
      // Fallback if structure is unexpected
      return 'Running workflow'
    }
    // Add more custom interrupt tool displays here as needed
    
    // Default for other interrupt tools
    return getToolDisplayName(toolName)
  }
  
  // Check for rejected state first (highest priority)
  if (state === 'rejected') {
    if (isWorkflowTool) {
      return 'Rejected workflow changes'
    } else if (isInterruptTool) {
      return `Skipped ${getToolDisplayName(toolName).toLowerCase()}`
    } else {
      return `Rejected ${getToolDisplayName(toolName).toLowerCase()}`
    }
  }
  
  // Check if error is actually a rejection by examining the error message
  if (state === 'error' && toolCall.error) {
    const errorMessage = typeof toolCall.error === 'string' ? toolCall.error : toolCall.error.message || ''
    if (errorMessage.toLowerCase().includes('rejected') || 
        errorMessage.toLowerCase().includes('not approved') ||
        errorMessage.toLowerCase().includes('denied') ||
        errorMessage.toLowerCase().includes('skip')) {
      if (isWorkflowTool) {
        return 'Rejected workflow changes'
      } else if (isInterruptTool) {
        return `Skipped ${getToolDisplayName(toolName).toLowerCase()}`
      } else {
        return `Rejected ${getToolDisplayName(toolName).toLowerCase()}`
      }
    }
  }
  
  if (state === 'ready_for_review' && isWorkflowTool) {
    // Special display for workflow tools awaiting review
    const baseText = COPILOT_TOOL_PAST_TENSE[toolName] || getToolDisplayName(toolName)
    return `${baseText} - ready for review`
  } else if (state === 'applied' && isWorkflowTool) {
    // Show completion/done state after accept
    return 'Applied workflow changes'
  } else if (state === 'completed' || state === 'applied') {
    // Regular tools and non-workflow applied states use past tense
    return COPILOT_TOOL_PAST_TENSE[toolName] || getToolDisplayName(toolName)
  } else if (state === 'error') {
    return COPILOT_TOOL_ERROR_NAMES[toolName] || `Errored ${getToolDisplayName(toolName).toLowerCase()}`
  } else {
    // For executing, aborted, etc. - use present tense
    return getToolDisplayName(toolName)
  }
}



// Inline Tool Call Component
function InlineToolCall({ tool, stepNumber }: { tool: ToolCallState | any; stepNumber?: number }) {
  // Check if this tool requires interrupt and is in a pending/executing state
  const requiresInterrupt = toolRequiresInterrupt(tool.name)
  const showInterruptConfirmation = requiresInterrupt && 
    (tool.state === 'executing' || tool.state === 'pending')

  // Get access to the copilot store
  const { updatePreviewToolCallState } = useCopilotStore()
  
  // State for processing approval
  const [isProcessing, setIsProcessing] = useState(false)
  // State for tracking workflow execution (for run_workflow tool)
  const [isWorkflowExecuting, setIsWorkflowExecuting] = useState(false)
  // State for processing background move
  const [isMovingToBackground, setIsMovingToBackground] = useState(false)

  const getToolIcon = () => {
    const displayName = tool.displayName || tool.name || ''
    const lowerName = displayName.toLowerCase()

    if (lowerName.includes('analyz') && lowerName.includes('workflow')) {
      return <Search className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('block') && lowerName.includes('information')) {
      return <Eye className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('structure')) {
      return <Search className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('build') || lowerName.includes('creat')) {
      return <Wrench className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('search') || lowerName.includes('find')) {
      return <Search className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('edit') || lowerName.includes('modif')) {
      return <Code className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('doc') || lowerName.includes('help')) {
      return <FileText className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('environment') || lowerName.includes('variable')) {
      return <Edit className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('tool') || lowerName.includes('method')) {
      return <Zap className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('workflow') && lowerName.includes('console')) {
      return <Database className='h-3 w-3 text-muted-foreground' />
    }
    if (lowerName.includes('online') || lowerName.includes('web')) {
      return <Globe className='h-3 w-3 text-muted-foreground' />
    }

    // Default icon
    return <Lightbulb className='h-3 w-3 text-muted-foreground' />
  }

  const getStateIcon = () => {
    const isWorkflowTool = tool.name === COPILOT_TOOL_IDS.BUILD_WORKFLOW
    const isInterruptTool = toolRequiresInterrupt(tool.name)
    
    // Special handling for tools requiring interrupt
    if (requiresInterrupt && tool.state === 'executing') {
      return <Loader2 className='h-3 w-3 animate-spin text-yellow-600' />
    }
    
    switch (tool.state) {
      case 'executing':
        return <Loader2 className='h-3 w-3 animate-spin text-muted-foreground' />
      case 'completed':
        return isWorkflowTool 
          ? <CheckCircle className='h-3 w-3 text-muted-foreground' />
          : getToolIcon() // Use the actual tool icon instead of Search
      case 'ready_for_review':
        // For workflow tools, ready_for_review means complete with diff ready
        return isWorkflowTool 
          ? <CheckCircle className='h-3 w-3 text-muted-foreground' />
          : getToolIcon() // Use the actual tool icon instead of Search
      case 'applied':
        return isWorkflowTool 
          ? <CheckCircle className='h-3 w-3 text-muted-foreground' />
          : getToolIcon() // Use the actual tool icon instead of Search
      case 'rejected':
        // Gray dash for interrupt tools, red X for workflow tools
        return isInterruptTool 
          ? <div className='h-3 w-3 rounded-full border border-gray-400 flex items-center justify-center'>
              <Minus className='h-2 w-2 text-gray-500' />
            </div>
          : <XCircle className='h-3 w-3 text-red-500' />
      case 'aborted':
        return <XCircle className='h-3 w-3 text-muted-foreground' />
      case 'error':
        return <XCircle className='h-3 w-3 text-red-500' />
      default:
        return getToolIcon()
    }
  }

  // Get workflow execution hook for run_workflow tool
  const { handleRunWorkflow } = useWorkflowExecution()
  
  // Get current workflow ID and conversation ID for chat execution
  const { activeWorkflowId } = useWorkflowRegistry()
  const { getConversationId } = useChatStore()

  // API call to move workflow to background
  const handleMoveToBackground = async (toolCallId: string) => {
    if (isMovingToBackground) return
    
    setIsMovingToBackground(true)
    
    try {
      // Send confirmation with background message
      const response = await fetch('/api/copilot/confirm', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
                  body: JSON.stringify({
            toolCallId,
            status: 'Accept',
            message: 'The user moved workflow execution to the background. Execution is not yet complete'
          }),
      })

      if (!response.ok) {
        const error = await response.json()
        console.error('Failed to move workflow to background:', error)
      } else {
        updatePreviewToolCallState('applied', toolCallId)
        setIsWorkflowExecuting(false) // Stop showing the background button
        console.log(`Workflow ${toolCallId} moved to background`)
      }
    } catch (error) {
      console.error('Error moving workflow to background:', error)
    } finally {
      setIsMovingToBackground(false)
    }
  }

  // API call to confirm tool action
  const handleConfirmTool = async (toolCallId: string, status: 'Accept' | 'Reject') => {
    if (isProcessing) return
    
    setIsProcessing(true)
    
    try {
      // Special handling for run_workflow tool
      if (tool.name === COPILOT_TOOL_IDS.RUN_WORKFLOW) {
        if (status === 'Reject') {
          // For rejection, immediately update state and call confirm API
          updatePreviewToolCallState('rejected', toolCallId)
          
          const response = await fetch('/api/copilot/confirm', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              toolCallId,
              status,
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            console.log(`Tool ${toolCallId} rejected by user`)
          }
          return
        }
        
        // For acceptance, show spinner during workflow execution
        console.log('Executing workflow via run_workflow tool...')
        console.log('🔍 Full tool object:', JSON.stringify(tool, null, 2))
        
        // Get chat parameter from tool call if available
        const params = tool.input || tool.parameters || tool.args || {}
        console.log('🔍 Extracted params:', JSON.stringify(params, null, 2))
        
        const chatInput = params.workflow_input
        console.log('🔍 Chat input extracted:', chatInput)
        
        // Execute the workflow and wait for completion
        try {
          // Get conversation ID for the current workflow to ensure proper chat execution
          const conversationId = activeWorkflowId ? getConversationId(activeWorkflowId) : undefined
          console.log('🔍 Active workflow ID:', activeWorkflowId)
          console.log('🔍 Conversation ID:', conversationId)
          
          const workflowInput = chatInput ? { 
            input: chatInput,
            conversationId: conversationId
          } : undefined
          
          console.log('🔍 Final workflow input:', JSON.stringify(workflowInput, null, 2))
          
          // Execute workflow (tool stays in pending state showing spinner)
          setIsWorkflowExecuting(true)
          const workflowResult = await handleRunWorkflow(workflowInput)
          console.log('Workflow execution started, result:', workflowResult)
          
          // For chat executions, we need to wait for the execution to actually complete
          // We'll monitor the isExecuting state from the workflow execution hook
          if (workflowResult && 'stream' in workflowResult) {
            console.log('Chat execution started, waiting for completion...')
            // Wait for the execution to complete by consuming the stream
            await new Promise<void>((resolve, reject) => {
              // For now, consume the stream to wait for completion
              if (workflowResult.stream) {
                const reader = workflowResult.stream.getReader()
                const pump = async (): Promise<void> => {
                  try {
                    while (true) {
                      const { done } = await reader.read()
                      if (done) {
                        resolve()
                        break
                      }
                    }
                  } catch (error) {
                    reject(error)
                  }
                }
                pump()
              } else {
                // No stream, resolve immediately
                resolve()
              }
            })
            console.log('Chat execution completed')
          } else {
            console.log('Manual execution completed')
          }
          
          // Only update state to 'applied' after successful execution
          setIsWorkflowExecuting(false)
          updatePreviewToolCallState('applied', toolCallId)
          
          // Now call the confirm API after workflow execution completes
          const response = await fetch('/api/copilot/confirm', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              toolCallId,
              status,
              message: 'Workflow execution finished, check console logs to see output'
            }),
          })

          if (!response.ok) {
            const error = await response.json()
            throw new Error(error.error || 'Failed to confirm tool after workflow execution')
          }

          const confirmResult = await response.json()
          console.log(`Tool ${toolCallId} ${status.toLowerCase()}ed after workflow execution:`, confirmResult)
        } catch (workflowError) {
          console.error('Workflow execution failed:', workflowError)
          // Update state to error on failure
          setIsWorkflowExecuting(false)
          updatePreviewToolCallState('error', toolCallId)
          throw workflowError
        }
      } else {
        // For all other tools, immediately update state and call confirm API
        const newState = status === 'Accept' ? 'applied' : 'rejected'
        updatePreviewToolCallState(newState, toolCallId)
        
        const response = await fetch('/api/copilot/confirm', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            toolCallId,
            status,
          }),
        })

        if (!response.ok) {
          const error = await response.json()
          // Don't throw error for rejections - user explicitly chose to reject
          if (status === 'Reject') {
            console.log(`Tool ${toolCallId} rejected by user`)
            return
          }
          throw new Error(error.error || 'Failed to confirm tool')
        }

        const confirmResult = await response.json()
        console.log(`Tool ${toolCallId} ${status.toLowerCase()}ed:`, confirmResult)
      }
    } catch (error) {
      // Don't show errors for explicit rejections
      if (status === 'Reject') {
        console.log(`Tool ${toolCallId} rejected by user (server error ignored)`)
        return
      }
      console.error('Error confirming tool:', error)
      throw error
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className='flex items-center justify-between gap-2 py-1'>
      <div className='flex items-center gap-2 text-muted-foreground'>
        <div className='flex-shrink-0'>{getStateIcon()}</div>
        <span className='text-sm'>{getToolDisplayNameByState(tool)}</span>
      </div>
      
      {showInterruptConfirmation && (
        <div className='flex items-center gap-1.5'>
          <Button
            onClick={() => handleConfirmTool(tool.id, 'Accept')}
            disabled={isProcessing}
            size="sm"
            className='h-6 px-2 text-xs font-medium bg-gray-900 text-white hover:bg-gray-800 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-200 disabled:opacity-50'
          >
            {isProcessing ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
            Run
          </Button>
          <Button
            onClick={() => handleConfirmTool(tool.id, 'Reject')}
            disabled={isProcessing}
            size="sm"
            className='h-6 px-2 text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 disabled:opacity-50'
          >
            Skip
          </Button>
        </div>
      )}

      {/* Show move to background option during workflow execution */}
      {tool.name === COPILOT_TOOL_IDS.RUN_WORKFLOW && isWorkflowExecuting && (
        <div className='flex items-center gap-1.5'>
          <span className='text-xs text-muted-foreground'>Executing workflow...</span>
          <Button
            onClick={() => handleMoveToBackground(tool.id)}
            disabled={isMovingToBackground}
            size="sm"
            className='h-6 px-2 text-xs font-medium bg-gray-100 text-gray-600 hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-400 dark:hover:bg-gray-700 disabled:opacity-50'
          >
            {isMovingToBackground ? <Loader2 className='mr-1 h-3 w-3 animate-spin' /> : null}
            Move to background
          </Button>
        </div>
      )}
    </div>
  )
}

const ProfessionalMessage: FC<ProfessionalMessageProps> = memo(({ message, isStreaming }) => {
  const isUser = message.role === 'user'
  const isAssistant = message.role === 'assistant'
  const [showCopySuccess, setShowCopySuccess] = useState(false)
  const [showUpvoteSuccess, setShowUpvoteSuccess] = useState(false)
  const [showDownvoteSuccess, setShowDownvoteSuccess] = useState(false)
  const [showRestoreConfirmation, setShowRestoreConfirmation] = useState(false)

  // Get checkpoint functionality from copilot store
  const { 
    messageCheckpoints: allMessageCheckpoints,
    revertToCheckpoint, 
    isRevertingCheckpoint 
  } = useCopilotStore()
  
  // Get checkpoints for this message if it's a user message
  const messageCheckpoints = isUser ? (allMessageCheckpoints[message.id] || []) : []
  const hasCheckpoints = messageCheckpoints.length > 0

  const handleCopyContent = () => {
    // Copy clean text content
    navigator.clipboard.writeText(message.content)
    setShowCopySuccess(true)
  }

  const handleUpvote = () => {
    // Reset downvote if it was active
    setShowDownvoteSuccess(false)
    setShowUpvoteSuccess(true)
  }

  const handleDownvote = () => {
    // Reset upvote if it was active
    setShowUpvoteSuccess(false)
    setShowDownvoteSuccess(true)
  }

  const handleRevertToCheckpoint = () => {
    setShowRestoreConfirmation(true)
  }

  const handleConfirmRevert = async () => {
    if (messageCheckpoints.length > 0) {
      // Use the most recent checkpoint for this message
      const latestCheckpoint = messageCheckpoints[0]
      try {
        await revertToCheckpoint(latestCheckpoint.id)
        setShowRestoreConfirmation(false)
      } catch (error) {
        console.error('Failed to revert to checkpoint:', error)
        setShowRestoreConfirmation(false)
      }
    }
  }

  const handleCancelRevert = () => {
    setShowRestoreConfirmation(false)
  }

  useEffect(() => {
    if (showCopySuccess) {
      const timer = setTimeout(() => {
        setShowCopySuccess(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [showCopySuccess])

  useEffect(() => {
    if (showUpvoteSuccess) {
      const timer = setTimeout(() => {
        setShowUpvoteSuccess(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [showUpvoteSuccess])

  useEffect(() => {
    if (showDownvoteSuccess) {
      const timer = setTimeout(() => {
        setShowDownvoteSuccess(false)
      }, 2000)
      return () => clearTimeout(timer)
    }
  }, [showDownvoteSuccess])

  const formatTimestamp = (timestamp: string) => {
    return new Date(timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  }

  // Get clean text content with double newline parsing
  const cleanTextContent = useMemo(() => {
    if (!message.content) return ''

    // Parse out excessive newlines (more than 2 consecutive newlines)
    return message.content.replace(/\n{3,}/g, '\n\n')
  }, [message.content])

  // Custom components for react-markdown with improved styling - memoized to prevent re-renders
  const markdownComponents = useMemo(() => ({
    code: ({ inline, className, children, ...props }: any) => {
      const match = /language-(\w+)/.exec(className || '')
      const language = match ? match[1] : ''

      if (!inline && language) {
        return (
          <div className='group relative overflow-hidden rounded-lg border border-border bg-muted/30'>
            <div className='flex items-center justify-between border-border/50 border-b bg-muted/50 px-3 py-1'>
              <span className='font-medium text-muted-foreground text-xs uppercase tracking-wide'>
                {language}
              </span>
              <Button
                variant='ghost'
                size='sm'
                className='h-4 w-4 p-0 opacity-70 hover:opacity-100'
                onClick={() => navigator.clipboard.writeText(String(children))}
              >
                <Copy className='h-3 w-3' />
              </Button>
            </div>
            <div className='overflow-hidden'>
              <pre className='m-0 overflow-hidden whitespace-pre-wrap break-all p-2 font-mono text-sm leading-relaxed'>
                <code className='break-all font-mono text-sm'>
                  {String(children).replace(/\n$/, '')}
                </code>
              </pre>
            </div>
          </div>
        )
      }

      return (
        <code
          className='break-words rounded-md border bg-muted/80 px-1.5 py-0.5 font-mono text-sm'
          {...props}
        >
          {children}
        </code>
      )
    },
    pre: ({ children }: any) => children,
    h1: ({ children }: any) => (
      <h1 className='mt-3 mb-2 font-bold text-base text-foreground leading-tight first:mt-0'>
        {children}
      </h1>
    ),
    h2: ({ children }: any) => (
      <h2 className='mt-2 mb-1 font-semibold text-foreground text-sm leading-tight'>{children}</h2>
    ),
    h3: ({ children }: any) => (
      <h3 className='mt-2 mb-1 font-semibold text-foreground text-sm leading-tight'>{children}</h3>
    ),
    p: ({ children }: any) => (
      <p className='mb-[0.025rem] text-foreground leading-tight last:mb-0'>{children}</p>
    ),
    a: ({ href, children }: any) => (
      <a
        href={href}
        target='_blank'
        rel='noopener noreferrer'
        className='font-medium text-blue-600 underline decoration-blue-600/30 underline-offset-2 transition-colors hover:text-blue-700 hover:decoration-blue-600/60 dark:text-blue-400 dark:hover:text-blue-300'
      >
        {children}
      </a>
    ),
    ul: ({ children }: any) => (
      <div className='border-muted-foreground/10 border-l-2 bg-muted/15 pl-3 py-1 -mt-1 mb-1 rounded-r-md'>
        <ul className='list-disc space-y-0 leading-none pl-4 my-0'>{children}</ul>
      </div>
    ),
    ol: ({ children }: any) => (
      <div className='border-muted-foreground/10 border-l-2 bg-muted/15 pl-3 py-1 -mt-1 mb-1 rounded-r-md'>
        <ol className='list-decimal space-y-0 leading-none pl-4 my-0'>{children}</ol>
      </div>
    ),
    li: ({ children }: any) => <li className='text-foreground leading-none my-0 py-0'>{children}</li>,
    blockquote: ({ children }: any) => (
      <blockquote className='border-muted-foreground/20 border-l-4 bg-muted/30 pl-3 text-muted-foreground italic leading-tight'>
        {children}
      </blockquote>
    ),
    table: ({ children }: any) => (
      <div className='overflow-x-auto rounded-lg border'>
        <table className='w-full text-sm'>{children}</table>
      </div>
    ),
    th: ({ children }: any) => (
      <th className='border-b bg-muted/50 px-2 text-left font-semibold text-sm leading-tight'>
        {children}
      </th>
    ),
    td: ({ children }: any) => (
      <td className='border-muted/30 border-b px-2 text-sm leading-tight'>{children}</td>
    ),
  }), [])

  // Memoize content blocks to avoid re-rendering unchanged blocks
  const memoizedContentBlocks = useMemo(() => {
    if (!message.contentBlocks || message.contentBlocks.length === 0) {
      return null
    }

    return message.contentBlocks.map((block, index) => {
      if (block.type === 'text') {
        const isLastTextBlock =
          index === message.contentBlocks!.length - 1 && block.type === 'text'
        // Clean content for this text block
        const cleanBlockContent = block.content.replace(/\n{3,}/g, '\n\n')
        
        // Use smooth streaming for the last text block if we're streaming
        const shouldUseSmoothing = isStreaming && isLastTextBlock
        
        return (
          <div 
            key={`text-${index}-${block.timestamp || index}`} 
            className='w-full transition-opacity duration-200 ease-in-out'
            style={{ 
              opacity: cleanBlockContent.length > 0 ? 1 : 0.7,
              transform: shouldUseSmoothing ? 'translateY(0)' : undefined,
              transition: shouldUseSmoothing ? 'transform 0.1s ease-out, opacity 0.2s ease-in-out' : 'opacity 0.2s ease-in-out'
            }}
          >
            <div className='overflow-wrap-anywhere relative whitespace-normal break-normal font-normal text-sm leading-tight'>
              {shouldUseSmoothing ? (
                <SmoothStreamingText
                  content={cleanBlockContent}
                  isStreaming={isStreaming}
                  markdownComponents={markdownComponents}
                />
              ) : (
                <div className='whitespace-pre-wrap break-words text-foreground'>
                  <ReactMarkdown
                    remarkPlugins={[remarkGfm]}
                    components={markdownComponents}
                  >
                    {cleanBlockContent}
                  </ReactMarkdown>
                </div>
              )}
            </div>
          </div>
        )
      }
      if (block.type === 'tool_call') {
        return (
          <div 
            key={`tool-${block.toolCall.id}`}
            className='transition-opacity duration-300 ease-in-out'
            style={{ opacity: 1 }}
          >
            <InlineToolCall tool={block.toolCall} />
          </div>
        )
      }
      return null
    })
  }, [message.contentBlocks, isStreaming])

  if (isUser) {
    return (
      <div className='w-full py-2'>
        <div className='flex justify-end'>
          <div className='max-w-[80%]'>
            <div className='rounded-[10px] px-3 py-2' style={{ backgroundColor: 'rgba(128, 47, 255, 0.08)' }}>
              <div className='whitespace-pre-wrap break-words font-normal text-foreground text-sm leading-tight'>
                <WordWrap text={message.content} />
              </div>
            </div>
            {hasCheckpoints && (
              <div className='mt-1 flex justify-end'>
                {showRestoreConfirmation ? (
                  <div className='flex items-center gap-2'>
                    <span className='text-xs text-muted-foreground'>Restore?</span>
                    <button
                      onClick={handleConfirmRevert}
                      disabled={isRevertingCheckpoint}
                      className='text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                      title='Confirm restore'
                    >
                      {isRevertingCheckpoint ? (
                        <Loader2 className='h-3 w-3 animate-spin' />
                      ) : (
                        <Check className='h-3 w-3' />
                      )}
                    </button>
                    <button
                      onClick={handleCancelRevert}
                      disabled={isRevertingCheckpoint}
                      className='text-xs text-muted-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50'
                      title='Cancel restore'
                    >
                      <X className='h-3 w-3' />
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleRevertToCheckpoint}
                    disabled={isRevertingCheckpoint}
                    className='flex items-center gap-1.5 rounded-md px-2 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50'
                    title='Restore workflow to this checkpoint state'
                  >
                    <RotateCcw className='h-3 w-3' />
                    Restore
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </div>
    )
  }

  if (isAssistant) {
    return (
      <div className='w-full py-2 pl-[2px]'>
        <div className='space-y-2 transition-all duration-200 ease-in-out'>
          {/* Content blocks in chronological order or fallback to old layout */}
          {memoizedContentBlocks ? (
            // Render content blocks in chronological order
            <>
              {memoizedContentBlocks}

              {/* Show streaming indicator if streaming but no text content yet after tool calls */}
              {isStreaming &&
                !message.content &&
                message.contentBlocks?.every((block) => block.type === 'tool_call') && (
                  <StreamingIndicator />
                )}
            </>
          ) : (
            // Fallback to old layout for messages without content blocks
            <>
              {/* Tool calls if available */}
              {message.toolCalls && message.toolCalls.length > 0 && (
                <div className='mb-2'>
                  {message.toolCalls.map((toolCall) => (
                    <InlineToolCall key={toolCall.id} tool={toolCall} />
                  ))}
                </div>
              )}

              {/* Regular text content */}
              {cleanTextContent && (
                <div 
                  className='w-full transition-opacity duration-200 ease-in-out'
                  style={{ 
                    opacity: cleanTextContent.length > 0 ? 1 : 0.7,
                    transition: 'opacity 0.2s ease-in-out'
                  }}
                >
                  <div className='overflow-wrap-anywhere relative whitespace-normal break-normal font-normal text-sm leading-tight'>
                    {isStreaming ? (
                      <SmoothStreamingText
                        content={cleanTextContent}
                        isStreaming={isStreaming}
                        markdownComponents={markdownComponents}
                      />
                    ) : (
                      <div className='whitespace-pre-wrap break-words text-foreground'>
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                          {cleanTextContent}
                        </ReactMarkdown>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </>
          )}

          {/* Streaming indicator when no content yet */}
          {!cleanTextContent && !message.contentBlocks?.length && isStreaming && (
            <StreamingIndicator />
          )}

          {/* Action buttons for completed messages */}
          {!isStreaming && cleanTextContent && (
            <div className='flex items-center gap-2'>
              <button
                onClick={handleCopyContent}
                className='text-muted-foreground transition-colors hover:bg-muted'
                title='Copy'
              >
                {showCopySuccess ? (
                  <Check className='h-3 w-3' strokeWidth={2} />
                ) : (
                  <Clipboard className='h-3 w-3' strokeWidth={2} />
                )}
              </button>
              <button
                onClick={handleUpvote}
                className='text-muted-foreground transition-colors hover:bg-muted'
                title='Upvote'
              >
                {showUpvoteSuccess ? (
                  <Check className='h-3 w-3' strokeWidth={2} />
                ) : (
                  <ThumbsUp className='h-3 w-3' strokeWidth={2} />
                )}
              </button>
              <button
                onClick={handleDownvote}
                className='text-muted-foreground transition-colors hover:bg-muted'
                title='Downvote'
              >
                {showDownvoteSuccess ? (
                  <Check className='h-3 w-3' strokeWidth={2} />
                ) : (
                  <ThumbsDown className='h-3 w-3' strokeWidth={2} />
                )}
              </button>
            </div>
          )}

          {/* Citations if available */}
          {message.citations && message.citations.length > 0 && (
            <div className='pt-1'>
              <div className='font-medium text-muted-foreground text-xs'>Sources:</div>
              <div className='flex flex-wrap gap-2'>
                {message.citations.map((citation) => (
                  <a
                    key={citation.id}
                    href={citation.url}
                    target='_blank'
                    rel='noopener noreferrer'
                    className='inline-flex items-center rounded-md border bg-muted/50 px-2 py-1 text-muted-foreground text-xs transition-colors hover:bg-muted hover:text-foreground'
                  >
                    {citation.title}
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    )
  }

  return null
}, (prevProps, nextProps) => {
  // Custom comparison function for better streaming performance
  const prevMessage = prevProps.message
  const nextMessage = nextProps.message
  
  // If message IDs are different, always re-render
  if (prevMessage.id !== nextMessage.id) {
    return false
  }
  
  // If streaming state changed, re-render
  if (prevProps.isStreaming !== nextProps.isStreaming) {
    return false
  }
  
  // For streaming messages, check if content actually changed
  if (nextProps.isStreaming) {
    // Compare contentBlocks length and lastUpdated for streaming messages
    const prevBlocks = prevMessage.contentBlocks || []
    const nextBlocks = nextMessage.contentBlocks || []
    
    if (prevBlocks.length !== nextBlocks.length) {
      return false // Content blocks changed
    }
    
    // Check if any text content changed in the last block
    if (nextBlocks.length > 0) {
      const prevLastBlock = prevBlocks[prevBlocks.length - 1]
      const nextLastBlock = nextBlocks[nextBlocks.length - 1]
      
      if (prevLastBlock?.type === 'text' && nextLastBlock?.type === 'text') {
        if (prevLastBlock.content !== nextLastBlock.content) {
          return false // Text content changed
        }
      }
    }
    
    // Check if tool calls changed
    const prevToolCalls = prevMessage.toolCalls || []
    const nextToolCalls = nextMessage.toolCalls || []
    
    if (prevToolCalls.length !== nextToolCalls.length) {
      return false // Tool calls count changed
    }
    
    // Check if any tool call state changed
    for (let i = 0; i < nextToolCalls.length; i++) {
      if (prevToolCalls[i]?.state !== nextToolCalls[i]?.state) {
        return false // Tool call state changed
      }
    }
    
    // If we reach here, nothing meaningful changed during streaming
    return true
  }
  
  // For non-streaming messages, do a deeper comparison including tool call states
  if (
    prevMessage.content !== nextMessage.content ||
    prevMessage.role !== nextMessage.role ||
    (prevMessage.toolCalls?.length || 0) !== (nextMessage.toolCalls?.length || 0) ||
    (prevMessage.contentBlocks?.length || 0) !== (nextMessage.contentBlocks?.length || 0)
  ) {
    return false
  }
  
  // Check tool call states for non-streaming messages too
  const prevToolCalls = prevMessage.toolCalls || []
  const nextToolCalls = nextMessage.toolCalls || []
  for (let i = 0; i < nextToolCalls.length; i++) {
    if (prevToolCalls[i]?.state !== nextToolCalls[i]?.state) {
      return false // Tool call state changed
    }
  }
  
  // Check contentBlocks tool call states
  const prevContentBlocks = prevMessage.contentBlocks || []
  const nextContentBlocks = nextMessage.contentBlocks || []
  for (let i = 0; i < nextContentBlocks.length; i++) {
    const prevBlock = prevContentBlocks[i]
    const nextBlock = nextContentBlocks[i]
    if (
      prevBlock?.type === 'tool_call' && 
      nextBlock?.type === 'tool_call' && 
      prevBlock.toolCall?.state !== nextBlock.toolCall?.state
    ) {
      return false // ContentBlock tool call state changed
    }
  }
  
  return true
})

ProfessionalMessage.displayName = 'ProfessionalMessage'

export { ProfessionalMessage }
