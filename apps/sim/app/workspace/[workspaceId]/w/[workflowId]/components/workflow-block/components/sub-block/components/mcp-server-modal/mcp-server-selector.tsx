'use client'

import { useEffect, useState } from 'react'
import { Check, ChevronDown, RefreshCw } from 'lucide-react'
import { useParams } from 'next/navigation'
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
import { useSubBlockValue } from '@/app/workspace/[workspaceId]/w/[workflowId]/components/workflow-block/components/sub-block/hooks/use-sub-block-value'
import type { SubBlockConfig } from '@/blocks/types'
import { useEnabledServers, useMcpServersStore } from '@/stores/mcp-servers/store'

interface McpServerSelectorProps {
  blockId: string
  subBlock: SubBlockConfig
  disabled?: boolean
  isPreview?: boolean
  previewValue?: string | null
}

export function McpServerSelector({
  blockId,
  subBlock,
  disabled = false,
  isPreview = false,
  previewValue,
}: McpServerSelectorProps) {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const [open, setOpen] = useState(false)

  const { fetchServers, isLoading, error } = useMcpServersStore()
  const enabledServers = useEnabledServers()

  const [storeValue, setStoreValue] = useSubBlockValue(blockId, subBlock.id)

  const label = subBlock.placeholder || 'Select MCP server'

  const effectiveValue = isPreview && previewValue !== undefined ? previewValue : storeValue
  const selectedServerId = effectiveValue || ''

  const selectedServer = enabledServers.find((server) => server.id === selectedServerId)

  useEffect(() => {
    fetchServers(workspaceId)
  }, [fetchServers, workspaceId])

  const handleOpenChange = (isOpen: boolean) => {
    setOpen(isOpen)
    if (isOpen) {
      fetchServers(workspaceId)
    }
  }

  const handleSelect = (serverId: string) => {
    if (!isPreview) {
      setStoreValue(serverId)
    }
    setOpen(false)
  }

  const getDisplayText = () => {
    if (selectedServer) {
      return <span className='truncate font-normal'>{selectedServer.name}</span>
    }
    return <span className='truncate text-muted-foreground'>{label}</span>
  }

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant='outline'
          role='combobox'
          aria-expanded={open}
          className='relative w-full justify-between'
          disabled={disabled}
        >
          <div className='flex max-w-[calc(100%-20px)] items-center overflow-hidden'>
            {getDisplayText()}
          </div>
          <ChevronDown className='absolute right-3 h-4 w-4 shrink-0 opacity-50' />
        </Button>
      </PopoverTrigger>
      <PopoverContent className='w-[250px] p-0' align='start'>
        <Command>
          <CommandInput placeholder='Search servers...' />
          <CommandList>
            <CommandEmpty>
              {isLoading ? (
                <div className='flex items-center justify-center p-4'>
                  <RefreshCw className='h-4 w-4 animate-spin' />
                  <span className='ml-2'>Loading servers...</span>
                </div>
              ) : error ? (
                <div className='p-4 text-center'>
                  <p className='font-medium text-destructive text-sm'>Error loading servers</p>
                  <p className='text-muted-foreground text-xs'>{error}</p>
                </div>
              ) : (
                <div className='p-4 text-center'>
                  <p className='font-medium text-sm'>No MCP servers found</p>
                  <p className='text-muted-foreground text-xs'>
                    Configure MCP servers in workspace settings
                  </p>
                </div>
              )}
            </CommandEmpty>
            {enabledServers.length > 0 && (
              <CommandGroup>
                {enabledServers.map((server) => (
                  <CommandItem
                    key={server.id}
                    value={`server-${server.id}-${server.name}`}
                    onSelect={() => handleSelect(server.id)}
                    className='cursor-pointer'
                  >
                    <div className='flex items-center gap-2 overflow-hidden'>
                      <span className='truncate font-normal'>{server.name}</span>
                    </div>
                    {server.id === selectedServerId && <Check className='ml-auto h-4 w-4' />}
                  </CommandItem>
                ))}
              </CommandGroup>
            )}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
