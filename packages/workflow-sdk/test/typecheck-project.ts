import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { ExpandedBlockCatalog } from '@sim/workflow-code'
import {
  generateSdkTypes,
  generateWorkspaceTypes,
  type SdkTypeFile,
  SOURCE_COMPILER_OPTIONS,
} from '../src/codegen'
import { CORE_DTS } from '../src/codegen/core-text.generated'
import { WORKSPACE_SDK_DTS } from '../src/codegen/workspace-text.generated'
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
          paths: {
            '@sim/workflow-sdk': [path.join(packageRoot, 'src', 'core.d.ts')],
            '@sim/workflow-sdk/workspace': [
              path.join(packageRoot, 'src', 'workspace', 'index.d.ts'),
            ],
          },
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

/**
 * Lays out a source directory as the CLI writes it (`.sim/sdk/core.d.ts` and the workspace SDK
 * under `.sim/sdk/workspace/`), adds `files` (directory-relative path → text), and type-checks
 * the `include` globs beside the SDK. Returns the compiler's diagnostics, `''` when clean.
 */
export function typecheckSdkDirectory(
  files: Readonly<Record<string, string>>,
  include: readonly string[]
): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sim-sdk-directory-'))
  try {
    const write = (file: string, text: string) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      writeFileSync(path.join(dir, file), text)
    }
    write('.sim/sdk/core.d.ts', CORE_DTS)
    for (const [name, text] of Object.entries(WORKSPACE_SDK_DTS)) {
      write(`.sim/sdk/workspace/${name}`, text)
    }
    for (const [file, text] of Object.entries(files)) write(file, text)
    write(
      'tsconfig.json',
      JSON.stringify({
        compilerOptions: {
          ...SOURCE_COMPILER_OPTIONS,
          skipLibCheck: false,
          paths: {
            '@sim/workflow-sdk': ['./.sim/sdk/core.d.ts'],
            '@sim/workflow-sdk/workspace': ['./.sim/sdk/workspace/index.d.ts'],
          },
        },
        include: [...include, '.sim/sdk/**/*.d.ts'],
      })
    )
    return typecheck(path.join(dir, 'tsconfig.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}
