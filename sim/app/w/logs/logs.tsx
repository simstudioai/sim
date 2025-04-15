'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { createLogger } from '@/lib/logs/console-logger'
import { ControlBar } from './components/control-bar/control-bar'
import { Filters } from './components/filters/filters'
import { Sidebar } from './components/sidebar/sidebar'
import { useFilterStore } from './stores/store'
import { LogsResponse, WorkflowLog } from './stores/types'
import { formatDate } from './utils/format-date'

const logger = createLogger('Logs')

// Helper function to get level badge styling
const getLevelBadgeStyles = (level: string) => {
  switch (level.toLowerCase()) {
    case 'error':
      return 'bg-destructive/20 text-destructive error-badge'
    case 'warn':
      return 'bg-warning/20 text-warning'
    default:
      return 'bg-secondary text-secondary-foreground'
  }
}

// Helper function to get trigger badge styling
const getTriggerBadgeStyles = (trigger: string) => {
  switch (trigger.toLowerCase()) {
    case 'manual':
      return 'bg-secondary text-secondary-foreground'
    case 'api':
      return 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
    case 'webhook':
      return 'bg-purple-100 dark:bg-purple-950/40 text-purple-700 dark:text-purple-400'
    case 'schedule':
      return 'bg-green-100 dark:bg-green-950/40 text-green-700 dark:text-green-400'
    default:
      return 'bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-400'
  }
}

// Add a new CSS class for the selected row animation
const selectedRowAnimation = `
  @keyframes borderPulse {
    0% { border-left-color: hsl(var(--primary) / 0.3); }
    50% { border-left-color: hsl(var(--primary) / 0.7); }
    100% { border-left-color: hsl(var(--primary) / 0.5); }
  }
  .selected-row {
    animation: borderPulse 1s ease-in-out;
    border-left-color: hsl(var(--primary) / 0.5);
  }
`

