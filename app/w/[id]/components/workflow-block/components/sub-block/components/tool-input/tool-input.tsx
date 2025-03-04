import { useCallback, useState } from 'react'
import { PencilIcon, PlusIcon, WrenchIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import { useCustomToolsStore } from '@/stores/custom-tools/store'
import { useWorkflowStore } from '@/stores/workflows/workflow/store'
import { getAllBlocks } from '@/blocks'
import { getTool } from '@/tools'
import { useSubBlockValue } from '../../hooks/use-sub-block-value'
import { ShortInput } from '../short-input'
import { CustomTool, CustomToolModal } from './components/custom-tool-modal'
import { ToolCommand } from './components/tool-command'

interface ToolInputProps {
  blockId: string
  subBlockId: string
}

interface StoredTool {
  type: string
  title: string
  params: Record<string, string>
  isExpanded?: boolean
  schema?: any // For custom tools
  code?: string // For custom tools implementation
  operation?: string // For tools with multiple operations
}

interface ToolParam {
  id: string
  type: string
  description?: string
  requiredForToolCall: boolean
}

// Assumes the first tool in the access array is the tool to be used
// TODO: Switch to getting tools instead of tool blocks once we switch to providers
const getToolIdFromBlock = (blockType: string): string | undefined => {
  const block = getAllBlocks().find((block) => block.type === blockType)
  return block?.tools.access[0]
}

const getRequiredToolParams = (toolId: string): ToolParam[] => {
  const tool = getTool(toolId)
  if (!tool) return []

  return Object.entries(tool.params)
    .filter(([_, param]) => param.requiredForToolCall)
    .map(([paramId, param]) => ({
      id: paramId,
      type: param.type,
      description: param.description,
      requiredForToolCall: param.requiredForToolCall ?? false,
    }))
}

// For custom tools, extract parameters from the schema
const getCustomToolParams = (schema: any): ToolParam[] => {
  if (!schema?.function?.parameters?.properties) return []

  const properties = schema.function.parameters.properties
  const required = schema.function.parameters.required || []

  return Object.entries(properties).map(([paramId, param]: [string, any]) => ({
    id: paramId,
    type: param.type || 'string',
    description: param.description || '',
    requiredForToolCall: required.includes(paramId),
  }))
}

// Check if a block has multiple operations
const hasMultipleOperations = (blockType: string): boolean => {
  const block = getAllBlocks().find((block) => block.type === blockType)
  return (block?.tools?.access?.length || 0) > 1
}

// Get operation options for a block
const getOperationOptions = (blockType: string): { label: string; id: string }[] => {
  const block = getAllBlocks().find((block) => block.type === blockType)
  if (!block || !block.tools?.access) return []

  // Look for an operation dropdown in the block's subBlocks
  const operationSubBlock = block.subBlocks.find((sb) => sb.id === 'operation')
  if (
    operationSubBlock &&
    operationSubBlock.type === 'dropdown' &&
    Array.isArray(operationSubBlock.options)
  ) {
    return operationSubBlock.options as { label: string; id: string }[]
  }

  // Fallback: create options from tools.access
  return block.tools.access.map((toolId) => {
    const tool = getTool(toolId)
    return {
      id: toolId,
      label: tool?.name || toolId,
    }
  })
}

export function ToolInput({ blockId, subBlockId }: ToolInputProps) {
  const [value, setValue] = useSubBlockValue(blockId, subBlockId)
  const [open, setOpen] = useState(false)
  const [customToolModalOpen, setCustomToolModalOpen] = useState(false)
  const [editingToolIndex, setEditingToolIndex] = useState<number | null>(null)
  const isWide = useWorkflowStore((state) => state.blocks[blockId]?.isWide)
  const customTools = useCustomToolsStore((state) => state.getAllTools())

  const toolBlocks = getAllBlocks().filter((block) => block.category === 'tools')

  // Custom filter function for the Command component
  const customFilter = useCallback((value: string, search: string) => {
    if (!search.trim()) return 1

    const normalizedValue = value.toLowerCase()
    const normalizedSearch = search.toLowerCase()

    // Exact match gets highest priority
    if (normalizedValue === normalizedSearch) return 1

    // Starts with search term gets high priority
    if (normalizedValue.startsWith(normalizedSearch)) return 0.8

    // Contains search term gets medium priority
    if (normalizedValue.includes(normalizedSearch)) return 0.6

    // No match
    return 0
  }, [])

  const selectedTools: StoredTool[] =
    Array.isArray(value) && value.length > 0 && typeof value[0] === 'object'
      ? (value as unknown as StoredTool[])
      : []

  const handleSelectTool = (toolBlock: (typeof toolBlocks)[0]) => {
    // Check if tool already exists
    if (selectedTools.some((tool) => tool.type === toolBlock.type)) {
      setOpen(false)
      return
    }

    const hasOperations = hasMultipleOperations(toolBlock.type)
    const operationOptions = hasOperations ? getOperationOptions(toolBlock.type) : []
    const defaultOperation = operationOptions.length > 0 ? operationOptions[0].id : undefined

    const newTool: StoredTool = {
      type: toolBlock.type,
      title: toolBlock.name,
      params: {},
      isExpanded: true,
      operation: defaultOperation,
    }

    // If isWide, keep tools in the same row expanded
    if (isWide) {
      setValue([
        ...selectedTools.map((tool, index) => ({
          ...tool,
          // Keep expanded if it's in the same row as the new tool
          isExpanded: Math.floor(selectedTools.length / 2) === Math.floor(index / 2),
        })),
        newTool,
      ])
    } else {
      // Original behavior for non-wide mode
      setValue([...selectedTools.map((tool) => ({ ...tool, isExpanded: false })), newTool])
    }

    setOpen(false)
  }

  const handleAddCustomTool = (customTool: CustomTool) => {
    // Check if a tool with the same name already exists
    if (
      selectedTools.some(
        (tool) =>
          tool.type === 'custom-tool' &&
          tool.schema?.function?.name === customTool.schema.function.name
      )
    ) {
      return
    }

    const newTool: StoredTool = {
      type: 'custom-tool',
      title: customTool.title,
      params: {},
      isExpanded: true,
      schema: customTool.schema,
      code: customTool.code || '',
    }

    // If isWide, keep tools in the same row expanded
    if (isWide) {
      setValue([
        ...selectedTools.map((tool, index) => ({
          ...tool,
          // Keep expanded if it's in the same row as the new tool
          isExpanded: Math.floor(selectedTools.length / 2) === Math.floor(index / 2),
        })),
        newTool,
      ])
    } else {
      // Original behavior for non-wide mode
      setValue([...selectedTools.map((tool) => ({ ...tool, isExpanded: false })), newTool])
    }
  }

  const handleEditCustomTool = (toolIndex: number) => {
    const tool = selectedTools[toolIndex]
    if (tool.type !== 'custom-tool' || !tool.schema) return

    // Find the tool ID from the custom tools store based on the function name
    const customToolsList = useCustomToolsStore.getState().getAllTools()
    const existingTool = customToolsList.find(
      (customTool) => customTool.schema.function.name === tool.schema.function.name
    )

    setEditingToolIndex(toolIndex)
    setCustomToolModalOpen(true)
  }

  const handleSaveCustomTool = (customTool: CustomTool) => {
    if (editingToolIndex !== null) {
      // Update existing tool
      setValue(
        selectedTools.map((tool, index) =>
          index === editingToolIndex
            ? {
                ...tool,
                title: customTool.title,
                schema: customTool.schema,
                code: customTool.code || '',
              }
            : tool
        )
      )
      setEditingToolIndex(null)
    } else {
      // Add new tool
      handleAddCustomTool(customTool)
    }
  }

  const handleRemoveTool = (toolType: string, toolIndex: number) => {
    setValue(selectedTools.filter((_, index) => index !== toolIndex))
  }

  const handleParamChange = (toolIndex: number, paramId: string, paramValue: string) => {
    setValue(
      selectedTools.map((tool, index) =>
        index === toolIndex
          ? {
              ...tool,
              params: {
                ...tool.params,
                [paramId]: paramValue,
              },
            }
          : tool
      )
    )
  }

  const handleOperationChange = (toolIndex: number, operation: string) => {
    setValue(
      selectedTools.map((tool, index) =>
        index === toolIndex
          ? {
              ...tool,
              operation,
            }
          : tool
      )
    )
  }

  const toggleToolExpansion = (toolIndex: number) => {
    setValue(
      selectedTools.map((tool, index) =>
        index === toolIndex ? { ...tool, isExpanded: !tool.isExpanded } : tool
      )
    )
  }

  const IconComponent = ({ icon: Icon, className }: { icon: any; className?: string }) => {
    if (!Icon) return null
    return <Icon className={className} />
  }

  return (
    <div className="w-full">
      {selectedTools.length === 0 ? (
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <div className="flex h-10 w-full items-center justify-center rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background transition-colors hover:bg-accent hover:text-accent-foreground cursor-pointer">
              <div className="flex items-center text-base text-muted-foreground/50 md:text-sm">
                <PlusIcon className="w-4 h-4 mr-2" />
                Add Tool
              </div>
            </div>
          </PopoverTrigger>
          <PopoverContent className="p-0 w-[200px]" align="start">
            <ToolCommand.Root filter={customFilter}>
              <ToolCommand.Input placeholder="Search tools..." />
              <ToolCommand.List>
                <ToolCommand.Empty>No tools found</ToolCommand.Empty>
                <ToolCommand.Group>
                  <ToolCommand.Item
                    value="Create Tool"
                    onSelect={() => {
                      setOpen(false)
                      setCustomToolModalOpen(true)
                    }}
                    className="flex items-center gap-2 cursor-pointer mb-1"
                  >
                    <div className="flex items-center justify-center w-6 h-6 rounded border border-dashed border-muted-foreground/50 bg-transparent">
                      <WrenchIcon className="w-4 h-4 text-muted-foreground" />
                    </div>
                    <span>Create Tool</span>
                  </ToolCommand.Item>

                  {/* Display saved custom tools at the top */}
                  {customTools.length > 0 && (
                    <>
                      <ToolCommand.Separator />
                      <div className="px-2 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                        Custom Tools
                      </div>
                      <ToolCommand.Group className="-mx-1 -px-1">
                        {customTools.map((customTool) => (
                          <ToolCommand.Item
                            key={customTool.id}
                            value={customTool.title}
                            onSelect={() => {
                              const newTool: StoredTool = {
                                type: 'custom-tool',
                                title: customTool.title,
                                params: {},
                                isExpanded: true,
                                schema: customTool.schema,
                                code: customTool.code,
                              }

                              if (isWide) {
                                setValue([
                                  ...selectedTools.map((tool, index) => ({
                                    ...tool,
                                    isExpanded:
                                      Math.floor(selectedTools.length / 2) ===
                                      Math.floor(index / 2),
                                  })),
                                  newTool,
                                ])
                              } else {
                                setValue([
                                  ...selectedTools.map((tool) => ({ ...tool, isExpanded: false })),
                                  newTool,
                                ])
                              }
                              setOpen(false)
                            }}
                            className="flex items-center gap-2 cursor-pointer"
                          >
                            <div className="flex items-center justify-center w-6 h-6 rounded bg-blue-500">
                              <WrenchIcon className="w-4 h-4 text-white" />
                            </div>
                            <span className="truncate max-w-[140px]">{customTool.title}</span>
                          </ToolCommand.Item>
                        ))}
                      </ToolCommand.Group>
                      <ToolCommand.Separator />
                    </>
                  )}

                  {/* Display built-in tools */}
                  <div className="px-2 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                    Built-in Tools
                  </div>
                  <ToolCommand.Group className="-mx-1 -px-1">
                    {toolBlocks.map((block) => (
                      <ToolCommand.Item
                        key={block.type}
                        value={block.name}
                        onSelect={() => handleSelectTool(block)}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <div
                          className="flex items-center justify-center w-6 h-6 rounded"
                          style={{ backgroundColor: block.bgColor }}
                        >
                          <IconComponent icon={block.icon} className="w-4 h-4 text-white" />
                        </div>
                        <span className="truncate max-w-[140px]">{block.name}</span>
                      </ToolCommand.Item>
                    ))}
                  </ToolCommand.Group>
                </ToolCommand.Group>
              </ToolCommand.List>
            </ToolCommand.Root>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex flex-wrap gap-2 min-h-[2.5rem] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background">
          {selectedTools.map((tool, toolIndex) => {
            // Handle custom tools differently
            const isCustomTool = tool.type === 'custom-tool'
            const toolBlock = !isCustomTool
              ? toolBlocks.find((block) => block.type === tool.type)
              : null
            const toolId = !isCustomTool ? getToolIdFromBlock(tool.type) : null
            const hasOperations = !isCustomTool && hasMultipleOperations(tool.type)
            const operationOptions = hasOperations ? getOperationOptions(tool.type) : []

            // Get parameters based on tool type
            const requiredParams = isCustomTool
              ? getCustomToolParams(tool.schema)
              : toolId
                ? getRequiredToolParams(toolId)
                : []

            return (
              <div
                key={`${tool.type}-${toolIndex}`}
                className={cn('group flex flex-col', isWide ? 'w-[calc(50%-0.25rem)]' : 'w-full')}
              >
                <div className="flex flex-col rounded-md border bg-card overflow-visible">
                  <div
                    className="flex items-center justify-between p-2 bg-accent/50 cursor-pointer"
                    onClick={() => {
                      if (isCustomTool) {
                        handleEditCustomTool(toolIndex)
                      } else {
                        toggleToolExpansion(toolIndex)
                      }
                    }}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center justify-center w-5 h-5 rounded"
                        style={{
                          backgroundColor: isCustomTool
                            ? '#3B82F6' // blue-500 for custom tools
                            : toolBlock?.bgColor,
                        }}
                      >
                        {isCustomTool ? (
                          <WrenchIcon className="w-3 h-3 text-white" />
                        ) : (
                          <IconComponent icon={toolBlock?.icon} className="w-3 h-3 text-white" />
                        )}
                      </div>
                      <span
                        className={`text-sm font-medium truncate ${
                          isWide ? 'max-w-[134px]' : 'max-w-[180px]'
                        }`}
                      >
                        {tool.title}
                      </span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveTool(tool.type, toolIndex)
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {tool.isExpanded && !isCustomTool && (
                    <div
                      className="p-3 space-y-3"
                      onClick={(e) => {
                        if (e.target === e.currentTarget) {
                          toggleToolExpansion(toolIndex)
                        }
                      }}
                    >
                      {/* Add operation dropdown for tools with multiple operations */}
                      {hasOperations && operationOptions.length > 0 && (
                        <div className="space-y-1.5 relative">
                          <div className="text-xs font-medium text-muted-foreground">Operation</div>
                          <Select
                            value={tool.operation || operationOptions[0].id}
                            onValueChange={(value) => handleOperationChange(toolIndex, value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Select operation" />
                            </SelectTrigger>
                            <SelectContent>
                              {operationOptions.map((option) => (
                                <SelectItem key={option.id} value={option.id}>
                                  {option.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}

                      {/* Existing parameters */}
                      {requiredParams.map((param) => (
                        <div key={param.id} className="space-y-1.5 relative">
                          <div className="text-xs font-medium text-muted-foreground">
                            {param.id === 'apiKey' ? 'API Key' : param.id}
                          </div>
                          <div className="relative">
                            <ShortInput
                              blockId={blockId}
                              subBlockId={`${subBlockId}-param`}
                              placeholder={param.description}
                              password={param.id.toLowerCase().replace(/\s+/g, '') === 'apikey'}
                              isConnecting={false}
                              config={{
                                id: `${subBlockId}-param`,
                                type: 'short-input',
                                title: param.id,
                              }}
                              value={tool.params[param.id] || ''}
                              onChange={(value) => handleParamChange(toolIndex, param.id, value)}
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
          <Popover open={open} onOpenChange={setOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
              >
                <PlusIcon className="w-3 h-3" />
                Add Tool
              </Button>
            </PopoverTrigger>
            <PopoverContent className="p-0 w-[200px]" align="start">
              <ToolCommand.Root filter={customFilter}>
                <ToolCommand.Input placeholder="Search tools..." />
                <ToolCommand.List>
                  <ToolCommand.Empty>No tools found.</ToolCommand.Empty>
                  <ToolCommand.Group>
                    <ToolCommand.Item
                      value="Create Tool"
                      onSelect={() => {
                        setOpen(false)
                        setCustomToolModalOpen(true)
                      }}
                      className="flex items-center gap-2 cursor-pointer mb-1"
                    >
                      <div className="flex items-center justify-center w-6 h-6 rounded border border-dashed border-muted-foreground/50 bg-transparent">
                        <WrenchIcon className="w-4 h-4 text-muted-foreground" />
                      </div>
                      <span>Create Tool</span>
                    </ToolCommand.Item>

                    {/* Display saved custom tools at the top */}
                    {customTools.length > 0 && (
                      <>
                        <ToolCommand.Separator />
                        <div className="px-2 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                          Custom Tools
                        </div>
                        <ToolCommand.Group className="-mx-1 -px-1">
                          {customTools.map((customTool) => (
                            <ToolCommand.Item
                              key={customTool.id}
                              value={customTool.title}
                              onSelect={() => {
                                const newTool: StoredTool = {
                                  type: 'custom-tool',
                                  title: customTool.title,
                                  params: {},
                                  isExpanded: true,
                                  schema: customTool.schema,
                                  code: customTool.code,
                                }

                                if (isWide) {
                                  setValue([
                                    ...selectedTools.map((tool, index) => ({
                                      ...tool,
                                      isExpanded:
                                        Math.floor(selectedTools.length / 2) ===
                                        Math.floor(index / 2),
                                    })),
                                    newTool,
                                  ])
                                } else {
                                  setValue([
                                    ...selectedTools.map((tool) => ({
                                      ...tool,
                                      isExpanded: false,
                                    })),
                                    newTool,
                                  ])
                                }
                                setOpen(false)
                              }}
                              className="flex items-center gap-2 cursor-pointer"
                            >
                              <div className="flex items-center justify-center w-6 h-6 rounded bg-blue-500">
                                <WrenchIcon className="w-4 h-4 text-white" />
                              </div>
                              <span className="truncate max-w-[140px]">{customTool.title}</span>
                            </ToolCommand.Item>
                          ))}
                        </ToolCommand.Group>
                        <ToolCommand.Separator />
                      </>
                    )}

                    {/* Display built-in tools */}
                    <div className="px-2 pt-2.5 pb-0.5 text-xs font-medium text-muted-foreground">
                      Built-in Tools
                    </div>
                    <ToolCommand.Group className="-mx-1 -px-1">
                      {toolBlocks.map((block) => (
                        <ToolCommand.Item
                          key={block.type}
                          value={block.name}
                          onSelect={() => handleSelectTool(block)}
                          className="flex items-center gap-2 cursor-pointer"
                        >
                          <div
                            className="flex items-center justify-center w-6 h-6 rounded"
                            style={{ backgroundColor: block.bgColor }}
                          >
                            <IconComponent icon={block.icon} className="w-4 h-4 text-white" />
                          </div>
                          <span className="truncate max-w-[140px]">{block.name}</span>
                        </ToolCommand.Item>
                      ))}
                    </ToolCommand.Group>
                  </ToolCommand.Group>
                </ToolCommand.List>
              </ToolCommand.Root>
            </PopoverContent>
          </Popover>
        </div>
      )}

      {/* Custom Tool Modal */}
      <CustomToolModal
        open={customToolModalOpen}
        onOpenChange={(open) => {
          setCustomToolModalOpen(open)
          if (!open) setEditingToolIndex(null)
        }}
        onSave={editingToolIndex !== null ? handleSaveCustomTool : handleAddCustomTool}
        initialValues={
          editingToolIndex !== null && selectedTools[editingToolIndex]?.type === 'custom-tool'
            ? {
                id: '',
                schema: selectedTools[editingToolIndex].schema,
                code: selectedTools[editingToolIndex].code || '',
              }
            : undefined
        }
      />
    </div>
  )
}
