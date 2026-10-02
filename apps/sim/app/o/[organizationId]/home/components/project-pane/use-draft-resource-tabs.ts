import { useEffect, useState } from 'react'
import type { MothershipResource } from '@/lib/mothership/resources/types'

const RESTORABLE_TYPES = new Set([
  'workflow',
  'table',
  'knowledgebase',
  'file',
  'filefolder',
  'log',
])

/** Store addresses only: previews, source content and desktop sessions have separate lifecycles. */
function describeResource(resource: MothershipResource): MothershipResource | null {
  if (!RESTORABLE_TYPES.has(resource.type) || !resource.workspaceId) return null
  return {
    type: resource.type,
    id: resource.id,
    title: resource.title,
    workspaceId: resource.workspaceId,
    path: resource.path,
    viewId: resource.viewId,
    executionId: resource.executionId,
  }
}

function isResourceDescriptor(value: unknown): value is MothershipResource {
  if (!value || typeof value !== 'object') return false
  const entry = value as Record<string, unknown>
  return (
    typeof entry.type === 'string' &&
    RESTORABLE_TYPES.has(entry.type) &&
    typeof entry.id === 'string' &&
    entry.id.length > 0 &&
    typeof entry.title === 'string' &&
    typeof entry.workspaceId === 'string' &&
    entry.workspaceId.length > 0 &&
    ['path', 'viewId', 'executionId'].every(
      (key) => entry[key] === undefined || typeof entry[key] === 'string'
    )
  )
}

interface UseDraftResourceTabsProps {
  storageKey: string
  enabled: boolean
  hasChat: boolean
  resources: MothershipResource[]
  addResource: (resource: MothershipResource) => boolean
}

/** Restore the current browser session's pre-chat tabs; saved chats own their own resources. */
export function useDraftResourceTabs({
  storageKey,
  enabled,
  hasChat,
  resources,
  addResource,
}: UseDraftResourceTabsProps) {
  const [restored, setRestored] = useState(false)
  useEffect(() => {
    if (!enabled || hasChat || restored) return
    try {
      const raw = sessionStorage.getItem(storageKey)
      const parsed: unknown = raw ? JSON.parse(raw) : []
      if (Array.isArray(parsed)) {
        for (const entry of parsed.slice(0, 100)) {
          if (isResourceDescriptor(entry)) {
            const descriptor = describeResource(entry)
            if (descriptor) addResource(descriptor)
          }
        }
      }
    } catch {
      /** Unavailable or malformed browser storage must not prevent opening Home. */
    }
    setRestored(true)
  }, [storageKey, enabled, hasChat, restored, addResource])

  useEffect(() => {
    if (!enabled || !restored) return
    try {
      if (hasChat) sessionStorage.removeItem(storageKey)
      else
        sessionStorage.setItem(
          storageKey,
          JSON.stringify(resources.map(describeResource).filter(Boolean))
        )
    } catch {
      /** Storage quota and private-browser restrictions leave tabs in memory. */
    }
  }, [storageKey, enabled, hasChat, resources, restored])
}
