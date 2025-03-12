'use client'

import { useEffect, useMemo, useState } from 'react'
import { format } from 'date-fns'
import { AlertCircle, Info, Loader2 } from 'lucide-react'
import { ControlBar } from './components/control-bar/control-bar'
import { Filters } from './components/filters/filters'
import { Sidebar } from './components/sidebar/sidebar'
import { useFilterStore } from './stores/store'
import { LogsResponse, WorkflowLog } from './stores/types'
import { formatDate } from './utils/format-date'

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
  return trigger.toLowerCase() === 'manual'
    ? 'bg-secondary text-secondary-foreground'
    : 'bg-blue-100 dark:bg-blue-950/40 text-blue-700 dark:text-blue-400'
}

export default function Logs() {
  const { filteredLogs, logs, loading, error, setLogs, setLoading, setError } = useFilterStore()
  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)
  const [isSidebarOpen, setIsSidebarOpen] = useState(false)

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
    setIsSidebarOpen(true)
  }

  // Close sidebar
  const handleCloseSidebar = () => {
    setIsSidebarOpen(false)
  }

  // Fetch logs on component mount
  useEffect(() => {
    const fetchLogs = async () => {
      try {
        setLoading(true)
        // Include workflow data in the response
        const response = await fetch('/api/db/workflow-logs?includeWorkflow=true')

        if (!response.ok) {
          throw new Error(`Error fetching logs: ${response.statusText}`)
        }

        const data: LogsResponse = await response.json()

        // Log the response to console
        console.log('Workflow logs response:', data)

        setLogs(data.data)
        setError(null)
      } catch (err) {
        console.error('Failed to fetch logs:', err)
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
  }, [setLogs, setLoading, setError])

  return (
    <div className="flex flex-col h-[100vh]">
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
                  <col className="w-[8%]" />
                  <col className="w-[12%]" />
                  <col className="w-[8%] hidden lg:table-column" />
                  <col className="w-[8%] hidden lg:table-column" />
                  <col className="w-auto lg:w-auto" />
                  <col className="w-[8%]" />
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
                    <col className="w-[8%]" />
                    <col className="w-[12%]" />
                    <col className="w-[8%] hidden lg:table-column" />
                    <col className="w-[8%] hidden lg:table-column" />
                    <col className="w-auto lg:w-auto" />
                    <col className="w-[8%]" />
                  </colgroup>
                  <tbody>
                    {filteredLogs.map((log) => {
                      const formattedDate = formatDate(log.createdAt)

                      return (
                        <tr
                          key={log.id}
                          className="border-b hover:bg-accent/30 transition-colors cursor-pointer"
                          onClick={() => handleLogClick(log)}
                        >
                          {/* Time column */}
                          <td className="px-4 py-3">
                            <div className="flex flex-col justify-center">
                              <div className="text-xs font-medium flex items-center">
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
                            <div className="text-sm truncate" title={log.message}>
                              {log.message}
                            </div>
                          </td>

                          {/* Duration column */}
                          <td className="px-4 py-3">
                            <div className="text-xs text-muted-foreground">
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
      <Sidebar log={selectedLog} isOpen={isSidebarOpen} onClose={handleCloseSidebar} />
    </div>
  )
}
