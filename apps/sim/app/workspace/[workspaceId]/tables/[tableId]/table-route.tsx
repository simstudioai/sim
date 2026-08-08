'use client'

import { useCallback, useMemo } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { TableView } from '@/components/resources/table-view'
import { useUserPermissionsContext } from '@/app/workspace/[workspaceId]/providers/workspace-permissions-provider'
import { usePermissionConfig } from '@/hooks/use-permission-config'
import { grantsFromPermissions, workspaceSource } from '@/resources'

interface TableRouteProps {
  /** `table-locks` — resolved server-side; AppConfig has no client counterpart. */
  tableLocksEnabled: boolean
  /** `table-views` — same. */
  viewsEnabled: boolean
}

/**
 * The table page's client shell: it resolves the axes the route can supply and
 * mounts the view.
 *
 * Exists because `page.tsx` is a Server Component and `grants` comes from a React
 * context. Reading `useParams()` here is legitimate where it was not inside the
 * table itself — a route shell exists exactly once per page by definition,
 * whereas the table is also mounted in a panel beside it.
 *
 * Mirrors `files/[fileId]/view/fullscreen-file-view.tsx`.
 */
export function TableRoute({ tableLocksEnabled, viewsEnabled }: TableRouteProps) {
  const params = useParams()
  const workspaceId = typeof params?.workspaceId === 'string' ? params.workspaceId : ''
  const tableId = typeof params?.tableId === 'string' ? params.tableId : ''
  const permissions = useUserPermissionsContext()
  const router = useRouter()
  const { config: permissionConfig } = usePermissionConfig()

  const source = useMemo(
    () => workspaceSource({ kind: 'table' as const, workspaceId, resourceId: tableId }),
    [workspaceId, tableId]
  )
  const grants = useMemo(() => grantsFromPermissions(permissions), [permissions])
  const navigate = useCallback((path: string) => router.push(path), [router])

  return (
    <TableView
      host='page'
      grants={grants}
      onNavigate={navigate}
      showExecutionInternals={!permissionConfig.hideTraceSpans}
      source={source}
      features={{ locks: tableLocksEnabled, views: viewsEnabled }}
    />
  )
}
