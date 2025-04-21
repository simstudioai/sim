'use client'

import { KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ChevronDown } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { cn } from '@/lib/utils'
import { useExecutionStore } from '@/stores/execution/store'
import { useChatStore } from '@/stores/panel/chat/store'
import { useConsoleStore } from '@/stores/panel/console/store'
import { useWorkflowRegistry } from '@/stores/workflows/registry/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { getBlock } from '@/blocks'
import { useWorkflowExecution } from '../../../../hooks/use-workflow-execution'
import { ChatMessage } from './components/chat-message/chat-message'

interface ChatProps {
  panelWidth: number
  chatMessage: string
  setChatMessage: (message: string) => void
}

export function Chat({ panelWidth, chatMessage, setChatMessage }: ChatProps) {
  const [isOutputDropdownOpen, setIsOutputDropdownOpen] = useState(false)
  const { activeWorkflowId } = useWorkflowRegistry()
  const { messages, addMessage, selectedWorkflowOutputs, setSelectedWorkflowOutput } =
    useChatStore()
  const { entries } = useConsoleStore()
  const blocks = useWorkflowStore((state) => state.blocks)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Use the execution store state to track if a workflow is executing
  const { isExecuting } = useExecutionStore()

  // Get workflow execution functionality
  const { handleRunWorkflow, executionResult } = useWorkflowExecution()

  // Get workflow outputs for the dropdown
  const workflowOutputs = useMemo(() => {
    const outputs: {
      id: string
      label: string
      blockId: string
      blockName: string
      blockType: string
      path: string
    }[] = []

    if (!activeWorkflowId) return outputs

    // Process blocks to extract outputs
    Object.values(blocks).forEach((block) => {
      // Skip starter/start blocks
      if (block.type === 'starter') return

      const blockName = block.name.replace(/\s+/g, '').toLowerCase()

      // Add response outputs
      if (block.outputs && typeof block.outputs === 'object') {
        const addOutput = (path: string, outputObj: any, prefix = '') => {
          const fullPath = prefix ? `${prefix}.${path}` : path

          if (typeof outputObj === 'object' && outputObj !== null) {
            // For objects, recursively add each property
            Object.entries(outputObj).forEach(([key, value]) => {
              addOutput(key, value, fullPath)
            })
          } else {
            // Add leaf node as output option
            outputs.push({
              id: `${block.id}_${fullPath}`,
              label: `${blockName}.${fullPath}`,
              blockId: block.id,
              blockName: block.name,
              blockType: block.type,
              path: fullPath,
            })
          }
        }

        // Start with the response object
        if (block.outputs.response) {
          addOutput('response', block.outputs.response)
        }
      }
    })

    return outputs
  }, [blocks, activeWorkflowId])

  // Get output entries from console for the dropdown
  const outputEntries = useMemo(() => {
    if (!activeWorkflowId) return []
    return entries.filter((entry) => entry.workflowId === activeWorkflowId && entry.output)
  }, [entries, activeWorkflowId])

  // Get filtered messages for current workflow
  const workflowMessages = useMemo(() => {
    if (!activeWorkflowId) return []
    return messages
      .filter((msg) => msg.workflowId === activeWorkflowId)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
  }, [messages, activeWorkflowId])

  // Get selected workflow output
  const selectedOutput = useMemo(() => {
    if (!activeWorkflowId) return null
    const selectedId = selectedWorkflowOutputs[activeWorkflowId]
    if (!selectedId) return outputEntries[0]?.id || null
    return selectedId
  }, [selectedWorkflowOutputs, activeWorkflowId, outputEntries])

  // Get selected output display name
  const selectedOutputDisplayName = useMemo(() => {
    if (!selectedOutput) return 'Select output source'
    const output = workflowOutputs.find((o) => o.id === selectedOutput)
    return output
      ? `${output.blockName.replace(/\s+/g, '').toLowerCase()}.${output.path}`
      : 'Select output source'
  }, [selectedOutput, workflowOutputs])

  // Get selected output block info
  const selectedOutputInfo = useMemo(() => {
    if (!selectedOutput) return null
    const output = workflowOutputs.find((o) => o.id === selectedOutput)
    if (!output) return null

    return {
      blockName: output.blockName,
      blockId: output.blockId,
      blockType: output.blockType,
      path: output.path,
    }
  }, [selectedOutput, workflowOutputs])

  // Auto-scroll to bottom when new messages are added
  useEffect(() => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [workflowMessages])

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOutputDropdownOpen(false)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [])

  // Handle send message
  const handleSendMessage = async () => {
    if (!chatMessage.trim() || !activeWorkflowId || isExecuting) return

    // Store the message being sent for reference
    const sentMessage = chatMessage.trim()

    // Add user message
    addMessage({
      content: sentMessage,
      workflowId: activeWorkflowId,
      type: 'user',
    })

    // Clear input
    setChatMessage('')

    // Execute the workflow to generate a response, passing the chat message as input
    // The workflow execution will trigger block executions which will add messages to the chat via the console store
    await handleRunWorkflow({ input: sentMessage })
  }

  // Handle key press
  const handleKeyPress = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSendMessage()
    }
  }

  // Handle output selection
  const handleOutputSelection = (value: string) => {
    if (activeWorkflowId) {
      setSelectedWorkflowOutput(activeWorkflowId, value)
      setIsOutputDropdownOpen(false)
    }
  }

  // Group output options by block
  const groupedOutputs = useMemo(() => {
    const groups: Record<string, typeof workflowOutputs> = {}
    const blockDistances: Record<string, number> = {}
    const edges = useWorkflowStore.getState().edges

    // Find the starter block
    const starterBlock = Object.values(blocks).find((block) => block.type === 'starter')
    const starterBlockId = starterBlock?.id

    // Calculate distances from starter block if it exists
    if (starterBlockId) {
      // Build an adjacency list for faster traversal
      const adjList: Record<string, string[]> = {}
      for (const edge of edges) {
        if (!adjList[edge.source]) {
          adjList[edge.source] = []
        }
        adjList[edge.source].push(edge.target)
      }

      // BFS to find distances from starter block
      const visited = new Set<string>()
      const queue: [string, number][] = [[starterBlockId, 0]] // [nodeId, distance]

      while (queue.length > 0) {
        const [currentNodeId, distance] = queue.shift()!

        if (visited.has(currentNodeId)) continue
        visited.add(currentNodeId)
        blockDistances[currentNodeId] = distance

        // Get all outgoing edges from the adjacency list
        const outgoingNodeIds = adjList[currentNodeId] || []

        // Add all target nodes to the queue with incremented distance
        for (const targetId of outgoingNodeIds) {
          queue.push([targetId, distance + 1])
        }
      }
    }

    // Group by block name
    workflowOutputs.forEach((output) => {
      if (!groups[output.blockName]) {
        groups[output.blockName] = []
      }
      groups[output.blockName].push(output)
    })

    // Convert to array of [blockName, outputs] for sorting
    const groupsArray = Object.entries(groups).map(([blockName, outputs]) => {
      // Find the blockId for this group (using the first output's blockId)
      const blockId = outputs[0]?.blockId
      // Get the distance for this block (or default to 0 if not found)
      const distance = blockId ? blockDistances[blockId] || 0 : 0
      return { blockName, outputs, distance }
    })

    // Sort by distance (descending - furthest first)
    groupsArray.sort((a, b) => b.distance - a.distance)

    // Convert back to record
    return groupsArray.reduce(
      (acc, { blockName, outputs }) => {
        acc[blockName] = outputs
        return acc
      },
      {} as Record<string, typeof workflowOutputs>
    )
  }, [workflowOutputs, blocks])

  // Get block color for an output
  const getOutputColor = (blockId: string, blockType: string) => {
    // Try to get the block's color from its configuration
    const blockConfig = getBlock(blockType)
    return blockConfig?.bgColor || '#2F55FF' // Default blue if not found
  }

  return (
    <div className="flex flex-col h-full">
      {/* Output Source Dropdown */}
      <div className="flex-none border-b px-4 py-2" ref={dropdownRef}>
        <div className="relative">
          <button
            onClick={() => setIsOutputDropdownOpen(!isOutputDropdownOpen)}
            className={`flex w-full items-center justify-between px-3 py-1.5 text-sm rounded-md transition-colors ${
              isOutputDropdownOpen
                ? 'bg-accent text-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
            }`}
            disabled={workflowOutputs.length === 0}
          >
            {selectedOutputInfo ? (
              <div className="flex items-center gap-2 w-[calc(100%-24px)] overflow-hidden">
                <div
                  className="flex items-center justify-center w-5 h-5 rounded flex-shrink-0"
                  style={{
                    backgroundColor: getOutputColor(
                      selectedOutputInfo.blockId,
                      selectedOutputInfo.blockType
                    ),
                  }}
                >
                  <span className="w-3 h-3 text-white font-bold text-xs">
                    {selectedOutputInfo.blockName.charAt(0).toUpperCase()}
                  </span>
                </div>
                <span className="truncate">{selectedOutputDisplayName}</span>
              </div>
            ) : (
              <span className="truncate w-[calc(100%-24px)]">{selectedOutputDisplayName}</span>
            )}
            <ChevronDown
              className={`h-4 w-4 transition-transform ml-1 flex-shrink-0 ${
                isOutputDropdownOpen ? 'rotate-180' : ''
              }`}
            />
          </button>

          {isOutputDropdownOpen && workflowOutputs.length > 0 && (
            <div className="absolute z-50 mt-1 pt-1 w-full bg-popover rounded-md border shadow-md overflow-hidden">
              <div className="max-h-[240px] overflow-y-auto">
                {Object.entries(groupedOutputs).map(([blockName, outputs]) => (
                  <div key={blockName}>
                    <div className="px-2 pt-1.5 pb-0.5 text-xs font-medium text-muted-foreground border-t first:border-t-0">
                      {blockName}
                    </div>
                    <div>
                      {outputs.map((output) => (
                        <button
                          key={output.id}
                          onClick={() => handleOutputSelection(output.id)}
                          className={cn(
                            'flex items-center gap-2 text-sm text-left w-full px-3 py-1.5',
                            'hover:bg-accent hover:text-accent-foreground',
                            'focus:bg-accent focus:text-accent-foreground focus:outline-none',
                            selectedOutput === output.id && 'bg-accent text-accent-foreground'
                          )}
                        >
                          <div
                            className="flex items-center justify-center w-5 h-5 rounded flex-shrink-0"
                            style={{
                              backgroundColor: getOutputColor(output.blockId, output.blockType),
                            }}
                          >
                            <span className="w-3 h-3 text-white font-bold text-xs">
                              {blockName.charAt(0).toUpperCase()}
                            </span>
                          </div>
                          <span className="truncate max-w-[calc(100%-28px)]">{output.path}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Main layout with fixed heights to ensure input stays visible */}
      <div className="flex flex-col flex-1 overflow-hidden">
        {/* Chat messages section - Scrollable area */}
        <div className="flex-1 overflow-hidden">
          <ScrollArea className="h-full">
            <div>
              {workflowMessages.length === 0 ? (
                <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
                  No messages yet
                </div>
              ) : (
                workflowMessages.map((message) => (
                  <ChatMessage key={message.id} message={message} containerWidth={panelWidth} />
                ))
              )}
              <div ref={messagesEndRef} />
            </div>
          </ScrollArea>
        </div>

        {/* Input section - Fixed height */}
        <div className="flex-none border-t bg-background pt-4 px-4 pb-4 relative -mt-[1px]">
          <div className="flex gap-2">
            <Input
              value={chatMessage}
              onChange={(e) => setChatMessage(e.target.value)}
              onKeyDown={handleKeyPress}
              placeholder="Type a message..."
              className="flex-1 focus-visible:ring-0 focus-visible:ring-offset-0 h-10"
              disabled={!activeWorkflowId || isExecuting}
            />
            <Button
              onClick={handleSendMessage}
              size="icon"
              disabled={!chatMessage.trim() || !activeWorkflowId || isExecuting}
              className="h-10 w-10 bg-[#802FFF] hover:bg-[#7028E6] text-white"
            >
              <ArrowUp className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}
