'use client'

import { useRef } from 'react'
import { useServerInsertedHTML } from 'next/navigation'
import { WORKSPACE_LAYOUT_DIMENSIONS_SCRIPT } from '@/app/_shell/workspace-layout-dimensions-script'

/**
 * Injects the workspace layout bootstrap script during SSR, outside the React
 * hydration tree, so React 19 does not warn about `<script>` in components.
 */
export function WorkspaceLayoutDimensionsScriptLoader() {
  const inserted = useRef(false)

  useServerInsertedHTML(() => {
    if (inserted.current) return null
    inserted.current = true

    return (
      <script
        id='workspace-layout-dimensions'
        dangerouslySetInnerHTML={{ __html: WORKSPACE_LAYOUT_DIMENSIONS_SCRIPT }}
      />
    )
  })

  return null
}
