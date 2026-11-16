import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ExpandedBlockCatalog } from '@sim/workflow-code'
import { generateSdkTypes, generateWorkspaceTypes, type SdkTypeFile } from '../src/codegen'
import { FIXTURE_WORKSPACE } from './fixtures/workspace'

const testRoot = import.meta.dirname
const packageRoot = path.resolve(testRoot, '..')

/** The fixture catalog, written in expanded form (a valid core shard). */
export function loadFixtureCatalog(): ExpandedBlockCatalog {
  return JSON.parse(readFileSync(path.join(testRoot, 'fixtures', 'catalog.json'), 'utf8'))
}

/**
 * Writes the types generated from the fixture catalog and workspace into `outDir`, plus a
 * `tsconfig.json` that checks the s2 example workflows (`test/examples`) and the negative
 * fixtures (`test/negative`) against them, with `skipLibCheck` off so the generated `.d.ts` are
 * checked too.
 */
export function writeTypecheckProject(outDir: string): { tsconfig: string; files: SdkTypeFile[] } {
  const files = [
    ...generateSdkTypes(loadFixtureCatalog()),
    generateWorkspaceTypes(FIXTURE_WORKSPACE),
  ]
  for (const file of files) {
    const target = path.join(outDir, 'types', file.path)
    mkdirSync(path.dirname(target), { recursive: true })
    writeFileSync(target, file.text)
  }
  const tsconfig = path.join(outDir, 'tsconfig.json')
  writeFileSync(
    tsconfig,
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['ES2022'],
          module: 'ESNext',
          moduleResolution: 'bundler',
          moduleDetection: 'force',
          types: [],
          strict: true,
          noEmit: true,
          skipLibCheck: false,
          paths: { '@sim/workflow-sdk': [path.join(packageRoot, 'src', 'core.d.ts')] },
        },
        include: [
          path.join(outDir, 'types', '**', '*.d.ts'),
          path.join(testRoot, 'examples', '**', '*.ts'),
          path.join(testRoot, 'negative', '**', '*.ts'),
        ],
      },
      null,
      2
    )
  )
  return { tsconfig, files }
}

/** Runs the workspace's TypeScript 7 compiler; returns its diagnostics, `''` when clean. */
export function typecheck(tsconfig: string): string {
  const tsc = path.resolve(packageRoot, '../../node_modules/.bin/tsc')
  try {
    execFileSync(tsc, ['--noEmit', '-p', tsconfig], { encoding: 'utf8', stdio: 'pipe' })
    return ''
  } catch (error) {
    const failure = error as { stdout?: string; stderr?: string }
    return `${failure.stdout ?? ''}${failure.stderr ?? ''}`
  }
}
