'use client'

import { useEffect, useState } from 'react'
import { getMcpTools } from '@/lib/mcp'

interface McpTool {
  id: string
  name: string
  description: string
  icon: React.ComponentType<any>
  bgColor: string
  type: string
  server: string
}

interface McpToolsProps {
  onToolClick: (toolType: string) => void
}

export function McpTools({ onToolClick }: McpToolsProps) {
  const [mcpTools, setMcpTools] = useState<McpTool[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  async function fetchMcpTools() {
    setIsLoading(true)
    setError(null)
    try {
      const tools = await getMcpTools()
      setMcpTools(tools)
    } catch (error) {
      console.error('Error fetching MCP tools:', error)
      setError('Failed to load MCP tools. Please ensure the MCPO server is running and the configuration is correct.')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    fetchMcpTools()
  }, [])

  const groupedTools = mcpTools.reduce(
    (acc, tool) => {
      if (!acc[tool.server]) {
        acc[tool.server] = []
      }
      acc[tool.server].push(tool)
      return acc
    },
    {} as Record<string, McpTool[]>
  )

  if (isLoading) {
    return <div>Loading MCP Tools...</div>
  }

  if (error) {
    return (
      <div className="text-red-500 p-4">
        <p>{error}</p>
        <button
          onClick={fetchMcpTools}
          className="mt-2 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
        >
          Retry
        </button>
      </div>
    )
  }

  return (
    <div>
      {Object.entries(groupedTools).map(([server, tools]) => (
        <div key={server}>
          <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
            {server}
          </h3>
          <div
            className='scrollbar-none flex gap-2 overflow-x-auto px-6 pb-1'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {tools.map((tool) => (
              <button
                key={tool.id}
                onClick={() => onToolClick(tool.type)}
                className='flex h-auto w-[180px] flex-shrink-0 cursor-pointer flex-col items-start gap-2 rounded-[8px] border p-3 transition-all duration-200 border-border/40 bg-background/60 hover:border-border hover:bg-secondary/80'
              >
                <div className='flex items-center gap-2'>
                  <div
                    className='flex h-5 w-5 items-center justify-center rounded-[4px]'
                    style={{ backgroundColor: tool.bgColor }}
                  >
                    <tool.icon className='!h-3.5 !w-3.5 text-white' />
                  </div>
                  <span className='font-medium font-sans text-foreground text-sm leading-none tracking-normal'>
                    {tool.name}
                  </span>
                </div>
                {tool.description && (
                  <p className='line-clamp-2 text-left text-muted-foreground text-xs'>
                    {tool.description}
                  </p>
                )}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
