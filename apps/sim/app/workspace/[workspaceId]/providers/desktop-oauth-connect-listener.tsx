'use client'

import { useDesktopOAuthConnectListener } from '@/hooks/use-oauth-return'

/**
 * Mounts the desktop OAuth-connect completion listener for the workspace.
 * Renders nothing; a no-op outside the desktop app (no bridge present).
 */
export function DesktopOAuthConnectListener() {
  useDesktopOAuthConnectListener()
  return null
}
