'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { formatDistanceToNow } from 'date-fns'
import { Bell, History, Play, Rocket, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { cn } from '@/lib/utils'
import { useNotificationStore } from '@/stores/notifications/store'
import { performSync } from '@/stores/sync-manager'
import { useWorkflowRegistry } from '@/stores/workflow/registry/store'
import { useWorkflowStore } from '@/stores/workflow/store'
import { useWorkflowExecution } from '../../hooks/use-workflow-execution'
import { HistoryDropdownItem } from './components/history-dropdown-item'
import { NotificationDropdownItem } from './components/notification-dropdown-item'

export function ControlBar() {
  const { notifications, getWorkflowNotifications, addNotification } = useNotificationStore()
  const { history, undo, redo, revertToHistoryState, lastSaved } = useWorkflowStore()
  const [isEditing, setIsEditing] = useState(false)
  const [editedName, setEditedName] = useState('')
  const [historyOpen, setHistoryOpen] = useState(false)
  const [notificationsOpen, setNotificationsOpen] = useState(false)
  const { workflows, updateWorkflow, activeWorkflowId, removeWorkflow } = useWorkflowRegistry()
  const [, forceUpdate] = useState({})
  const { isExecuting, handleRunWorkflow } = useWorkflowExecution()
  const router = useRouter()

  // Use client-side only rendering for the timestamp
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])

  // Get notifications for current workflow
  const workflowNotifications = activeWorkflowId
    ? getWorkflowNotifications(activeWorkflowId)
    : notifications // Show all if no workflow is active

  const handleDeleteWorkflow = () => {
    if (!activeWorkflowId) return

    // Remove the workflow from the registry
    const newWorkflows = { ...workflows }
    delete newWorkflows[activeWorkflowId]

    // Get remaining workflow IDs
    const remainingIds = Object.keys(newWorkflows)

    // Navigate before removing the workflow to avoid any state inconsistencies
    if (remainingIds.length > 0) {
      router.push(`/w/${remainingIds[0]}`)
    } else {
      router.push('/')
    }

    // Remove the workflow from the registry
    removeWorkflow(activeWorkflowId)
  }

  // Update the time display every minute
  useEffect(() => {
    const interval = setInterval(() => forceUpdate({}), 60000)
    return () => clearInterval(interval)
  }, [])

  const handleNameClick = () => {
    if (activeWorkflowId) {
      setEditedName(workflows[activeWorkflowId].name)
      setIsEditing(true)
    }
  }

  const handleNameSubmit = () => {
    if (activeWorkflowId) {
      const trimmedName = editedName.trim()
      if (trimmedName && trimmedName !== workflows[activeWorkflowId].name) {
        updateWorkflow(activeWorkflowId, { name: trimmedName })
      }
      setIsEditing(false)
    }
  }

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleNameSubmit()
    } else if (e.key === 'Escape') {
      setIsEditing(false)
    }
  }

  // Add the deployment state and handlers
  const [isDeploying, setIsDeploying] = useState(false)
  const [isDeployed, setIsDeployed] = useState(false)

  // Check deployment status on mount
  useEffect(() => {
    async function checkStatus() {
      if (!activeWorkflowId) return
      try {
        const response = await fetch(`/api/workflow/${activeWorkflowId}/status`)
        if (response.ok) {
          const data = await response.json()
          setIsDeployed(data.isDeployed)
        }
      } catch (error) {
        console.error('Failed to check deployment status:', error)
      }
    }
    checkStatus()
  }, [activeWorkflowId])

  // Deploy the workflow
  const handleDeploy = async () => {
    if (!activeWorkflowId) return
    try {
      setIsDeploying(true)

      await performSync()

      const response = await fetch(`/api/workflow/${activeWorkflowId}/deploy`, {
        method: 'POST',
      })

      if (!response.ok) throw new Error('Failed to deploy workflow')

      const { apiKey } = await response.json()
      const endpoint = `${process.env.NEXT_PUBLIC_APP_URL}/api/workflow/${activeWorkflowId}/execute`

      addNotification('api', 'Workflow successfully deployed', activeWorkflowId, {
        isPersistent: true,
        sections: [
          {
            label: 'API Endpoint',
            content: endpoint,
          },
          {
            label: 'API Key',
            content: apiKey,
          },
          {
            label: 'Example curl command',
            content: `curl -X POST -H "X-API-Key: ${apiKey}" -H "Content-Type: application/json" ${endpoint}`,
          },
        ],
      })

      setIsDeployed(true)
    } catch (error) {
      addNotification('error', 'Failed to deploy workflow. Please try again.', activeWorkflowId)
    } finally {
      setIsDeploying(false)
    }
  }

  return (
    <div className="flex h-16 w-full items-center justify-between bg-background px-6 border-b transition-all duration-300">
      {/* Left Section - Workflow Info */}
      <div className="flex flex-col gap-[2px]">
        {isEditing ? (
          <input
            type="text"
            value={editedName}
            onChange={(e) => setEditedName(e.target.value)}
            onBlur={handleNameSubmit}
            onKeyDown={handleNameKeyDown}
            autoFocus
            className="font-semibold text-sm bg-transparent border-none outline-none p-0 w-[200px]"
          />
        ) : (
          <h2
            className="font-semibold text-sm hover:text-muted-foreground w-fit"
            onClick={handleNameClick}
          >
            {activeWorkflowId ? workflows[activeWorkflowId].name : 'Workflow'}
          </h2>
        )}
        {mounted && (
          <p className="text-xs text-muted-foreground">
            Saved{' '}
            {formatDistanceToNow(lastSaved || Date.now(), {
              addSuffix: true,
            })}
          </p>
        )}
      </div>

      {/* Middle Section - Reserved for future use */}
      <div className="flex-1" />

      {/* Right Section - Actions */}
      <div className="flex items-center gap-3">
        <AlertDialog>
          <Tooltip>
            <TooltipTrigger asChild>
              <AlertDialogTrigger asChild>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={Object.keys(workflows).length <= 1}
                  className="hover:text-red-600"
                >
                  <Trash2 className="h-5 w-5" />
                  <span className="sr-only">Delete Workflow</span>
                </Button>
              </AlertDialogTrigger>
            </TooltipTrigger>
            <TooltipContent>Delete Workflow</TooltipContent>
          </Tooltip>

          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Delete Workflow</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to delete this workflow? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={handleDeleteWorkflow}
                className="bg-red-600 hover:bg-red-700"
              >
                Delete
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>

        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              onClick={handleDeploy}
              disabled={isDeploying}
              className={cn(
                'hover:text-foreground',
                isDeployed && 'text-green-500 hover:text-green-500'
              )}
            >
              <Rocket className={`h-5 w-5 ${isDeploying ? 'animate-pulse' : ''}`} />
              <span className="sr-only">Deploy API</span>
            </Button>
          </TooltipTrigger>
          <TooltipContent>
            {isDeploying ? 'Deploying...' : isDeployed ? 'Deployed' : 'Deploy as API Endpoint'}
          </TooltipContent>
        </Tooltip>

        <DropdownMenu open={historyOpen} onOpenChange={setHistoryOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <History />
                  <span className="sr-only">Version History</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {!historyOpen && <TooltipContent>History</TooltipContent>}
          </Tooltip>

          {history.past.length === 0 && history.future.length === 0 ? (
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem className="text-sm text-muted-foreground">
                No history available
              </DropdownMenuItem>
            </DropdownMenuContent>
          ) : (
            <DropdownMenuContent align="end" className="w-60 max-h-[300px] overflow-y-auto">
              <>
                {[...history.future].reverse().map((entry, index) => (
                  <HistoryDropdownItem
                    key={`future-${entry.timestamp}-${index}`}
                    action={entry.action}
                    timestamp={entry.timestamp}
                    onClick={() =>
                      revertToHistoryState(
                        history.past.length + 1 + (history.future.length - 1 - index)
                      )
                    }
                    isFuture={true}
                  />
                ))}
                <HistoryDropdownItem
                  key={`current-${history.present.timestamp}`}
                  action={history.present.action}
                  timestamp={history.present.timestamp}
                  isCurrent={true}
                  onClick={() => {}}
                />
                {[...history.past].reverse().map((entry, index) => (
                  <HistoryDropdownItem
                    key={`past-${entry.timestamp}-${index}`}
                    action={entry.action}
                    timestamp={entry.timestamp}
                    onClick={() => revertToHistoryState(history.past.length - 1 - index)}
                  />
                ))}
              </>
            </DropdownMenuContent>
          )}
        </DropdownMenu>

        <DropdownMenu open={notificationsOpen} onOpenChange={setNotificationsOpen}>
          <Tooltip>
            <TooltipTrigger asChild>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon">
                  <Bell />
                  <span className="sr-only">Notifications</span>
                </Button>
              </DropdownMenuTrigger>
            </TooltipTrigger>
            {!notificationsOpen && <TooltipContent>Notifications</TooltipContent>}
          </Tooltip>

          {workflowNotifications.length === 0 ? (
            <DropdownMenuContent align="end" className="w-40">
              <DropdownMenuItem className="text-sm text-muted-foreground">
                No new notifications
              </DropdownMenuItem>
            </DropdownMenuContent>
          ) : (
            <DropdownMenuContent align="end" className="w-60 max-h-[300px] overflow-y-auto">
              {[...workflowNotifications]
                .sort((a, b) => b.timestamp - a.timestamp)
                .map((notification) => (
                  <NotificationDropdownItem
                    key={notification.id}
                    id={notification.id}
                    type={notification.type}
                    message={notification.message}
                    timestamp={notification.timestamp}
                    options={notification.options}
                  />
                ))}
            </DropdownMenuContent>
          )}
        </DropdownMenu>

        <Button
          className="gap-2 bg-[#7F2FFF] hover:bg-[#7F2FFF]/90 text-white"
          onClick={handleRunWorkflow}
          disabled={isExecuting}
        >
          <Play fill="white" stroke="white" className="!h-3.5 !w-3.5" />
          {isExecuting ? 'Running...' : 'Run'}
        </Button>
      </div>
    </div>
  )
}
