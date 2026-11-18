/**
 * The SDK never declares syntax the compiler refuses: `test/core/every-builder.ts` calls every
 * builder `core.d.ts` declares, type-checks against `core.d.ts` plus the types generated from the
 * fixture catalog, and compiles over that catalog with no errors.
 */
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { compileWorkflow, SDK_CORE_EXPORTS } from '@sim/workflow-code'
import { describe, expect, it } from 'vitest'
import {
  loadFixtureCatalog,
  typecheck,
  typecheckSdkDirectory,
  writeTypecheckProject,
} from '../test/typecheck-project'

const SAMPLE = readFileSync(
  path.resolve(import.meta.dirname, '../test/core/every-builder.ts'),
  'utf8'
)

/**
 * Core exports the sample does not import: `legacy` is an empty namespace in `core.d.ts` whose
 * builders the catalog generates, and the fixture catalog has no legacy block versions.
 */
const NOT_IN_SAMPLE = new Set(['legacy'])

/** Builders `core.d.ts` declares as members rather than exports. */
const MEMBER_BUILDERS = [
  'loop.for(',
  'loop.forEach(',
  'loop.while(',
  'loop.doWhile(',
  'parallel(',
  'parallel.count(',
  'parallel.collection(',
  "mcp('docs').tool(",
  "childWorkflow('assign-owner').asTool(",
  '.onError(',
]

function compileSample(text: string, stored?: ReturnType<typeof compileWorkflow>['workflow']) {
  return compileWorkflow({
    entry: { path: 'workflow.ts', text },
    files: new Map([['functions/score.js', 'return { score: 1 }\n']]),
    catalog: loadFixtureCatalog(),
    sdkMajor: 1,
    ...(stored && { stored }),
  })
}

describe('core.d.ts builders', () => {
  it('the sample calls every core builder', () => {
    const imported = new Set(
      /import \{([^}]*)\} from '@sim\/workflow-sdk'/
        .exec(SAMPLE)?.[1]
        ?.split(',')
        .map((name) => name.trim())
    )
    const missing = SDK_CORE_EXPORTS.filter(
      (name) => !imported.has(name) && !NOT_IN_SAMPLE.has(name)
    )
    expect(missing).toEqual([])
    expect(MEMBER_BUILDERS.filter((call) => !SAMPLE.includes(call))).toEqual([])
  })

  it('compiles the sample with no errors', () => {
    // `stored()` keeps a value of the workflow the source continues; compile that one first.
    const previous = compileSample(SAMPLE.replace('stored()', "'sk-old'"))
    expect(previous.diagnostics.filter((diagnostic) => diagnostic.severity === 'error')).toEqual([])
    const errors = compileSample(SAMPLE, previous.workflow).diagnostics.filter(
      (diagnostic) => diagnostic.severity === 'error'
    )
    expect(errors).toEqual([])
  })

  it('type-checks the sample against core.d.ts and the generated types', () => {
    const outDir = mkdtempSync(path.join(tmpdir(), 'sim-sdk-core-'))
    try {
      expect(typecheck(writeTypecheckProject(outDir, ['core']).tsconfig)).toBe('')
    } finally {
      rmSync(outDir, { recursive: true, force: true })
    }
  }, 120_000)
})

describe('core.d.ts error messages', () => {
  it('names only the branch other than else written as true', () => {
    const output = typecheckSdkDirectory(
      {
        'check.ts': `import { condition, js } from '@sim/workflow-sdk'
condition('Pick', { yes: js\`1 > 0\`, no: true })
`,
      },
      ['check.ts']
    )
    expect(output).toContain('OnlyElseMayBeTrue')
    expect(output).not.toContain("'never'")
    expect(output.match(/error TS/g)).toHaveLength(1)
  }, 120_000)
})
