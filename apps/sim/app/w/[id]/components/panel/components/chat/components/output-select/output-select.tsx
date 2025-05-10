import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { getBlock } from '@/blocks'
import { Button } from '@/components/ui/button'

interface OutputSelectProps {
  workflowId: string | null
  selectedOutputs: string[]
  onOutputSelect: (outputIds: string[]) => void
  disabled?: boolean
  placeholder?: string
}

export function OutputSelect({
  workflowId,
  selectedOutputs = [],
  onOutputSelect,
  disabled = false,
  placeholder = 'Select output sources',
}: OutputSelectProps) {
  const [isOutputDropdownOpen, setIsOutputDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)
  const blocks = useWorkflowStore((state) => state.blocks)

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

    if (!workflowId) return outputs

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
  }, [blocks, workflowId])

  // Get selected outputs display text
  const selectedOutputsDisplayText = useMemo(() => {    
    if (!selectedOutputs || selectedOutputs.length === 0) {
      return placeholder
    }
    
    // Ensure all selected outputs exist in the workflowOutputs array
    const validOutputs = selectedOutputs.filter(id => workflowOutputs.some(o => o.id === id))
    
    if (validOutputs.length === 0) {
      return placeholder
    }
    
    if (validOutputs.length === 1) {
      const output = workflowOutputs.find((o) => o.id === validOutputs[0])
      if (output) {
        return `${output.blockName.replace(/\s+/g, '').toLowerCase()}.${output.path}`
      }
      return placeholder
    }
    
    return `${validOutputs.length} outputs selected`
  }, [selectedOutputs, workflowOutputs, placeholder])

  // Get first selected output info for display icon
  const selectedOutputInfo = useMemo(() => {
    if (!selectedOutputs || selectedOutputs.length === 0) return null
    
    const validOutputs = selectedOutputs.filter(id => workflowOutputs.some(o => o.id === id))
    if (validOutputs.length === 0) return null
    
    const output = workflowOutputs.find((o) => o.id === validOutputs[0])
    if (!output) return null

    return {
      blockName: output.blockName,
      blockId: output.blockId,
      blockType: output.blockType,
      path: output.path,
    }
  }, [selectedOutputs, workflowOutputs])

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

  // Handle output selection - toggle selection
  const handleOutputSelection = (value: string) => {
    let newSelectedOutputs: string[]
    const index = selectedOutputs.indexOf(value)
    
    if (index === -1) {
      newSelectedOutputs = [...new Set([...selectedOutputs, value])]
    } else {
      newSelectedOutputs = selectedOutputs.filter((id) => id !== value)
    }
    
    onOutputSelect(newSelectedOutputs)
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setIsOutputDropdownOpen(!isOutputDropdownOpen)}
        className={`flex w-full items-center justify-between px-3 py-1.5 text-sm rounded-md transition-colors ${
          isOutputDropdownOpen
            ? 'bg-accent text-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-accent/50'
        }`}
        disabled={workflowOutputs.length === 0 || disabled}
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
            <span className="truncate">{selectedOutputsDisplayText}</span>
          </div>
        ) : (
          <span className="truncate w-[calc(100%-24px)]">{selectedOutputsDisplayText}</span>
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
                      type="button"
                      key={output.id}
                      onClick={() => handleOutputSelection(output.id)}
                      className={cn(
                        'flex items-center gap-2 text-sm text-left w-full px-3 py-1.5',
                        'hover:bg-accent hover:text-accent-foreground',
                        'focus:bg-accent focus:text-accent-foreground focus:outline-none'
                      )}
                    >
                      <div className="flex-shrink-0 w-5 h-5 flex items-center justify-center">
                        {selectedOutputs.includes(output.id) ? (
                          <div className="w-4 h-4 rounded bg-primary flex items-center justify-center">
                            <Check className="h-3 w-3 text-white" />
                          </div>
                        ) : (
                          <div className="w-4 h-4 rounded border border-input" />
                        )}
                      </div>
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
                      <span className="truncate max-w-[calc(100%-48px)]">{output.path}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          
          {/* Done button to close dropdown */}
          <div className="border-t p-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setIsOutputDropdownOpen(false)}
              className="w-full bg-secondary/80 text-secondary-foreground hover:bg-secondary/90"
            >
              Done
            </Button>
          </div>
        </div>
      )}
    </div>
  )
} 