'use client'

import { useState } from 'react'
import { RefreshCw, Search } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'

/**
 * Control bar for logs page - includes search functionality and refresh/live controls
 */
export function ControlBar() {
  const [isLive, setIsLive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')

  const handleRefresh = () => {
    // Implement refresh functionality
    console.log('Refreshing logs')
  }

  const toggleLive = () => {
    setIsLive(!isLive)
  }

  return (
    <div className="flex h-16 w-full items-center justify-between bg-background px-6 border-b transition-all duration-300">
      {/* Left Section - Search */}
      <div className="relative w-[400px]">
        <div className="absolute inset-y-0 left-0 flex items-center pl-3 pointer-events-none">
          <Search className="h-4 w-4 text-muted-foreground" />
        </div>
        <Input
          type="search"
          placeholder="Search logs..."
          className="pl-10 h-9"
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Middle Section - Reserved for future use */}
      <div className="flex-1" />

      {/* Right Section - Actions */}
      <div className="flex items-center gap-3">
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleRefresh}
              className="hover:text-foreground"
            >
              <RefreshCw className="h-5 w-5" />
              <span className="sr-only">Refresh</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>Refresh</TooltipContent>
        </Tooltip>

        <Button
          variant={isLive ? 'default' : 'outline'}
          className={isLive ? 'bg-[#7F2FFF] hover:bg-[#7F2FFF]/90 text-white' : ''}
          onClick={toggleLive}
        >
          Live
        </Button>
      </div>
    </div>
  )
}
