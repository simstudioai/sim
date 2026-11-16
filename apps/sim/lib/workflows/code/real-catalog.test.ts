/**
 * Canonicalize and the SDK codegen against the REAL block catalog the catalog builder projects
 * from the live registry, not a hand-made fixture catalog. It type-checks the SDK example
 * workflows against the types generated from the whole registry with the workspace's TypeScript 7
 * compiler.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { canonicalize, catalogBlock, catalogBuilder } from '@sim/workflow-code'
import { generateSdkTypes, SPECIAL_BUILDER_KEYS } from '@sim/workflow-sdk/codegen'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { buildBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { generateRegistryCorpus } from '@/lib/workflows/code/corpus'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'

const registryBlocks = Object.values(getBlockRegistry())
const { catalog } = buildBlockCatalog({
  blocks: registryBlocks,
  trigger: registryTrigger,
  sdkNames: SDK_NAMES,
})

const REPO_ROOT = path.resolve(process.cwd(), '../..')
const SDK_ROOT = path.join(REPO_ROOT, 'packages/workflow-sdk')
const workDir = mkdtempSync(path.join(tmpdir(), 'workflow-sdk-real-catalog-'))

afterAll(() => rmSync(workDir, { recursive: true, force: true }))

describe('canonicalize and codegen over the real block catalog', () => {
  it('canonicalizes every case of the registry corpus without throwing', () => {
    const failures: string[] = []
    const corpus = generateRegistryCorpus()
    for (const corpusCase of corpus) {
      try {
        canonicalize(corpusCase.state, {
          catalog,
          meta: { name: corpusCase.id, description: null },
        })
      } catch (error) {
        failures.push(`${corpusCase.id}: ${String(error)}`)
      }
    }
    expect(corpus.length).toBeGreaterThan(registryBlocks.length)
    expect(failures).toEqual([])
  })

  it('maps every builder core.d.ts declares to the block type its signature is written for', () => {
    expect(
      Object.fromEntries(SPECIAL_BUILDER_KEYS.map((key) => [key, catalogBuilder(catalog, key)]))
    ).toEqual({
      condition: { type: 'condition' },
      router: { type: 'router_v2' },
      fn: { type: 'function' },
      runWorkflow: { type: 'workflow_input' },
      human: { type: 'human_in_the_loop_v2' },
      response: { type: 'response' },
      setVariables: { type: 'variables' },
      note: { type: 'note' },
    })
  })

  it('projects a registry multiSelect dropdown or combobox as a multiple subBlock', () => {
    const missing: string[] = []
    let multiSelects = 0
    for (const block of registryBlocks) {
      block.subBlocks.forEach((subBlock, index) => {
        if (subBlock.multiSelect !== true) return
        multiSelects += 1
        if (catalogBlock(catalog, block.type)?.subBlocks[index]?.multiple !== true) {
          missing.push(`${block.type}.${subBlock.id}`)
        }
      })
    }
    expect(multiSelects).toBeGreaterThan(0)
    expect(missing).toEqual([])
  })

  it('generates SDK types the example workflows type-check against', () => {
    const files = generateSdkTypes(catalog)
    for (const file of files) {
      const target = path.join(workDir, 'types', file.path)
      mkdirSync(path.dirname(target), { recursive: true })
      writeFileSync(target, file.text)
    }
    const tsconfig = path.join(workDir, 'tsconfig.json')
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
          paths: { '@sim/workflow-sdk': [path.join(SDK_ROOT, 'src/core.d.ts')] },
        },
        include: [
          path.join(workDir, 'types/**/*.d.ts'),
          path.join(SDK_ROOT, 'test/examples/**/*.ts'),
        ],
      })
    )
    let diagnostics = ''
    try {
      execFileSync(path.join(REPO_ROOT, 'node_modules/.bin/tsc'), ['--noEmit', '-p', tsconfig], {
        encoding: 'utf8',
        stdio: 'pipe',
      })
    } catch (error) {
      const failure = error as { stdout?: string; stderr?: string }
      diagnostics = `${failure.stdout ?? ''}${failure.stderr ?? ''}`
    }
    expect(files.some((file) => file.path === 'blocks/slack_v2.d.ts')).toBe(true)
    expect(diagnostics).toBe('')
  }, 120_000)
})
