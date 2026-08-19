import {
  SIM_ARTIFACT_SHELL,
  SIM_ARTIFACT_STYLESHEET,
} from '@/lib/workspace-files/artifact-stylesheet'
import { compileSimPage } from '@/lib/workspace-files/page-compile'

/**
 * Renders page source as a fully self-contained styled document for the
 * surfaces that serve bytes without the app around them — `/api/files/serve`
 * (standalone viewer), public share links, and downloads. The preview panel
 * injects the same stylesheet/shell itself (plus the live token bridge), so
 * every surface shows the identical docs-styled page; this bakes them in so
 * the document also stands alone in a plain browser tab.
 */
export function renderSimPageDocument(source: string, options?: { workspaceId?: string }): string {
  const compiled = compileSimPage(source, options)
  return compiled.replace(
    '</head>',
    `<style>${SIM_ARTIFACT_STYLESHEET}</style>${SIM_ARTIFACT_SHELL}</head>`
  )
}
