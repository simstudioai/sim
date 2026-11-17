import { execFileSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import type { ExpandedBlockCatalog } from '@sim/workflow-code'
import {
  generateSdkTypes,
  generateWorkspaceTypes,
  type SdkTypeFile,
  SOURCE_COMPILER_OPTIONS,
} from '../src/codegen'
import { FIXTURE_WORKSPACE } from './fixtures/workspace'

const testRoot = import.meta.dirname
const packageRoot = path.resolve(testRoot, '..')

/** The fixture catalog, written in expanded form (a valid core shard). */
export function loadFixtureCatalog(): ExpandedBlockCatalog {
  return JSON.parse(readFileSync(path.join(testRoot, 'fixtures', 'catalog.json'), 'utf8'))
}

/** The workflow files the type-check project checks by default. */
const DEFAULT_SOURCES = ['examples', 'negative']

/**
 * Writes the types generated from the fixture catalog and workspace into `outDir`, plus a
 * `tsconfig.json` that checks the workflow files under `sources` (directories of `test/`; by
 * default the example workflows and the negative fixtures) against them, with `skipLibCheck` off
 * so the generated `.d.ts` are checked too.
 */
export function writeTypecheckProject(
  outDir: string,
  sources: readonly string[] = DEFAULT_SOURCES
): { tsconfig: string; files: SdkTypeFile[] } {
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
          ...SOURCE_COMPILER_OPTIONS,
          skipLibCheck: false,
          paths: { '@sim/workflow-sdk': [path.join(packageRoot, 'src', 'core.d.ts')] },
        },
        include: [
          path.join(outDir, 'types', '**', '*.d.ts'),
          ...sources.map((source) => path.join(testRoot, source, '**', '*.ts')),
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
