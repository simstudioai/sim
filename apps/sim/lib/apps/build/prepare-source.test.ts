import { describe, expect, it } from 'vitest'
import { isAllowedUserPath, prepareTrustedSourceTree } from '@/lib/apps/build/prepare-source'

const action = {
  actionId: 'main',
  workflowId: 'wf',
  deploymentVersionId: 'dv',
  inputSchema: { type: 'object' as const, properties: {}, additionalProperties: false },
  outputAllowlist: [] as [],
  executionPolicy: 'sync' as const,
  schemaHash: 'x',
}

describe('prepareTrustedSourceTree', () => {
  it('exposes the same user path allowlist used by agent file writes', () => {
    expect(isAllowedUserPath('src/App.tsx')).toBe(true)
    expect(isAllowedUserPath('public/logo.svg')).toBe(true)
    expect(isAllowedUserPath('vite.config.ts')).toBe(false)
    expect(isAllowedUserPath('package.json')).toBe(false)
    expect(isAllowedUserPath('../secret.ts')).toBe(false)
  })

  it('rejects unsupported revision paths instead of silently skipping', () => {
    const result = prepareTrustedSourceTree({
      revisionFiles: {
        'README.md': '# nope',
        'src/App.tsx': 'export function App() { return null }',
      },
      actions: [action],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.error).toMatch(/Unsupported revision path/)
    }
  })

  it('allows platform-owned paths to be overwritten by the platform', () => {
    const result = prepareTrustedSourceTree({
      revisionFiles: {
        'package.json': '{"name":"evil"}',
        'src/App.tsx': 'export function App() { return null }',
      },
      actions: [action],
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.files['package.json']).not.toContain('evil')
    }
  })
})
