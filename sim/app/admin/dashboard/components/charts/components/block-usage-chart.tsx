'use client'

import { formatBlockName } from './block-utils'
import { useTheme } from 'next-themes'
import {
  FunctionSquare,
  Database,
  Image,
  Table2,
  Eye,
  Bot,
  MessageSquare,
  Workflow,
  PlayCircle,
  Code,
} from 'lucide-react'

interface BlockUsageChartProps {
  blocks: string[]
  count: number[]
}

const getBlockIcon = (blockType: string) => {
  const iconMap = {
    function: FunctionSquare,
    mem0: Database,
    image_generator: Image,
    google_sheets: Table2,
    vision: Eye,
    agent: Bot,
    chat: MessageSquare,
    workflow: Workflow,
    starter: PlayCircle,
    code: Code,
  }

  return iconMap[blockType.toLowerCase() as keyof typeof iconMap] || Code
}

export default function BlockUsageChart({ blocks, count }: BlockUsageChartProps) {
  const { theme } = useTheme()
  const isDark = theme === 'dark'
  
  // Validate that blocks and count arrays have the same length
  if (blocks.length !== count.length) {
    console.error(`BlockUsageChart: blocks array (${blocks.length}) and count array (${count.length}) have different lengths`)
    return (
      <p className="text-sm text-muted-foreground p-6">
        Invalid data: block and count arrays have different lengths
      </p>
    )
  }
  
  // Filter out the starter block, sort by count, and take top 10
  const blockData = blocks
    .map((block, index) => ({
      type: block,
      count: count[index],
      Icon: getBlockIcon(block)
    }))
    .filter(block => block.type.toLowerCase() !== 'starter')
    .sort((a, b) => b.count - a.count)
    .slice(0, 10) // Take only top 10 blocks

  if (blockData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground p-6">
        No block usage data available
      </p>
    )
  }

  // Find the maximum count to use as the denominator for percentage calculations
  const maxCount = Math.max(...blockData.map(block => block.count))
  
  // If maxCount is 0, set a default value to avoid division by zero
  const safeMaxCount = maxCount === 0 ? 1 : maxCount

  return (
    <div className="space-y-3">
      {blockData.map(({ type, count, Icon }, index) => {
        // Calculate brightness based on index (0-9)
        const brightness = 1 - (index * 0.07) // Gradual decrease in brightness
        
        // Calculate width percentage safely, avoiding division by zero
        const widthPercentage = (count / safeMaxCount) * 100

        return (
          <div
            key={type}
            className="relative h-14 rounded-xl overflow-hidden"
            style={{
              background: isDark 
                ? `rgb(147 51 238 / ${0.9 - index * 0.07})`  // From bright to dull purple
                : `rgb(147 51 238 / ${0.8 - index * 0.06})`  // Slightly less opacity for light mode
            }}
          >
            <div 
              className="absolute inset-0 bg-white/10"
              style={{ width: `${widthPercentage}%` }}
            />
            <div className="relative h-full px-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <Icon className="h-5 w-5 text-white" />
                <span className="font-medium text-white">
                  {formatBlockName(type)}
                </span>
              </div>
              <span className="text-sm text-white/90">
                {count} {count === 1 ? 'use' : 'uses'}
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
} 