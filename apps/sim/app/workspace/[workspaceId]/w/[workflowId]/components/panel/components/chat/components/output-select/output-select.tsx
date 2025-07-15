import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown } from 'lucide-react'
import { extractFieldsFromSchema, parseResponseFormatSafely } from '@/lib/response-format'
import { cn } from '@/lib/utils'
import { getBlock } from '@/blocks'
import { useSubBlockStore } from '@/stores/workflows/subblock/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'

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

      // Add defensive check to ensure block.name exists and is a string
      const blockName =
        block.name && typeof block.name === 'string'
          ? block.name.replace(/\s+/g, '').toLowerCase()
          : `block-${block.id}`

      // Check for custom response format first
      const responseFormatValue = useSubBlockStore.getState().getValue(block.id, 'responseFormat')
      const responseFormat = parseResponseFormatSafely(responseFormatValue, block.id)

      let outputsToProcess: Record<string, any> = {}

      if (responseFormat) {
        // Use custom schema properties if response format is specified
        const schemaFields = extractFieldsFromSchema(responseFormat)
        if (schemaFields.length > 0) {
          // Convert schema fields to output structure
          schemaFields.forEach((field) => {
            outputsToProcess[field.name] = { type: field.type }
          })
        } else {
          // Fallback to default outputs if schema extraction failed
          outputsToProcess = block.outputs || {}
        }
      } else {
        // Use default block outputs
        outputsToProcess = block.outputs || {}
      }

      // Add response outputs
      if (Object.keys(outputsToProcess).length > 0) {
        const addOutput = (path: string, outputObj: any, prefix = '') => {
          const fullPath = prefix ? `${prefix}.${path}` : path

          // If not an object or is null, treat as leaf node
          if (typeof outputObj !== 'object' || outputObj === null) {
            const output = {
              id: `${block.id}_${fullPath}`,
              label: `${blockName}.${fullPath}`,
              blockId: block.id,
              blockName: block.name || `Block ${block.id}`,
              blockType: block.type,
              path: fullPath,
            }
            outputs.push(output)
            return
          }

          // If has 'type' property, treat as schema definition (leaf node)
          if ('type' in outputObj && typeof outputObj.type === 'string') {
            const output = {
              id: `${block.id}_${fullPath}`,
              label: `${blockName}.${fullPath}`,
              blockId: block.id,
              blockName: block.name || `Block ${block.id}`,
              blockType: block.type,
              path: fullPath,
            }
            outputs.push(output)
            return
          }

          // For objects without type, recursively add each property
          if (!Array.isArray(outputObj)) {
            Object.entries(outputObj).forEach(([key, value]) => {
              addOutput(key, value, fullPath)
            })
          } else {
            // For arrays, treat as leaf node
            outputs.push({
              id: `${block.id}_${fullPath}`,
              label: `${blockName}.${fullPath}`,
              blockId: block.id,
              blockName: block.name || `Block ${block.id}`,
              blockType: block.type,
              path: fullPath,
            })
          }
        }

        // Process all output properties directly (flattened structure)
        Object.entries(outputsToProcess).forEach(([key, value]) => {
          addOutput(key, value)
        })
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
    const validOutputs = selectedOutputs.filter((id) => workflowOutputs.some((o) => o.id === id))

    if (validOutputs.length === 0) {
      return placeholder
    }

    if (validOutputs.length === 1) {
      const output = workflowOutputs.find((o) => o.id === validOutputs[0])
      if (output) {
        // Add defensive check for output.blockName
        const blockNameText =
          output.blockName && typeof output.blockName === 'string'
            ? output.blockName.replace(/\s+/g, '').toLowerCase()
            : `block-${output.blockId}`
        return `${blockNameText}.${output.path}`
      }
      return placeholder
    }

    return `${validOutputs.length} outputs selected`
  }, [selectedOutputs, workflowOutputs, placeholder])

  // Get first selected output info for display icon
  const selectedOutputInfo = useMemo(() => {
    if (!selectedOutputs || selectedOutputs.length === 0) return null

    const validOutputs = selectedOutputs.filter((id) => workflowOutputs.some((o) => o.id === id))
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
    <div className='relative w-full' ref={dropdownRef}>
      <button
        type='button'
        onClick={() => setIsOutputDropdownOpen(!isOutputDropdownOpen)}
        className={`flex h-9 w-full items-center justify-between rounded-[8px] border px-3 py-1.5 font-normal text-sm shadow-xs transition-colors ${
          isOutputDropdownOpen
            ? 'border-[#E5E5E5] bg-[#FFFFFF] text-muted-foreground dark:border-[#414141] dark:bg-[#202020]'
            : 'border-[#E5E5E5] bg-[#FFFFFF] text-muted-foreground hover:text-muted-foreground dark:border-[#414141] dark:bg-[#202020]'
        }`}
        disabled={workflowOutputs.length === 0 || disabled}
      >
        {selectedOutputInfo ? (
          <div className='flex w-[calc(100%-24px)] items-center gap-2 overflow-hidden text-left'>
            <div
              className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded'
              style={{
                backgroundColor: getOutputColor(
                  selectedOutputInfo.blockId,
                  selectedOutputInfo.blockType
                ),
              }}
            >
              <span className='h-3 w-3 font-bold text-white text-xs'>
                {selectedOutputInfo.blockName.charAt(0).toUpperCase()}
              </span>
            </div>
            <span className='truncate text-left'>{selectedOutputsDisplayText}</span>
          </div>
        ) : (
          <span className='w-[calc(100%-24px)] truncate text-left'>
            {selectedOutputsDisplayText}
          </span>
        )}
        <ChevronDown
          className={`ml-1 h-4 w-4 flex-shrink-0 transition-transform ${
            isOutputDropdownOpen ? 'rotate-180' : ''
          }`}
        />
      </button>

      {isOutputDropdownOpen && workflowOutputs.length > 0 && (
        <div className='absolute left-0 z-50 mt-1 w-full overflow-hidden rounded-[8px] border border-[#E5E5E5] bg-[#FFFFFF] pt-1 shadow-xs dark:border-[#414141] dark:bg-[#202020]'>
          <div className='max-h-[230px] overflow-y-auto'>
            {Object.entries(groupedOutputs).map(([blockName, outputs]) => (
              <div key={blockName}>
                <div className='border-[#E5E5E5] border-t px-3 pt-1.5 pb-0.5 font-normal text-muted-foreground text-xs first:border-t-0 dark:border-[#414141]'>
                  {blockName}
                </div>
                <div>
                  {outputs.map((output) => (
                    <button
                      type='button'
                      key={output.id}
                      onClick={() => handleOutputSelection(output.id)}
                      className={cn(
                        'flex w-full items-center gap-2 px-3 py-1.5 text-left font-normal text-sm',
                        'hover:bg-accent hover:text-accent-foreground',
                        'focus:bg-accent focus:text-accent-foreground focus:outline-none'
                      )}
                    >
                      <div
                        className='flex h-5 w-5 flex-shrink-0 items-center justify-center rounded'
                        style={{
                          backgroundColor: getOutputColor(output.blockId, output.blockType),
                        }}
                      >
                        <span className='h-3 w-3 font-bold text-white text-xs'>
                          {blockName.charAt(0).toUpperCase()}
                        </span>
                      </div>
                      <span className='flex-1 truncate'>{output.path}</span>
                      {selectedOutputs.includes(output.id) && (
                        <Check className='h-4 w-4 flex-shrink-0 text-primary' />
                      )}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
