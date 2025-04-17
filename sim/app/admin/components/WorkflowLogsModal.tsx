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
import { format } from 'date-fns'

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

  return (
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
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Execution ID</TableHead>
                <TableHead>Trigger</TableHead>
                <TableHead>Created At</TableHead>
                <TableHead>Duration</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {logs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="font-mono">{log.execution_id}</TableCell>
                  <TableCell>{log.trigger}</TableCell>
                  <TableCell>
                    {format(new Date(log.created_at), 'MMM d, yyyy HH:mm:ss')}
                  </TableCell>
                  <TableCell>
                    {log.duration === 'NA' ? '-' : log.duration}
                  </TableCell>
                  <TableCell>
                    <Badge 
                      variant={log.success ? "default" : "destructive"}
                      className={log.success ? "bg-green-500/10 text-green-500 hover:bg-green-500/20" : ""}
                    >
                      {log.success ? 'Success' : 'Failed'}
                    </Badge>
                    {!log.success && log.level === 'error' && (
                      <span className="block text-sm text-red-500 mt-1">
                        {log.message}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </DialogContent>
    </Dialog>
  )
} 