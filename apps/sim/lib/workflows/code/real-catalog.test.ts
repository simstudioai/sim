/**
 * Canonicalize and the SDK codegen against the REAL block catalog the catalog builder projects
 * from the live registry, not a hand-made fixture catalog. It type-checks the SDK example
 * workflows against the types generated from the whole registry with the workspace's TypeScript 7
 * compiler.
 */
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createBlock } from '@sim/testing/factories/block.factory'
import {
  canonicalize,
  catalogBlock,
  catalogBuilder,
  compileWorkflow,
  printWorkflow,
} from '@sim/workflow-code'
import {
  COOKBOOK_TS,
  generateWorkspaceTypes,
  SPECIAL_BUILDER_KEYS,
  type WorkspaceManifest,
} from '@sim/workflow-sdk/codegen'
import type { WorkflowState } from '@sim/workflow-types/workflow'
import { afterAll, describe, expect, it, vi } from 'vitest'

vi.unmock('@/blocks/registry')

import { projectBlockCatalog } from '@/lib/workflows/code/catalog/build'
import { registryCatalog as catalog } from '@/lib/workflows/code/catalog/registry-catalog.test-helpers'
import { registryTrigger } from '@/lib/workflows/code/catalog/registry-sources'
import { generateRegistryCorpus } from '@/lib/workflows/code/corpus'
import {
  SDK_ROOT,
  typeCheckAgainstSdk,
  writeSdkTypes,
} from '@/lib/workflows/code/sdk-typecheck.test-helpers'
import { getBlockRegistry } from '@/blocks/registry'
import { SDK_NAMES } from '@/blocks/sdk-names.generated'

const registryBlocks = Object.values(getBlockRegistry())

const workDir = mkdtempSync(path.join(tmpdir(), 'workflow-sdk-real-catalog-'))

afterAll(() => rmSync(workDir, { recursive: true, force: true }))

/** The resources `.sim/examples/cookbook.ts` names, as a workspace that has them lists them. */
const COOKBOOK_WORKSPACE: WorkspaceManifest = {
  tables: {
    orders: {
      columns: {
        orderId: { type: 'string' },
        status: { type: 'string' },
        risk: { type: 'string' },
      },
    },
  },
  knowledgeBases: ['policies'],
  credentials: { 'ops-slack': { provider: 'slack' } },
  env: ['ANTHROPIC_API_KEY'],
}

