'use client'

import { useState } from 'react'
import { cn } from '@/lib/utils'
import { formatBlockName, getBlockIcon } from './block-utils'
import { useTheme } from 'next-themes'

interface BlockUsageChartProps {
  blocks: string[]
  count: number[]
}

interface CursorPosition {
  x: number
  y: number
}

export default function BlockUsageChart({ blocks, count }: BlockUsageChartProps) {
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null)
  const [cursorPosition, setCursorPosition] = useState<CursorPosition>({ x: 0, y: 0 })
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  
  // Filter out the starter block
  const filteredData = blocks.reduce<{ blocks: string[]; count: number[] }>((acc, block, index) => {
    if (block.toLowerCase() !== 'starter') {
      acc.blocks.push(block)
      acc.count.push(count[index])
    }
    return acc
  }, { blocks: [], count: [] })

  const maxCount = Math.max(...filteredData.count)

  // Function to get color intensity based on usage
  const getColorStyle = (count: number, isHovered: boolean) => {
    const intensity = (count / maxCount)
    // Use different purple shades for dark/light mode
    const baseColor = isDark
      ? isHovered ? '192, 132, 252' : '168, 85, 247' // purple-400 : purple-500
      : isHovered ? '147, 51, 234' : '126, 34, 206'  // purple-600 : purple-700
    
    const alphaBase = isDark
      ? 0.15 + (intensity * 0.35) // Dark mode: 0.15-0.5 opacity range
      : 0.2 + (intensity * 0.8)   // Light mode: 0.2-1.0 opacity range
    
    const alpha = isHovered ? Math.min(alphaBase + 0.1, isDark ? 0.6 : 1) : alphaBase
    
    return {
      backgroundColor: `rgba(${baseColor}, ${alpha})`,
      transform: isHovered ? 'scale(1.02)' : 'scale(1)',
    }
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    setCursorPosition({ x: e.clientX, y: e.clientY })
  }

  if (filteredData.blocks.length === 0) {
    return (
      <div className="p-6">
        <p className="text-sm text-muted-foreground">
          No block usage data available
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-2 relative">
      {filteredData.blocks.map((block, index) => {
        const isHovered = hoveredIndex === index
        const percentage = (filteredData.count[index] / maxCount) * 100
        const colorStyle = getColorStyle(filteredData.count[index], isHovered)
        const BlockIcon = getBlockIcon(block)

        return (
          <div key={block}>
            <div
              className="relative group cursor-pointer"
              onMouseEnter={() => setHoveredIndex(index)}
              onMouseLeave={() => setHoveredIndex(null)}
              onMouseMove={handleMouseMove}
            >
              <div
                className={cn(
                  "p-4 rounded-lg transition-all duration-300 ease-in-out",
                  "border border-border/50 hover:border-border",
                  "transform-gpu will-change-transform",
                  "dark:hover:border-border/80"
                )}
                style={colorStyle}
              >
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <BlockIcon className={cn(
                      "h-4 w-4 transition-colors duration-300",
                      isHovered 
                        ? isDark ? "text-purple-400" : "text-purple-600"
                        : "text-muted-foreground"
                    )} />
                    <span className="font-medium text-sm">
                      {formatBlockName(block)}
                    </span>
                  </div>
                  <span className={cn(
                    "text-sm transition-colors duration-300",
                    isHovered 
                      ? isDark ? "text-purple-400 font-medium" : "text-purple-600 font-medium"
                      : "text-muted-foreground"
                  )}>
                    {filteredData.count[index]} uses
                  </span>
                </div>
              </div>
            </div>
          </div>
        )
      })}

      {/* Floating Tooltip */}
      {hoveredIndex !== null && (
        <div
          className={cn(
            "fixed z-50 p-3 rounded-lg shadow-lg",
            "bg-popover border border-border",
            "pointer-events-none transition-opacity duration-200",
            "text-popover-foreground"
          )}
          style={{
            left: `${cursorPosition.x}px`,
            top: `${cursorPosition.y - 10}px`,
            transform: 'translate(-50%, -100%)',
          }}
        >
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {hoveredIndex !== null && (
                <>
                  {(() => {
                    const BlockIcon = getBlockIcon(filteredData.blocks[hoveredIndex])
                    return <BlockIcon className="h-4 w-4" />
                  })()}
                  <p className="font-medium">
                    {formatBlockName(filteredData.blocks[hoveredIndex])}
                  </p>
                </>
              )}
            </div>
            <p className="text-sm text-muted-foreground">
              Used {filteredData.count[hoveredIndex]} times
            </p>
            <div className="h-1.5 w-full bg-muted rounded-full overflow-hidden">
              <div 
                className={cn(
                  "h-full rounded-full transition-all duration-300 ease-in-out",
                  isDark ? "bg-purple-400" : "bg-purple-600"
                )}
                style={{ 
                  width: `${(filteredData.count[hoveredIndex] / maxCount) * 100}%` 
                }}
              />
            </div>
            <p className="text-xs text-muted-foreground">
              {((filteredData.count[hoveredIndex] / maxCount) * 100).toFixed(1)}% of most used block
            </p>
          </div>
        </div>
      )}
    </div>
  )
} 