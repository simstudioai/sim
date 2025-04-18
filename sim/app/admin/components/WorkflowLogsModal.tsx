'use client'

import { useState, useEffect } from 'react'
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
import { ErrorMessageDialog } from './ErrorMessageDialog'
import { Check, Copy } from 'lucide-react'

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

  useEffect(() => {
    async function fetchLogs() {
      if (!isOpen || !workflowId) return

      setLoading(true)
      setError(null)

      try {
        const response = await fetch(`/api/admin/workflows/${workflowId}/logs`)
        const data = await response.json()

        if (!response.ok) {
          throw new Error(data.error || 'Failed to fetch logs')
        }

        setLogs(data.logs)
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch logs')
      } finally {
        setLoading(false)
      }
    }

    fetchLogs()
  }, [workflowId, isOpen])

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

  // Helper function to display execution ID with copy functionality
  const displayExecutionId = (executionId: string | undefined | null) => {
    if (!executionId || executionId === 'N/A') {
      return <span className="text-muted-foreground">-</span>
    }

    const handleCopy = async () => {
      try {
        await navigator.clipboard.writeText(executionId)
        setCopiedId(executionId)
        setTimeout(() => {
          if (setCopiedId) {
            setCopiedId(null)
          }
        }, 2000)
      } catch (err) {
        console.error('Failed to copy:', err)
      }
    }

    const isCopied = copiedId === executionId

    return (
      <TooltipProvider delayDuration={0}>
        <Tooltip>
          <TooltipTrigger asChild>
            <div 
              className="flex items-center gap-2 cursor-pointer group"
              onClick={handleCopy}
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
          
          {error && (
            <div className="text-red-500 text-center py-4">
              Error: {error}
            </div>
          )}

          {!loading && !error && logs.length === 0 && (
            <p className="text-center py-4 text-muted-foreground">
              No logs found for this workflow
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
                      <TableCell>
                        {formatDate(log.created_at)}
                      </TableCell>
                      <TableCell>
                        {log.duration === 'NA' ? '-' : log.duration}
                      </TableCell>
                      <TableCell>
                        <Badge 
                          variant={log.success ? "default" : "destructive"}
                          className={`
                            cursor-pointer
                            ${log.success 
                              ? "bg-green-500/10 text-green-500 hover:bg-green-500/20" 
                              : "bg-red-500/10 text-red-500 hover:bg-red-500/20"
                            }
                          `}
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

      {/* Error Message Dialog */}
      {selectedError && (
        <ErrorMessageDialog
          isOpen={!!selectedError}
          onClose={() => setSelectedError(null)}
          title={selectedError.title}
          message={selectedError.message}
        />
      )}
    </>
  )
} 