'use client'

import { useMemo, useState } from 'react'
import { PanelLeftClose, PanelRight, PanelRightClose, Search } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { getAllBlocks, getBlocksByCategory } from '@/blocks'
import { BlockCategory, BlockConfig } from '@/blocks/types'
import { ToolbarBlock } from './components/toolbar-block/toolbar-block'
import { ToolbarTabs } from './components/toolbar-tabs/toolbar-tabs'
import { useLocalStorage } from '@/app/w/agents/hooks/useLocalStorage'
import { CreateAgentModal } from '@/app/w/agents/components/CreateAgentModal'
import { AgentIcon } from '@/components/icons'
import { useAgentContext } from '@/app/w/agents/hooks/useAgentContext'
import { AgentProvider } from '@/app/w/agents/hooks/useAgentContext'

function ToolbarContent() {
  const [activeTab, setActiveTab] = useState<BlockCategory>('blocks')
  const [searchQuery, setSearchQuery] = useState('')
  const [isCollapsed, setIsCollapsed] = useState(false)
  const [isCreateModalOpen, setIsCreateModalOpen] = useState(false)
  const { createAgent, agents } = useAgentContext()

  const blocks = useMemo(() => {
    // Only fetch blocks for blocks/tools categories
    if (activeTab === 'agents') return []
    
    const filteredBlocks = !searchQuery.trim() ? getBlocksByCategory(activeTab) : getAllBlocks()

    return filteredBlocks.filter((block) => {
      if (block.type === 'starter') return false
      return (
        !searchQuery.trim() ||
        block.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        block.description.toLowerCase().includes(searchQuery.toLowerCase())
      )
    })
  }, [searchQuery, activeTab])

  // Convert saved agents to block format
  const agentBlocks = useMemo(() => {
    return agents.map(agent => ({
      // Use agent.id as part of the type to make it unique
      type: `agent_instance_${agent.id}`,
      name: agent.name,
      description: agent.description || 'Custom agent',
      category: 'agents' as BlockCategory,
      bgColor: '#5D3FD3',
      icon: AgentIcon,
      subBlocks: [
        {
          id: 'name',
          title: 'Agent Name',
          type: 'short-input',
          layout: 'full',
          placeholder: 'Enter agent name...',
        },
        {
          id: 'prompt',
          title: 'Prompt',
          type: 'long-input',
          layout: 'full',
          placeholder: 'Enter instructions for the agent...',
        },
        {
          id: 'mcpServers',
          title: 'MCP Servers (SSE only)',
          type: 'table',
          layout: 'full',
          columns: ['url'],
          placeholder: 'Add MCP server URL',
        }
      ],
      tools: {
        access: ['agent_create'],
        config: {
          tool: () => 'agent_create',
        },
      },
      inputs: {
        name: { type: 'string', required: true },
        prompt: { type: 'string', required: true },
        mcpServers: { 
          type: 'json', 
          required: true,
          schema: {
            type: 'array',
            properties: {},
            items: {
              type: 'object',
              properties: {
                url: { type: 'string' }
              },
              required: ['url']
            }
          }
        }
      },
      outputs: {
        response: {
          type: {
            content: 'string',
            name: 'string',
            prompt: 'string',
            mcpServers: 'json'
          },
        },
      },
      config: {
        name: agent.name,
        prompt: agent.config.systemPrompt,
        mcpServers: Object.entries(agent.config).map(([_, config]) => ({
          url: config.url
        })).filter(server => server.url),
        // Store the agent ID to identify it
        agentId: agent.id
      }
    } as BlockConfig))
  }, [agents])

  // For the agents tab content
  const showAgentsContent = activeTab === 'agents' && !searchQuery.trim()

  if (isCollapsed) {
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            onClick={() => setIsCollapsed(false)}
            className="fixed left-20 bottom-[18px] z-10 flex h-9 w-9 items-center justify-center rounded-lg bg-background text-muted-foreground transition-colors hover:text-foreground hover:bg-accent border"
          >
            <PanelRight className="h-5 w-5" />
            <span className="sr-only">Open Toolbar</span>
          </button>
        </TooltipTrigger>
        <TooltipContent side="right">Open Toolbar</TooltipContent>
      </Tooltip>
    )
  }

  return (
    <div className="fixed left-14 top-16 z-10 h-[calc(100vh-4rem)] w-60 border-r bg-background sm:block">
      <div className="flex flex-col h-full">
        <div className="px-4 pt-4 pb-1 sticky top-0 bg-background z-20">
          <div className="relative">
            <Search className="absolute left-3 top-[50%] h-4 w-4 -translate-y-[50%] text-muted-foreground" />
            <Input
              placeholder="Search..."
              className="pl-9 rounded-md"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              autoComplete="off"
              autoCorrect="off"
              autoCapitalize="off"
              spellCheck="false"
            />
          </div>
        </div>

        {!searchQuery && (
          <div className="sticky top-[72px] bg-background z-20">
            <ToolbarTabs activeTab={activeTab} onTabChange={setActiveTab} />
          </div>
        )}

        <ScrollArea className="h-[calc(100%-4rem)]">
          <div className="p-4 pb-20">
            {showAgentsContent ? (
              <div className="flex flex-col gap-3">
                <div className="p-4 rounded-md border border-dashed flex flex-col items-center justify-center gap-2 text-muted-foreground">
                  <p className="text-sm text-center">Customize and manage your agents here</p>
                  <button 
                    onClick={() => setIsCreateModalOpen(true)}
                    className="px-3 py-1.5 text-xs bg-primary/10 rounded-md text-primary hover:bg-primary/20 transition-colors"
                  >
                    Create New Agent
                  </button>
                </div>
                
                <div className="mt-4">
                  {agentBlocks.length > 0 ? (
                    <>
                      <h3 className="text-sm font-medium text-foreground mb-2">Your Agents</h3>
                      <div className="space-y-2">
                        {agentBlocks.map((block) => (
                          <ToolbarBlock key={block.type + block.name} config={block} />
                        ))}
                      </div>
                    </>
                  ) : null}
                  
                  <h3 className="text-sm font-medium text-foreground mb-2 mt-6">Available Templates</h3>
                  <div className="grid gap-3">
                    {getBlocksByCategory('agents').map((block) => (
                      <ToolbarBlock key={block.type} config={block} />
                    ))}
                  </div>
                  {getBlocksByCategory('agents').length === 0 && agentBlocks.length === 0 && (
                    <div className="p-3 rounded-md bg-muted/30 text-sm text-muted-foreground">
                      No agent templates available yet. Create your first custom agent.
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div className="flex flex-col gap-3">
                {blocks.map((block) => (
                  <ToolbarBlock key={block.type} config={block} />
                ))}
              </div>
            )}
          </div>
        </ScrollArea>

        <div className="absolute left-0 right-0 bottom-0 h-16 bg-background border-t">
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                onClick={() => setIsCollapsed(true)}
                className="absolute right-4 bottom-[18px] flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:text-foreground hover:bg-accent"
              >
                <PanelLeftClose className="h-5 w-5" />
                <span className="sr-only">Close Toolbar</span>
              </button>
            </TooltipTrigger>
            <TooltipContent side="left">Close Toolbar</TooltipContent>
          </Tooltip>
        </div>
      </div>
      
      <CreateAgentModal 
        isOpen={isCreateModalOpen} 
        onClose={() => setIsCreateModalOpen(false)} 
        createAgent={createAgent}
      />
    </div>
  )
}

export function Toolbar() {
  return (
    <AgentProvider>
      <ToolbarContent />
    </AgentProvider>
  )
}
