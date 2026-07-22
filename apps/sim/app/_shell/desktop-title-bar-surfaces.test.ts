/**
 * @vitest-environment node
 */
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const auditedSurfaces = {
  'desktop-title-bar-page': [
    'app/(auth)/components/auth-shell.tsx',
    'app/(interfaces)/resume/[workflowId]/[executionId]/loading.tsx',
    'app/(landing)/components/logo-shell/logo-shell.tsx',
    'app/desktop/auth/page.tsx',
    'app/desktop/connect/complete/page.tsx',
    'app/desktop/connect/connect-launcher.tsx',
    'app/desktop/connect/page.tsx',
    'app/f/[token]/public-file-view.tsx',
    'app/playground/page.tsx',
    'app/workspace/[workspaceId]/components/workspace-access-denied.tsx',
  ],
  'desktop-title-bar-page-height': [
    'app/(landing)/components/landing-shell/landing-shell.tsx',
    'app/workspace/page.tsx',
    'components/settings/settings-unavailable.tsx',
    'components/settings/standalone-settings-shell.tsx',
  ],
  'desktop-title-bar-fixed-page': [
    'app/(interfaces)/chat/[identifier]/chat.tsx',
    'app/(interfaces)/chat/[identifier]/loading.tsx',
    'app/(interfaces)/chat/components/loading-state/loading-state.tsx',
    'app/(interfaces)/chat/components/voice-interface/voice-interface.tsx',
    'app/workspace/[workspaceId]/components/impersonation-banner/impersonation-expired.tsx',
    'app/workspace/[workspaceId]/files/[fileId]/view/file-viewer.tsx',
  ],
} as const

describe('desktop title-bar surface audit', () => {
  for (const [safeAreaClass, files] of Object.entries(auditedSurfaces)) {
    for (const file of files) {
      it(`${file} uses ${safeAreaClass}`, () => {
        expect(readFileSync(resolve(process.cwd(), file), 'utf8')).toContain(safeAreaClass)
      })
    }
  }
})
