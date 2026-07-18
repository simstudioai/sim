import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { assertImportAllowed, classifyResolvedImport } from '@/lib/apps/build/import-containment'
import { CURATED_BARE_IMPORTS } from '@/lib/apps/build/prepare-source-allowlist'

const projectRoot = '/tmp/sim-app-build-abc'
const reactDir = '/repo/node_modules/react'
const allowedRoots = [projectRoot, join(projectRoot, 'vendor/app-sdk'), reactDir]

describe('import containment', () => {
  it('rejects relative escapes including ?raw host files', () => {
    const importer = join(projectRoot, 'src/App.tsx')
    const result = assertImportAllowed({
      id: '../../../../apps/sim/.env?raw',
      importer,
      projectRoot,
      allowedRoots,
      allowedBare: CURATED_BARE_IMPORTS,
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(result.reason).toMatch(/escapes build sandbox/)
    }
  })

  it('rejects imports into the work-root node_modules symlink', () => {
    const result = assertImportAllowed({
      id: '../node_modules/lodash/index.js',
      importer: join(projectRoot, 'src/App.tsx'),
      projectRoot,
      allowedRoots,
      allowedBare: CURATED_BARE_IMPORTS,
    })
    expect(result.ok).toBe(false)
  })

  it('rejects absolute paths outside allowed roots', () => {
    const result = assertImportAllowed({
      id: '/etc/passwd',
      importer: join(projectRoot, 'src/App.tsx'),
      projectRoot,
      allowedRoots,
      allowedBare: CURATED_BARE_IMPORTS,
    })
    expect(result.ok).toBe(false)
  })

  it('allows relative imports inside the project root', () => {
    const result = assertImportAllowed({
      id: './sim.generated',
      importer: join(projectRoot, 'src/App.tsx'),
      projectRoot,
      allowedRoots,
      allowedBare: CURATED_BARE_IMPORTS,
    })
    expect(result.ok).toBe(true)
  })

  it('allows curated bare imports and rejects others', () => {
    expect(
      assertImportAllowed({
        id: 'react',
        importer: join(projectRoot, 'src/App.tsx'),
        projectRoot,
        allowedRoots,
        allowedBare: CURATED_BARE_IMPORTS,
      }).ok
    ).toBe(true)
    expect(
      assertImportAllowed({
        id: 'lodash',
        importer: join(projectRoot, 'src/App.tsx'),
        projectRoot,
        allowedRoots,
        allowedBare: CURATED_BARE_IMPORTS,
      }).ok
    ).toBe(false)
  })

  it('classifies bare vs path imports', () => {
    expect(
      classifyResolvedImport({
        id: 'react-dom/client',
        importer: undefined,
        projectRoot,
        allowedRoots,
      }).kind
    ).toBe('bare')
  })

  it('rejects disallowed bare packages when hooks see them', () => {
    expect(
      assertImportAllowed({
        id: 'lodash',
        importer: join(projectRoot, 'src/App.tsx'),
        projectRoot,
        allowedRoots,
        allowedBare: CURATED_BARE_IMPORTS,
      }).ok
    ).toBe(false)
    expect(
      assertImportAllowed({
        id: 'scheduler',
        importer: join(projectRoot, 'src/App.tsx'),
        projectRoot,
        allowedRoots,
        allowedBare: CURATED_BARE_IMPORTS,
      }).ok
    ).toBe(true)
  })
})