export default function Logs() {
  const { filteredLogs, logs, loading, error, setLogs, setLoading, setError } = useFilterStore()
  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [selectedLogIndex, setSelectedLogIndex] = useState<number>(-1)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)
  const selectedRowRef = useRef<HTMLTableRowElement | null>(null)

  // Group logs by executionId to identify the last log in each group
  const executionGroups = useMemo(() => {
    const groups: Record<string, WorkflowLog[]> = {}

    // Group logs by executionId
    filteredLogs.forEach((log) => {
      if (log.executionId) {
        if (!groups[log.executionId]) {
          groups[log.executionId] = []
        }
        groups[log.executionId].push(log)
      }
    })

    // Sort logs within each group by createdAt
    Object.keys(groups).forEach((executionId) => {
      groups[executionId].sort(
        (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      )
    })

    return groups
  }, [filteredLogs])

  // Handle log click
  const handleLogClick = (log: WorkflowLog) => {
    setSelectedLog(log)
    // Find the index of the clicked log in the filtered logs array
    const index = filteredLogs.findIndex((l) => l.id === log.id)
    setSelectedLogIndex(index)
    setIsSidebarOpen(true)
  }

  // Navigate to the next log
  const handleNavigateNext = () => {
    if (selectedLogIndex < filteredLogs.length - 1) {
      const nextIndex = selectedLogIndex + 1
      setSelectedLogIndex(nextIndex)
      setSelectedLog(filteredLogs[nextIndex])
    }
  }

  // Navigate to the previous log
  const handleNavigatePrev = () => {
    if (selectedLogIndex > 0) {
      const prevIndex = selectedLogIndex - 1
      setSelectedLogIndex(prevIndex)
      setSelectedLog(filteredLogs[prevIndex])
    }
  }

  // Close sidebar
  const handleCloseSidebar = () => {
    setIsSidebarOpen(false)
  }

  // Scroll selected log into view when it changes
  useEffect(() => {
    if (selectedRowRef.current) {
      selectedRowRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      })
    }
  }, [selectedLogIndex])

  // Fetch logs on component mount
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true)
        // Include workflow data in the response
        const response = await fetch('/api/logs?includeWorkflow=true')

        if (!response.ok) {
          throw new Error(`Error fetching logs: ${response.statusText}`)
        }

        const data: LogsResponse = await response.json()

        setLogs(data.data)
        setError(null)
      } catch (err) {
        logger.error('Failed to fetch logs:', { err })
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
  }, [setLogs, setLoading, setError])

  // Add keyboard navigation for the logs table
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle keyboard navigation if we have logs and a log is selected
      if (filteredLogs.length === 0) return

      // If no log is selected yet, select the first one on arrow key press
      if (selectedLogIndex === -1 && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
        e.preventDefault()
        setSelectedLogIndex(0)
        setSelectedLog(filteredLogs[0])
        return
      }

      // Up arrow key for previous log
      if (e.key === 'ArrowUp' && !e.metaKey && !e.ctrlKey && selectedLogIndex > 0) {
        e.preventDefault()
        handleNavigatePrev()
      }

      // Down arrow key for next log
      if (
        e.key === 'ArrowDown' &&
        !e.metaKey &&
        !e.ctrlKey &&
        selectedLogIndex < filteredLogs.length - 1
      ) {
        e.preventDefault()
        handleNavigateNext()
      }

      // Enter key to open/close sidebar
      if (e.key === 'Enter' && selectedLog) {
        e.preventDefault()
        setIsSidebarOpen(!isSidebarOpen)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    filteredLogs,
    selectedLogIndex,
    isSidebarOpen,
    selectedLog,
    handleNavigateNext,
    handleNavigatePrev,
    setIsSidebarOpen,
  ])

  return (
    <div className="flex flex-col h-[100vh]">
      {/* Add the animation styles */}
      <style jsx global>
        {selectedRowAnimation}
      </style>

      <ControlBar />
      <div className="flex flex-1 overflow-hidden">
        <Filters />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Table container */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Table header - fixed */}
            <div className="border-b bg-background z-10 sticky top-0">
              <table className="w-full table-fixed">
                <colgroup>
                  <col className="w-[16%]" />
                  <col className="w-[8%] md:w-[7%]" />
                  <col className="w-[12%] md:w-[10%]" />
                  <col className="w-[8%] hidden lg:table-column" />
                  <col className="w-[8%] hidden lg:table-column" />
                  <col className="w-auto md:w-[53%] lg:w-auto" />
                  <col className="w-[8%] md:w-[10%]" />
                </colgroup>
                <thead>
                  <tr>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Time</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Status</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Workflow</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground leading-none">id</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium hidden lg:table-cell">
                      <span className="text-xs text-muted-foreground leading-none">Trigger</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Message</span>
                    </th>
                    <th className="px-4 pt-2 pb-3 text-left font-medium">
                      <span className="text-xs text-muted-foreground leading-none">Duration</span>
                    </th>
                  </tr>
                </thead>
              </table>
            </div>

            {/* Table body - scrollable */}
            <div className="flex-1 overflow-auto">
              {loading ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Loader2 className="h-5 w-5 animate-spin" />
                    <span className="text-sm">Loading logs...</span>
                  </div>
                </div>
              ) : error ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-destructive">
                    <AlertCircle className="h-5 w-5" />
                    <span className="text-sm">Error: {error}</span>
                  </div>
                </div>
              ) : filteredLogs.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex items-center gap-2 text-muted-foreground">
                    <Info className="h-5 w-5" />
                    <span className="text-sm">No logs found</span>
                  </div>
                </div>
              ) : (
                <table className="w-full table-fixed">
                  <colgroup>
                    <col className="w-[16%]" />
                    <col className="w-[8%] md:w-[7%]" />
                    <col className="w-[12%] md:w-[10%]" />
                    <col className="w-[8%] hidden lg:table-column" />
                    <col className="w-[8%] hidden lg:table-column" />
                    <col className="w-auto md:w-[53%] lg:w-auto" />
                    <col className="w-[8%] md:w-[10%]" />
                  </colgroup>
                  <tbody>
                    {filteredLogs.map((log) => {
                      const formattedDate = formatDate(log.createdAt)
                      const isSelected = selectedLog?.id === log.id
                      const isWorkflowExecutionLog =
                        log.executionId && executionGroups[log.executionId].length === 1

                      return (
                        <tr
                          key={log.id}
                          ref={isSelected ? selectedRowRef : null}
                          className={`border-b transition-colors cursor-pointer ${
                            isSelected
                              ? 'bg-accent/40 hover:bg-accent/50 border-l-2 selected-row'
                              : 'hover:bg-accent/30'
                          }`}
                          onClick={() => handleLogClick(log)}
                        >
                          {/* Time column */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col justify-center">
                              <div
                                className={`text-xs font-medium flex items-center ${isSelected ? 'text-foreground' : ''}`}
                              >
                                <span>{formattedDate.formatted}</span>
                                <span className="mx-1.5 text-muted-foreground hidden xl:inline">
                                  •
                                </span>
                                <span className="text-muted-foreground hidden xl:inline">
                                  {new Date(log.createdAt).toLocaleDateString('en-US', {
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric',
                                  })}
                                </span>
                              </div>
                              <div className="text-xs text-muted-foreground mt-0.5">
                                <span>{formattedDate.relative}</span>
                              </div>
                            </div>
                          </td>

                          {/* Level column */}
                          <td className="px-4 py-3">
                            <div
                              className={`inline-flex items-center justify-center px-2 py-1 text-xs rounded-md ${getLevelBadgeStyles(log.level)}`}
                            >
                              <span className="font-medium">{log.level}</span>
                            </div>
                          </td>

                          {/* Workflow column */}
                          <td className="px-4 py-3">
                            {log.workflow && (
                              <div
                                className="inline-flex items-center px-2 py-1 text-xs rounded-md truncate max-w-full"
                                style={{
                                  backgroundColor: `${log.workflow.color}20`,
                                  color: log.workflow.color,
                                }}
                                title={log.workflow.name}
                              >
                                <span className="font-medium truncate">{log.workflow.name}</span>
                              </div>
                            )}
                          </td>

                          {/* ID column - hidden on small screens */}
                          <td className="px-4 py-3 hidden lg:table-cell">
                            <div className="text-xs font-mono text-muted-foreground">
                              {log.executionId ? `#${log.executionId.substring(0, 4)}` : '—'}
                            </div>
                          </td>

                          {/* Trigger column - hidden on medium screens and below */}
                          <td className="px-4 py-3 hidden lg:table-cell">
                            {log.trigger && (
                              <div
                                className={`inline-flex items-center px-2 py-1 text-xs rounded-md ${getTriggerBadgeStyles(log.trigger)}`}
                              >
                                <span className="font-medium">{log.trigger}</span>
                              </div>
                            )}
                          </td>

                          {/* Message column */}
                          <td className="px-4 py-3">
                            <div
                              className={`text-sm truncate ${isSelected ? 'text-foreground' : ''}`}
                              title={log.message}
                            >
                              {log.message}
                            </div>
                          </td>

                          {/* Duration column */}
                          <td className="px-4 py-3">
                            <div
                              className={`text-xs ${isSelected ? 'text-foreground' : 'text-muted-foreground'}`}
                            >
                              {log.duration || '—'}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Log Sidebar */}
      <Sidebar
        log={selectedLog}
        isOpen={isSidebarOpen}
        onClose={handleCloseSidebar}
        onNavigateNext={handleNavigateNext}
        onNavigatePrev={handleNavigatePrev}
        hasNext={selectedLogIndex < filteredLogs.length - 1}
        hasPrev={selectedLogIndex > 0}
      />
    </div>
  )
}
