import { describe, expect, it } from 'vitest'
import { typecheckSdkDirectory } from '../../test/typecheck-project'

/** Type-checks `tools/lookup.ts` against the workspace SDK as the CLI writes it. */
function typecheckTool(declaration: string): string {
  return typecheckSdkDirectory({ 'tools/lookup.ts': declaration }, ['tools/*.ts'])
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
