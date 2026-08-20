'use client'

import { useEffect, useRef, useState } from 'react'
import { Loader2, Play, RefreshCw, Search, Square } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { createLogger } from '@/lib/logs/console-logger'
import { useDebounce } from '@/hooks/use-debounce'
import { useFilterStore } from '../../stores/store'
import type { LogsResponse } from '../../stores/types'

const logger = createLogger('ControlBar')

/**
 * Control bar for logs page - includes search functionality and refresh/live controls
 */
export function ControlBar() {
  const [isLive, setIsLive] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [isRefreshing, setIsRefreshing] = useState(false)
  const liveIntervalRef = useRef<NodeJS.Timeout | null>(null)
  const debouncedSearchQuery = useDebounce(searchQuery, 300)
  const {
    setSearchQuery: setStoreSearchQuery,
    setLogs,
    setError,
    buildQueryParams,
  } = useFilterStore()

  // Update store when debounced search query changes
  useEffect(() => {
    setStoreSearchQuery(debouncedSearchQuery)
  }, [debouncedSearchQuery, setStoreSearchQuery])

  const fetchLogs = async () => {
    try {
      const queryParams = buildQueryParams(1, 50) // Get first 50 logs for refresh
      const response = await fetch(`/api/logs?${queryParams}`)

      if (!response.ok) {
        throw new Error(`Error fetching logs: ${response.statusText}`)
      }

      const data: LogsResponse = await response.json()
      return data
    } catch (err) {
      logger.error('Failed to fetch logs:', { err })
      throw err
    }
  }

  const handleRefresh = async () => {
    if (isRefreshing) return

    setIsRefreshing(true)

    // Create a timer to ensure the spinner shows for at least 1 second
    const minLoadingTime = new Promise((resolve) => setTimeout(resolve, 1000))

    try {
      // Fetch new logs
      const logsResponse = await fetchLogs()

      // Wait for minimum loading time
      await minLoadingTime

      // Replace logs with fresh filtered results from server
      setLogs(logsResponse.data)
      setError(null)
    } catch (err) {
      // Wait for minimum loading time
      await minLoadingTime

      setError(err instanceof Error ? err.message : 'An unknown error occurred')
    } finally {
      setIsRefreshing(false)
    }
  }

  // Setup or clear the live refresh interval when isLive changes
  useEffect(() => {
    // Clear any existing interval
    if (liveIntervalRef.current) {
      clearInterval(liveIntervalRef.current)
      liveIntervalRef.current = null
    }

    // If live mode is active, set up the interval
    if (isLive) {
      // Initial refresh when live mode is activated
      handleRefresh()

      // Set up interval for subsequent refreshes (every 5 seconds)
      liveIntervalRef.current = setInterval(() => {
        handleRefresh()
      }, 5000)
    }

    // Cleanup function to clear interval when component unmounts or isLive changes
    return () => {
      if (liveIntervalRef.current) {
        clearInterval(liveIntervalRef.current)
        liveIntervalRef.current = null
      }
    }
  }, [isLive])

  const toggleLive = () => {
    setIsLive(!isLive)
  }

  return (
    <div className='flex h-16 w-full items-center justify-between border-b bg-background px-6 transition-all duration-300'>
      {/* Left Section - Search */}
      <div className='relative w-[400px]'>
        <div className='pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3'>
          <Search className='h-4 w-4 text-muted-foreground' />
        </div>
        <Input
          type='search'
          placeholder='Search logs...'
          className='h-9 pl-10'
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>

      {/* Middle Section - Reserved for future use */}
      <div className='flex-1' />

      {/* Right Section - Actions */}
      <div className='flex items-center gap-3'>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant='ghost'
              size='icon'
              onClick={handleRefresh}
              className='hover:text-foreground'
              disabled={isRefreshing}
            >
              {isRefreshing ? (
                <Loader2 className='h-5 w-5 animate-spin' />
              ) : (
                <RefreshCw className='h-5 w-5' />
              )}
              <span className='sr-only'>Refresh</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>{isRefreshing ? 'Refreshing...' : 'Refresh'}</TooltipContent>
        </Tooltip>

        <Button
          className={`gap-2 border bg-background text-foreground hover:bg-accent ${
            isLive ? 'border-[#802FFF]' : 'border-input'
          }`}
          onClick={toggleLive}
        >
          {isLive ? (
            <Square className='!h-3.5 !w-3.5 text-[#802FFF]' />
          ) : (
            <Play className='!h-3.5 !w-3.5' />
          )}
          <span className={`${isLive ? 'text-[#802FFF]' : 'text-foreground'}`}>Live</span>
        </Button>
      </div>
    </div>
  )
}
