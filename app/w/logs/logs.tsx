'use client'

import { useEffect, useState } from 'react'
import { format } from 'date-fns'
import { AlertCircle, AlertTriangle, ArrowDownUp, Clock, Info, Loader2 } from 'lucide-react'
import { ControlBar } from './components/control-bar/control-bar'
import { Filters } from './components/filters/filters'

// Define types for our logs data
interface WorkflowLog {
  id: string
  workflowId: string
  executionId: string | null
  level: string
  message: string
  duration: string | null
  trigger: string | null
  createdAt: string
  workflow?: WorkflowData | null
}

interface WorkflowData {
  id: string
  name: string
  description: string | null
  color: string
  state: any
  // Add other workflow fields as needed
}

interface LogsResponse {
  data: WorkflowLog[]
  total: number
  page: number
  pageSize: number
  totalPages: number
}

// Helper function to format date
const formatDate = (dateString: string) => {
  const date = new Date(dateString)
  return {
    full: date.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    time: date.toLocaleTimeString([], {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hour12: false,
    }),
    formatted: format(date, 'HH:mm:ss'),
    relative: (() => {
      const now = new Date()
      const diffMs = now.getTime() - date.getTime()
      const diffMins = Math.floor(diffMs / 60000)

      if (diffMins < 1) return 'just now'
      if (diffMins < 60) return `${diffMins}m ago`

      const diffHours = Math.floor(diffMins / 60)
      if (diffHours < 24) return `${diffHours}h ago`

      const diffDays = Math.floor(diffHours / 24)
      if (diffDays === 1) return 'yesterday'
      if (diffDays < 7) return `${diffDays}d ago`

      return format(date, 'MMM d')
    })(),
  }
}

// Helper function to get level badge styling
const getLevelBadgeStyles = (level: string) => {
  switch (level.toLowerCase()) {
    case 'error':
      return 'bg-destructive/20 text-destructive'
    case 'warn':
      return 'bg-warning/20 text-warning'
    default:
      return 'bg-[#7F2FFF]/20 text-[#7F2FFF]'
  }
}

// Helper function to get trigger badge styling
const getTriggerBadgeStyles = (trigger: string) => {
  return trigger.toLowerCase() === 'manual'
    ? 'bg-secondary text-secondary-foreground'
    : 'bg-[#7F2FFF]/20 text-[#7F2FFF]'
}

export default function Logs() {
  const [logs, setLogs] = useState<WorkflowLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [pagination, setPagination] = useState({
    total: 0,
    page: 1,
    pageSize: 100,
    totalPages: 0,
  })

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

        // Log the response to console as requested
        console.log('Workflow logs response:', data)

        setLogs(data.data)
        setPagination({
          total: data.total,
          page: data.page,
          pageSize: data.pageSize,
          totalPages: data.totalPages,
        })

        setError(null)
      } catch (err) {
        console.error('Failed to fetch logs:', err)
        setError(err instanceof Error ? err.message : 'An unknown error occurred')
        setLogs([])
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
  }, [])

  return (
    <div className="flex flex-col h-[100vh]">
      <ControlBar />
      <div className="flex flex-1 overflow-hidden">
        <Filters />
        <div className="flex-1 flex flex-col overflow-hidden">
          {/* Table header - fixed */}
          <div className="border-b bg-background z-10 sticky top-0">
            <div className="grid grid-cols-12 gap-4 px-4 py-3 text-xs font-medium text-muted-foreground">
              <div className="col-span-2 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5" />
                <span>Time</span>
              </div>
              <div className="col-span-1 flex items-center gap-1.5">
                <span>Status</span>
              </div>
              <div className="col-span-2 flex items-center gap-1.5">
                <span>Workflow</span>
              </div>
              <div className="col-span-1 hidden lg:flex items-center gap-1.5">
                <span>Trigger</span>
              </div>
              <div className="col-span-6 md:col-span-5 flex items-center gap-1.5">
                <span>Message</span>
              </div>
              <div className="col-span-1 flex items-center gap-1.5">
                <span>Duration</span>
              </div>
            </div>
          </div>

          {/* Table body - scrollable */}
          <div className="flex-1 overflow-auto">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <Loader2 className="h-6 w-6 animate-spin text-primary" />
                <span className="ml-2 text-sm text-muted-foreground">Loading logs...</span>
              </div>
            ) : error ? (
              <div className="flex items-center justify-center h-full">
                <AlertCircle className="h-5 w-5 text-destructive" />
                <span className="ml-2 text-sm text-destructive">Error: {error}</span>
              </div>
            ) : logs.length === 0 ? (
              <div className="flex items-center justify-center h-full text-muted-foreground">
                <Info className="h-5 w-5 mr-2" />
                <span className="text-sm">No logs found</span>
              </div>
            ) : (
              <div>
                {logs.map((log) => {
                  const formattedDate = formatDate(log.createdAt)
                  return (
                    <div
                      key={log.id}
                      className="group border-b hover:bg-accent/30 transition-colors"
                    >
                      <div className="grid grid-cols-12 gap-4 px-4 py-3">
                        {/* Time column */}
                        <div className="col-span-2 flex flex-col justify-center">
                          <div className="text-xs font-medium flex items-center">
                            <span>{formattedDate.formatted}</span>
                            <span className="mx-1.5 text-muted-foreground hidden xl:inline">•</span>
                            <span className="text-muted-foreground hidden xl:inline">
                              {format(new Date(log.createdAt), 'MMM d, yyyy')}
                            </span>
                          </div>
                          <div className="text-xs text-muted-foreground mt-0.5 flex items-center justify-between">
                            <span>{formattedDate.relative}</span>
                          </div>
                        </div>

                        {/* Level column */}
                        <div className="col-span-1 flex items-center">
                          <div
                            className={`inline-flex items-center justify-center px-2 py-1 text-xs rounded-md ${getLevelBadgeStyles(log.level)}`}
                          >
                            <span className="font-medium">{log.level}</span>
                          </div>
                        </div>

                        {/* Workflow column */}
                        <div className="col-span-2 flex items-center">
                          {log.workflow && (
                            <div
                              className="inline-flex items-center px-2 py-1 text-xs rounded-md truncate max-w-full"
                              style={{
                                backgroundColor: `${log.workflow.color}20`,
                                color: log.workflow.color,
                              }}
                              title={log.workflow.name}
                            >
                              {log.workflow.name}
                            </div>
                          )}
                        </div>

                        {/* Trigger column - hidden on medium screens and below */}
                        <div className="col-span-1 hidden lg:flex items-center">
                          {log.trigger && (
                            <div
                              className={`inline-flex items-center px-2 py-1 text-xs rounded-md ${getTriggerBadgeStyles(log.trigger)}`}
                            >
                              {log.trigger}
                            </div>
                          )}
                        </div>

                        {/* Message column - expanded on medium screens when trigger is hidden */}
                        <div className="col-span-6 md:col-span-5 flex items-center">
                          <div className="text-sm truncate" title={log.message}>
                            {log.message}
                          </div>
                        </div>

                        {/* Duration column */}
                        <div className="col-span-1 flex items-center">
                          <div className="flex items-center text-xs text-muted-foreground">
                            <span>{log.duration || '—'}</span>
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
