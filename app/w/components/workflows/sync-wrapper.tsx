import { ReactNode } from 'react'
import {
  useDebouncedWorkflowSync,
  usePeriodicWorkflowSync,
  useSyncOnUnload,
} from '@/stores/workflow/sync/hooks'

interface WorkflowSyncWrapperProps {
  children: ReactNode
}

export function WorkflowSyncWrapper({ children }: WorkflowSyncWrapperProps) {
  useDebouncedWorkflowSync()
  usePeriodicWorkflowSync()
  useSyncOnUnload()

  return <>{children}</>
}
