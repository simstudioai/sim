import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { typecheck } from '../../test/typecheck-project'
import { CORE_DTS } from '../codegen/core-text.generated'
import { WORKSPACE_SDK_DTS } from '../codegen/workspace-text.generated'

/** Type-checks `tools/lookup.ts` against the workspace SDK as the CLI writes it. */
function typecheckTool(declaration: string): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'sim-tool-types-'))
  try {
    const write = (file: string, text: string) => {
      mkdirSync(path.dirname(path.join(dir, file)), { recursive: true })
      writeFileSync(path.join(dir, file), text)
    }
    write('.sim/sdk/core.d.ts', CORE_DTS)
    for (const [name, text] of Object.entries(WORKSPACE_SDK_DTS)) {
      write(`.sim/sdk/workspace/${name}`, text)
    }
    write('tools/lookup.ts', declaration)
    write(
      'tsconfig.json',
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
          paths: {
            '@sim/workflow-sdk': ['./.sim/sdk/core.d.ts'],
            '@sim/workflow-sdk/workspace': ['./.sim/sdk/workspace/index.d.ts'],
          },
        },
        include: ['tools/*.ts', '.sim/sdk/**/*.d.ts'],
      })
    )
    return typecheck(path.join(dir, 'tsconfig.json'))
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const TOOL = `// @sim-sdk 1
import { codeFile, defineTool } from '@sim/workflow-sdk/workspace'

export default defineTool({
  title: 'Lookup',
  schema: {
    type: 'function',
    function: {
      name: 'lookup',
      strict: true,
      parameters: { type: 'object', properties: { id: { type: 'string' } }, additionalProperties: false },
    },
  },
  code: codeFile('./lookup.js'),
})
`

describe('tool declarations', () => {
  it('type a printed tool, extra schema fields included', () => {
    expect(typecheckTool(TOOL)).toBe('')
  }, 120_000)

  it('reject a schema that is not a function declaration', () => {
    const output = typecheckTool(TOOL.replace("type: 'function'", "type: 'object'"))
    expect(output).toContain(`'"object"' is not assignable`)
  }, 120_000)
})
