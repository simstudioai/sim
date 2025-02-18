import { useState } from 'react'
import { PlusIcon, XIcon } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { cn } from '@/lib/utils'
import { useWorkflowStore } from '@/stores/workflow/store'
import { getAllBlocks } from '@/blocks'
import { getTool } from '@/tools'
import { useSubBlockValue } from '../hooks/use-sub-block-value'
import { ShortInput } from './short-input'

interface ToolInputProps {
  blockId: string
  subBlockId: string
}

interface StoredTool {
  type: string
  title: string
  params: Record<string, string>
  isExpanded?: boolean
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

export function ToolInput({ blockId, subBlockId }: ToolInputProps) {
  const [value, setValue] = useSubBlockValue(blockId, subBlockId)
  const [open, setOpen] = useState(false)
  const isWide = useWorkflowStore((state) => state.blocks[blockId]?.isWide)

  const toolBlocks = getAllBlocks().filter((block) => block.category === 'tools')

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

    const toolId = getToolIdFromBlock(toolBlock.type)
    const newTool: StoredTool = {
      type: toolBlock.type,
      title: toolBlock.name,
      params: {},
      isExpanded: true,
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

  const handleRemoveTool = (toolType: string) => {
    setValue(selectedTools.filter((tool) => tool.type !== toolType))
  }

  const handleParamChange = (toolType: string, paramId: string, paramValue: string) => {
    setValue(
      selectedTools.map((tool) =>
        tool.type === toolType
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

  const toggleToolExpansion = (toolType: string) => {
    setValue(
      selectedTools.map((tool) =>
        tool.type === toolType ? { ...tool, isExpanded: !tool.isExpanded } : tool
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
            <Command>
              <CommandInput placeholder="Search tools..." />
              <CommandList>
                <CommandEmpty>No tools found.</CommandEmpty>
                <CommandGroup>
                  {toolBlocks.map((block) => (
                    <CommandItem
                      key={block.type}
                      onSelect={() => handleSelectTool(block)}
                      className="flex items-center gap-2 cursor-pointer"
                    >
                      <div
                        className="flex items-center justify-center w-6 h-6 rounded"
                        style={{ backgroundColor: block.bgColor }}
                      >
                        <IconComponent icon={block.icon} className="w-4 h-4 text-white" />
                      </div>
                      <span>{block.name}</span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              </CommandList>
            </Command>
          </PopoverContent>
        </Popover>
      ) : (
        <div className="flex flex-wrap gap-2 min-h-[2.5rem] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm ring-offset-background">
          {selectedTools.map((tool) => {
            const toolBlock = toolBlocks.find((block) => block.type === tool.type)
            const toolId = getToolIdFromBlock(tool.type)
            const requiredParams = toolId ? getRequiredToolParams(toolId) : []

            return (
              <div
                key={tool.type}
                className={cn('group flex flex-col', isWide ? 'w-[calc(50%-0.25rem)]' : 'w-full')}
              >
                <div className="flex flex-col rounded-md border bg-card overflow-visible">
                  <div
                    className="flex items-center justify-between p-2 bg-accent/50 cursor-pointer"
                    onClick={() => toggleToolExpansion(tool.type)}
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="flex items-center justify-center w-5 h-5 rounded"
                        style={{ backgroundColor: toolBlock?.bgColor }}
                      >
                        <IconComponent icon={toolBlock?.icon} className="w-3 h-3 text-white" />
                      </div>
                      <span className="text-sm font-medium">{tool.title}</span>
                    </div>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleRemoveTool(tool.type)
                        }}
                        className="text-muted-foreground hover:text-foreground"
                      >
                        <XIcon className="w-4 h-4" />
                      </button>
                    </div>
                  </div>

                  {tool.isExpanded && requiredParams.length > 0 && (
                    <div
                      className="p-3 space-y-3"
                      onClick={(e) => {
                        if (e.target === e.currentTarget) {
                          toggleToolExpansion(tool.type)
                        }
                      }}
                    >
                      {requiredParams.map((param) => (
                        <div key={param.id} className="space-y-1.5 relative">
                          <div className="text-xs font-medium text-muted-foreground">
                            {param.id}
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
                              onChange={(value) => handleParamChange(tool.type, param.id, value)}
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
              <Command>
                <CommandInput placeholder="Search tools..." />
                <CommandList>
                  <CommandEmpty>No tools found.</CommandEmpty>
                  <CommandGroup>
                    {toolBlocks.map((block) => (
                      <CommandItem
                        key={block.type}
                        onSelect={() => handleSelectTool(block)}
                        className="flex items-center gap-2 cursor-pointer"
                      >
                        <div
                          className="flex items-center justify-center w-6 h-6 rounded"
                          style={{ backgroundColor: block.bgColor }}
                        >
                          <IconComponent icon={block.icon} className="w-4 h-4 text-white" />
                        </div>
                        <span>{block.name}</span>
                      </CommandItem>
                    ))}
                  </CommandGroup>
                </CommandList>
              </Command>
            </PopoverContent>
          </Popover>
        </div>
      )}
    </div>
  )
}
