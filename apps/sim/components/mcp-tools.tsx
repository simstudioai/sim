'use client'

import type { McpTool } from '@/lib/mcp'

interface McpToolsProps {
  onToolClick: (toolType: string) => void
  tools: McpTool[]
  isLoading: boolean
  isItemSelected: (index: number) => boolean
  scrollRef: (el: HTMLDivElement | null) => void
}

export function McpTools({
  onToolClick,
  tools,
  isLoading,
  isItemSelected,
  scrollRef,
}: McpToolsProps) {
  const groupedTools = tools.reduce(
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

  if (tools.length === 0) {
    return null
  }

  return (
    <div>
      {Object.entries(groupedTools).map(([server, serverTools]) => (
        <div key={server}>
          <h3 className='mb-3 ml-6 font-normal font-sans text-muted-foreground text-sm leading-none tracking-normal'>
            {server}
          </h3>
          <div
            ref={scrollRef}
            className='scrollbar-none flex gap-2 overflow-x-auto px-6 pb-1'
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {serverTools.map((tool, index) => (
              <button
                key={tool.id}
                onClick={() => onToolClick(tool.type)}
                data-nav-item={`mcp-tools-${index}`}
                className={`flex h-auto w-[180px] flex-shrink-0 cursor-pointer flex-col items-start gap-2 rounded-[8px] border p-3 transition-all duration-200 ${
                  isItemSelected(index)
                    ? 'border-border bg-secondary/80'
                    : 'border-border/40 bg-background/60 hover:border-border hover:bg-secondary/80'
                }`}
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