describe('canonicalize and codegen over the real block catalog', () => {
  it('keeps the SDK fixture catalog equal to the real projection of its blocks', () => {
    const fixturePath = path.join(SDK_ROOT, 'test/fixtures/catalog.json')
    const fixture = JSON.parse(readFileSync(fixturePath, 'utf8')) as { blocks: object }
    const types = new Set(Object.keys(fixture.blocks))
    const projected = {
      ...projectBlockCatalog({
        blocks: registryBlocks.filter((block) => types.has(block.type)),
        trigger: registryTrigger,
        sdkNames: SDK_NAMES,
      }),
      hash: 'fixture',
    }
    const text = `${JSON.stringify(projected, null, 2)}\n`
    if (process.env.UPDATE_SDK_FIXTURE_CATALOG === '1') writeFileSync(fixturePath, text)
    expect(
      JSON.parse(readFileSync(fixturePath, 'utf8')),
      'Regenerate with UPDATE_SDK_FIXTURE_CATALOG=1 bun run test lib/workflows/code/real-catalog.test.ts'
    ).toEqual(JSON.parse(text))
  })

  it("never freezes the host's timezone into the catalog as the schedule default", () => {
    const timezone = catalogBlock(catalog, 'schedule')?.subBlocks.find(
      (sub) => sub.id === 'timezone'
    )
    expect(timezone?.valueDefault).toEqual({ computed: true })
  })

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

  it("decodes an agent tool's stored params by the registry sub-block's value shape", () => {
    const shaped = registryBlocks.flatMap((block) =>
      block.subBlocks
        .filter((subBlock) => subBlock.type === 'switch' && !subBlock.mode?.startsWith('trigger'))
        .map((subBlock) => ({ type: block.type, id: subBlock.id }))
    )
    expect(shaped.length).toBeGreaterThan(0)
    const tools = shaped.map(({ type, id }) => ({ type, params: { [id]: 'true' } }))
    const result = canonicalize(
      {
        blocks: {
          a1: createBlock({
            id: 'a1',
            type: 'agent',
            name: 'Agent',
            subBlocks: { tools: { id: 'tools', type: 'tool-input', value: tools } },
          }),
        },
        edges: [],
        loops: {},
        parallels: {},
      },
      { catalog, meta: { name: 'Shapes', description: null } }
    )
    const param = result.workflow.blocks.agent.params.tools
    expect(param?.kind).toBe('tools')
    const decoded = param?.kind === 'tools' ? param.tools.map((tool) => tool.params) : []
    expect(decoded).toEqual(shaped.map(({ id }) => ({ [id]: true })))
  })

  it('generates SDK types the example workflows type-check against', () => {
    const files = sdkTypesOnce()
    const diagnostics = typeCheckAgainstSdk(workDir, 'examples', [
      path.join(SDK_ROOT, 'test/examples/**/*.ts'),
    ])
    expect(files.some((file) => file.path === 'blocks/slack_v2.d.ts')).toBe(true)
    expect(diagnostics).toBe('')
  }, 120_000)

  it("types the table blocks' rows and written cells by the workspace table's columns", () => {
    sdkTypesOnce()
    const dir = path.join(workDir, 'table-rows')
    mkdirSync(dir, { recursive: true })
    const workspaceTypes = generateWorkspaceTypes({
      tables: { tickets: { columns: { subject: { type: 'string' }, status: { type: 'string' } } } },
    })
    writeFileSync(path.join(dir, workspaceTypes.path), workspaceTypes.text)
    writeFileSync(
      path.join(dir, 'workflow.ts'),
      [
        "import { agent, loop, t, table, workflow } from '@sim/workflow-sdk'",
        "export default workflow('Rows', () => {",
        "  const open = table.queryRows('Open', { tableId: table('tickets') })",
        "  loop.forEach('Each', { collection: open.rows }, (p) => {",
        "    agent('Read', { model: 'claude-sonnet-4-6', messages: [{ role: 'user', content: t`${p.currentItem.data.subject}` }] })",
        '    // @ts-expect-error `tickets` has no column `subjct`',
        '    t`${p.currentItem.data.subjct}`',
        '  })',
        '  // @ts-expect-error `tickets` has no column `priority` to write',
        "  table.insertRow('Add', { tableId: table('tickets'), data: { priority: 'high' } })",
        '})',
      ].join('\n')
    )
    expect(typeCheckAgainstSdk(workDir, 'table-rows', [path.join(dir, '*.ts')])).toBe('')
  }, 120_000)

  it('type-checks and compiles the cookbook the CLI writes, with no error or warning', () => {
    sdkTypesOnce()
    const dir = path.join(workDir, 'cookbook')
    mkdirSync(dir, { recursive: true })
    const workspaceTypes = generateWorkspaceTypes(COOKBOOK_WORKSPACE)
    writeFileSync(path.join(dir, workspaceTypes.path), workspaceTypes.text)
    writeFileSync(path.join(dir, 'cookbook.ts'), COOKBOOK_TS)
    expect(typeCheckAgainstSdk(workDir, 'cookbook', [path.join(dir, '*.ts')])).toBe('')

    const compiled = compileWorkflow({
      entry: { path: 'workflow.ts', text: COOKBOOK_TS },
      files: new Map(),
      catalog,
      sdkMajor: catalog.sdkMajor,
      envNames: new Set(COOKBOOK_WORKSPACE.env),
    })
    expect(
      compiled.diagnostics
        .filter(
          (diagnostic) => diagnostic.severity === 'error' || diagnostic.severity === 'warning'
        )
        .map(
          (diagnostic) =>
            `${diagnostic.code} ${diagnostic.blockKey ?? ''}.${diagnostic.param ?? ''}: ${diagnostic.message}`
        )
    ).toEqual([])
  }, 120_000)

  it('prints a numeric short or long text value as source that type-checks and compiles clean', () => {
    sdkTypesOnce()
    const printsDir = path.join(workDir, 'numeric')
    mkdirSync(printsDir, { recursive: true })
    const cases = generateRegistryCorpus().filter((corpusCase) =>
      /^operation:[^:]+:[^:]+:basic$/.test(corpusCase.id)
    )
    const valueKindFindings: string[] = []
    const printed = cases.map((corpusCase, index) => {
      const numeric = withNumericTextValues(corpusCase.state)
      const write = (state: WorkflowState, variant: string) => {
        const workflow = canonicalize(state, {
          catalog,
          meta: { name: corpusCase.id, description: null },
        }).workflow
        const [entry] = printWorkflow({
          workflow,
          catalog,
          options: { functionCode: 'inline' },
        }).files
        writeFileSync(path.join(printsDir, `${variant}-${index}.ts`), entry.text)
        return { workflow, entry }
      }
      write(corpusCase.state, 'text')
      const { workflow, entry } = write(numeric.state, 'number')
      const compiled = compileWorkflow({
        entry,
        files: new Map(),
        catalog,
        sdkMajor: catalog.sdkMajor,
        knownKeys: new Set(Object.keys(workflow.blocks)),
        stored: workflow,
      })
      for (const diagnostic of compiled.diagnostics) {
        if (diagnostic.code === 'W_VALUE_KIND' && numeric.params.has(diagnostic.param ?? '')) {
          valueKindFindings.push(`${corpusCase.id}: ${diagnostic.message}`)
        }
      }
      return numeric.params.size
    })
    expect(printed.reduce((total, count) => total + count, 0)).toBeGreaterThan(100)

    const diagnostics = typeCheckAgainstSdk(workDir, 'numeric', [path.join(printsDir, '*.ts')])
    /**
     * TS error codes by file, with a sample message. The number print can only lose errors (a
     * replaced reference no longer misses a path, a multi-line template collapses), so a code
     * that occurs more often in it than in the text print is an error the numbers introduced.
     */
    const codesByFile = new Map<string, Map<string, { count: number; message: string }>>()
    const located = /(\w+-\d+)\.ts\(\d+,\d+\): error (TS\d+): (.*)/g
    for (const [, file, code, message] of diagnostics.matchAll(located)) {
      const codes = codesByFile.get(file) ?? new Map<string, { count: number; message: string }>()
      const entry = codes.get(code) ?? { count: 0, message }
      codes.set(code, { count: entry.count + 1, message: entry.message })
      codesByFile.set(file, codes)
    }
    const introduced = cases.flatMap((corpusCase, index) => {
      const before = codesByFile.get(`text-${index}`)
      return [...(codesByFile.get(`number-${index}`) ?? [])]
        .filter(([code, { count }]) => count > (before?.get(code)?.count ?? 0))
        .map(([code, { message }]) => `${corpusCase.id}: ${code} ${message}`)
    })
    expect(introduced).toEqual([])
    expect(valueKindFindings).toEqual([])
  }, 300_000)
})

/**
 * Every visible short or long text value of `state` replaced by a number, as a canvas or API write
 * can store. Hidden fields are left out: they print as params no builder declares (a separate gap).
 */
function withNumericTextValues(state: WorkflowState): {
  state: WorkflowState
  params: Set<string>
} {
  const next = structuredClone(state)
  const params = new Set<string>()
  for (const block of Object.values(next.blocks)) {
    for (const [id, subBlock] of Object.entries(block.subBlocks ?? {})) {
      if (subBlock.type !== 'short-input' && subBlock.type !== 'long-input') continue
      if (typeof subBlock.value !== 'string' || subBlock.value === '') continue
      const declared = catalogBlock(catalog, block.type)?.subBlocks.find((sub) => sub.id === id)
      if (!declared || declared.hidden) continue
      subBlock.value = 42
      params.add(id)
    }
  }
  return { state: next, params }
}

let sdkTypes: ReturnType<typeof writeSdkTypes> | undefined

/** Writes the declarations generated from the real catalog under `workDir/types`, once. */
function sdkTypesOnce() {
  sdkTypes ??= writeSdkTypes(workDir, catalog)
  return sdkTypes
}
