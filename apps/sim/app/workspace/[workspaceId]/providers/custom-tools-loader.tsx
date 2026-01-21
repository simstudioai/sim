'use client'

import { useEffect, useRef } from 'react'
import { useParams } from 'next/navigation'
import { syncCustomToolsToStore, useCustomTools } from '@/hooks/queries/custom-tools'

/**
 * Loads custom tools from database and syncs to Zustand store once per workspace.
 * This ensures custom tools are available for non-React code (executor handlers, utilities)
 * that access the store via getState().
 */
export function CustomToolsLoader() {
  const params = useParams()
  const workspaceId = params.workspaceId as string
  const lastSyncedDataRef = useRef<string | null>(null)

  const { data: customTools } = useCustomTools(workspaceId)

  useEffect(() => {
    if (!customTools) return

    // Only sync if data has actually changed (compare by JSON to handle array reference changes)
    const dataKey = JSON.stringify(customTools.map((t) => t.id).sort())
    if (dataKey === lastSyncedDataRef.current) return

    lastSyncedDataRef.current = dataKey
    syncCustomToolsToStore(customTools)
  }, [customTools])

  return null
}
