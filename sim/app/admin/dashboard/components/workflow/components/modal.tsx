'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Badge } from '@/components/ui/badge'
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'
import { format, isValid, parseISO } from 'date-fns'
import { ErrorMessageDialog } from '../../errors/error-message-dialog'
import { Check, Copy } from 'lucide-react'
import { fetchWorkflowLogs } from '@/app/admin/dashboard/utils'

interface WorkflowLog {
  id: string
  workflow_id: string
  workflowName: string
  execution_id: string
  level: 'info' | 'error'
  message: string
  duration: string
  trigger: string
  created_at: string
  metadata: any
  success: boolean
}

interface WorkflowLogsModalProps {
  workflowId: string
  isOpen: boolean
  onClose: () => void
}

export function WorkflowLogsModal({ workflowId, isOpen, onClose }: WorkflowLogsModalProps) {
  const [logs, setLogs] = useState<WorkflowLog[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedError, setSelectedError] = useState<{ title: string; message: string } | null>(null)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [selectedLog, setSelectedLog] = useState<WorkflowLog | null>(null)

  // Reset copied state when modal closes
  useEffect(() => {
    if (!isOpen) {
      setCopiedId(null)
    }
  }, [isOpen])

  useEffect(() => {
    if (isOpen && workflowId) {
      setLoading(true)
      setError(null)
      
      async function loadLogs() {
        try {
          const logsData = await fetchWorkflowLogs(workflowId)
          setLogs(logsData)
        } catch (err) {
          console.error('Error fetching logs:', err)
          const errorMessage = err instanceof Error ? err.message : 'Failed to fetch logs'
          setError(errorMessage)
          
          // If it's a 404 error, we can still show the UI with an empty logs array
          if (errorMessage.includes('No logs found')) {
            setLogs([])
          }
        } finally {
          setLoading(false)
        }
      }
      
      loadLogs()
    }
  }, [isOpen, workflowId])

  // Helper function to safely format dates
  const formatDate = (dateString: string) => {
    try {
      const date = parseISO(dateString)
      if (isValid(date)) {
        return format(date, 'MMM d, yyyy HH:mm:ss')
      }
      return 'Invalid date'
    } catch (e) {
      return 'Invalid date'
    }
  }

  // Handle copy with proper cleanup
  const handleCopy = useCallback(async (executionId: string) => {
    try {
      await navigator.clipboard.writeText(executionId)
      setCopiedId(executionId)
      
      const timeoutId = setTimeout(() => {
        setCopiedId(null)
      }, 2000)

      return () => clearTimeout(timeoutId)
    } catch (err) {
      console.error('Failed to copy:', err)
    }
  }, [])

  // Effect to manage copy timeout
  useEffect(() => {
    let cleanup: (() => void) | undefined

    if (copiedId) {
      // Use Promise.resolve to handle the async function
      Promise.resolve(handleCopy(copiedId)).then(cleanupFn => {
        cleanup = cleanupFn
      })
    }

    return () => {
      if (cleanup) cleanup()
    }
  }, [copiedId, handleCopy])

  // Helper function to display execution ID with copy functionality
  const displayExecutionId = (executionId: string | undefined | null) => {
    if (!executionId || executionId === 'N/A') {
      return <span className="text-muted-foreground">-</span>
    }

    const isCopied = copiedId === executionId

    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className="flex items-center gap-2 cursor-pointer group"
              onClick={() => handleCopy(executionId)}
            >
              <span className="font-mono truncate">
                {executionId}
              </span>
              {isCopied ? (
                <Check className="h-4 w-4 text-green-500 opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              ) : (
                <Copy className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity shrink-0" />
              )}
            </div>
          </TooltipTrigger>
          <TooltipContent 
            side="top" 
            align="start"
            className="z-[60] max-w-[300px] break-all bg-popover px-3 py-1.5 text-sm text-popover-foreground animate-in fade-in-0 zoom-in-95"
          >
            <p className="font-mono break-all">{executionId}</p>
            <p className="text-xs text-muted-foreground mt-1">Click to copy</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
    )
  }

  // Handle error click
  const handleErrorClick = (log: WorkflowLog) => {
    if (!log.success && log.message) {
      setSelectedError({
        title: 'Execution Failed',
        message: log.message
      })
    }
  }

  return (
    <>
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-4xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {logs[0]?.workflowName ? `Logs for ${logs[0].workflowName}` : 'Workflow Execution Logs'}
            </DialogTitle>
          </DialogHeader>

          {loading && <p className="text-center py-4">Loading logs...</p>}
          
          {error && !error.includes('No logs found') && (
            <div className="text-red-500 text-center py-4">
              Error: {error}
            </div>
          )}

          {!loading && !error && logs.length === 0 && (
            <p className="text-center py-4 text-muted-foreground">
              No logs found for this workflow
            </p>
          )}

          {!loading && error && error.includes('No logs found') && (
            <p className="text-center py-4 text-muted-foreground">
              No logs found for this workflow. This could be because:
              <ul className="list-disc list-inside mt-2 text-left max-w-md mx-auto">
                <li>The workflow has never been executed</li>
                <li>The logs have been cleared</li>
                <li>The workflow ID is incorrect</li>
              </ul>
            </p>
          )}

          {!loading && !error && logs.length > 0 && (
            <div className="relative">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-1/4">Execution ID</TableHead>
                    <TableHead className="w-1/6">Trigger</TableHead>
                    <TableHead className="w-1/4">Created At</TableHead>
                    <TableHead className="w-1/6">Duration</TableHead>
                    <TableHead className="w-1/6">Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {logs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="max-w-[200px]">
                        {displayExecutionId(log.execution_id)}
                      </TableCell>
                      <TableCell>{log.trigger || '-'}</TableCell>
                      <TableCell>{formatDate(log.created_at)}</TableCell>
                      <TableCell>{log.duration || '-'}</TableCell>
                      <TableCell>
                        <Badge
                          variant={log.success ? 'default' : 'destructive'}
                          className={
                            log.success 
                              ? 'bg-green-500/10 text-green-500 hover:bg-green-500/20'
                              : 'bg-red-500/10 text-red-500 hover:bg-red-500/20'
                          }
                          onClick={() => handleErrorClick(log)}
                        >
                          {log.success ? 'Success' : 'Failed'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {selectedError && (
        <ErrorMessageDialog
          title={selectedError.title}
          message={selectedError.message}
          isOpen={!!selectedError}
          onClose={() => setSelectedError(null)}
        />
      )}
    </>
  )
} 