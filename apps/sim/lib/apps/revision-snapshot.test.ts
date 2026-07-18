/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { filterAllowedUserFiles } from '@/lib/apps/revision-snapshot'

describe('filterAllowedUserFiles', () => {
  it('keeps only user-editable src/** and public/** paths', () => {
    expect(
      filterAllowedUserFiles({
        'src/App.tsx': 'export function App() { return null }',
        'public/icon.svg': '<svg />',
        'package.json': '{}',
        'src/sim.generated.ts': 'export {}',
      })
    ).toEqual({
      'src/App.tsx': 'export function App() { return null }',
      'public/icon.svg': '<svg />',
    })
  })
})

