/**
 * Every printer golden of `@sim/workflow-code` (lean and verbose) type-checks against what an
 * author gets: the shipped `core.d.ts` plus the types generated from the same real-catalog slice
 * the goldens are printed with (`print/__fixtures__/real-catalog.json`, drift-checked against the
 * registry in apps/sim). A field the printer emits that `core.d.ts` or the generated builders do
 * not declare fails here, run by the workspace's TypeScript 7 compiler.
 */
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import type { BlockCatalog } from '@sim/workflow-code'
import { describe, expect, it } from 'vitest'
import { typecheck } from '../../test/typecheck-project'
import { generateSdkTypes } from './generate'

const SDK_ROOT = path.resolve(import.meta.dirname, '../..')
const PRINT_ROOT = path.resolve(SDK_ROOT, '../workflow-code/src/print')
const GOLDEN_DIR = path.join(PRINT_ROOT, '__golden__')

function loadRealCatalog(): BlockCatalog {
  return JSON.parse(
    readFileSync(path.join(PRINT_ROOT, '__fixtures__', 'real-catalog.json'), 'utf8')
  )
}

describe('printer goldens against the shipped SDK types', () => {
  it('type-check with core.d.ts and the types generated from the real catalog', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'sim-sdk-goldens-'))
    try {
      for (const file of generateSdkTypes(loadRealCatalog())) {
        const target = path.join(outDir, 'types', file.path)
        mkdirSync(path.dirname(target), { recursive: true })
        writeFileSync(target, file.text)
      }
      const goldens = readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.txt'))
      mkdirSync(path.join(outDir, 'goldens'))
      for (const name of goldens) {
        const text = readFileSync(path.join(GOLDEN_DIR, name), 'utf8')
        writeFileSync(path.join(outDir, 'goldens', name.replace(/\.txt$/, '.ts')), text)
      }
      const tsconfig = path.join(outDir, 'tsconfig.json')
      writeFileSync(
        tsconfig,
        JSON.stringify({
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
            paths: { '@sim/workflow-sdk': [path.join(SDK_ROOT, 'src', 'core.d.ts')] },
          },
          include: [
            path.join(outDir, 'types', '**', '*.d.ts'),
            path.join(outDir, 'goldens', '*.ts'),
          ],
        })
      )
      expect(goldens.length).toBeGreaterThan(30)
      expect(typecheck(tsconfig)).toBe('')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 120_000)
})
