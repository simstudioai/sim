/**
 * @vitest-environment node
 */
import { spawnSync } from 'node:child_process'
import { describe, expect, it, vi } from 'vitest'
import { CodeLanguage } from '@/lib/execution/languages'
import { formatFunctionCode } from '@/lib/workflows/blocks/format-function-code'
import { BlockType } from '@/executor/constants'
import { ExecutionState } from '@/executor/execution/state'
import type { ExecutionContext } from '@/executor/types'
import { VariableResolver } from '@/executor/variables/resolver'
import type { SerializedBlock, SerializedWorkflow } from '@/serializer/types'

vi.mock('@/executor/utils/block-data', () => ({ getBlockSchema: () => ({}) }))

const PRODUCER_OUTPUT = {
  result: {
    name: 'formatter',
    values: [2, 4, 6],
  },
}

interface ResolvedFunctionCode {
  code: string
  contextVariables: Record<string, unknown>
}

interface PythonProgramAnalysis {
  ast: string
  result: unknown
}

interface PythonProgramComparison {
  formatted: PythonProgramAnalysis
  original: PythonProgramAnalysis
}

const PYTHON_ANALYSIS_SCRIPT = `
import ast
import json
import sys
import textwrap

payload = json.load(sys.stdin)

def analyze(code):
    namespace = dict(payload["contextVariables"])
    namespace["json"] = json
    source = "def __sim_function__():\\n" + textwrap.indent(code, "    ") + "\\n"
    tree = ast.parse(source)
    exec(compile(tree, "<sim-function>", "exec"), namespace)
    return {
        "ast": ast.dump(tree, include_attributes=False),
        "result": namespace["__sim_function__"](),
    }

print(json.dumps({
    "formatted": analyze(payload["formattedCode"]),
    "original": analyze(payload["originalCode"]),
}, sort_keys=True))
`.trim()

function createBlock(id: string, name: string, type: string, params = {}): SerializedBlock {
  return {
    id,
    metadata: { id: type, name },
    position: { x: 0, y: 0 },
    config: { tool: type, params },
    inputs: {},
    outputs: { result: 'json' },
    enabled: true,
  }
}

async function resolveFunctionCode(
  code: string,
  language: CodeLanguage.JavaScript | CodeLanguage.Python
): Promise<ResolvedFunctionCode> {
  const producer = createBlock('producer', 'Producer', BlockType.API)
  const functionBlock = createBlock('function', 'Function', BlockType.FUNCTION, { language })
  const workflow: SerializedWorkflow = {
    version: '1',
    blocks: [producer, functionBlock],
    connections: [],
    loops: {},
    parallels: {},
  }
  const state = new ExecutionState()
  state.setBlockOutput('producer', PRODUCER_OUTPUT)
  const context = {
    workflowId: 'workflow-1',
    blockStates: state.getBlockStates(),
    executedBlocks: state.getExecutedBlocks(),
    blockLogs: [],
    metadata: { duration: 0 },
    environmentVariables: {
      EXPRESSION: '1 + 2',
      OFFSET: '5',
      PYTHON_ASSIGNMENT: 'assigned := 7',
    },
    workflowVariables: {},
    decisions: { router: new Map(), condition: new Map() },
    completedLoops: new Set(),
    activeExecutionPath: new Set(),
  } as ExecutionContext
  const resolver = new VariableResolver(workflow, {}, state)
  const resolved = await resolver.resolveInputsForFunctionBlock(
    context,
    functionBlock.id,
    { code },
    functionBlock
  )

  expect(typeof resolved.resolvedInputs.code).toBe('string')
  return {
    code: resolved.resolvedInputs.code as string,
    contextVariables: resolved.contextVariables,
  }
}

async function canonicalizeResolvedCode(
  code: string,
  language: CodeLanguage.JavaScript | CodeLanguage.Python
): Promise<string> {
  const result = await formatFunctionCode(code, language)
  expect(result.error).toBeNull()
  return result.code
}

function executeJavaScript(code: string, contextVariables: Record<string, unknown>): unknown {
  const execute = new Function('globalThis', code) as (
    variables: Record<string, unknown>
  ) => unknown
  return execute(structuredClone(contextVariables))
}

function analyzePythonPrograms(
  originalCode: string,
  formattedCode: string,
  contextVariables: Record<string, unknown>
): PythonProgramComparison {
  const input = JSON.stringify({ originalCode, formattedCode, contextVariables })

  for (const executable of ['python3', 'python']) {
    const analysis = spawnSync(executable, ['-c', PYTHON_ANALYSIS_SCRIPT], {
      encoding: 'utf8',
      input,
    })
    if (analysis.error && 'code' in analysis.error && analysis.error.code === 'ENOENT') continue
    if (analysis.error) throw analysis.error
    if (analysis.status !== 0) {
      throw new Error(`${executable} failed to analyze Function code: ${analysis.stderr.trim()}`)
    }
    return JSON.parse(analysis.stdout) as PythonProgramComparison
  }

  throw new Error('Python is required to verify formatted Python Function behavior')
}

describe('formatFunctionCode reference resolution integration', () => {
  it.each([
    'const item=<Producer.result>;const offset={{OFFSET}};return {name:item.name,total:item.values.reduce((sum,value)=>sum+value,offset)};',
    "const raw='<Producer.result>';return raw;",
    // biome-ignore lint/suspicious/noTemplateCurlyInString: intentional Function source fixture
    'return `item:${String(<Producer.result>.name)}:{{OFFSET}}`;',
    "// don't confuse quote tracking\nconst item=<Producer.result>;return item.values.slice(1);",
    'return 2*({{EXPRESSION}});',
    'return 2*(/* before */{{EXPRESSION}}/* after */);',
  ])('preserves resolved JavaScript behavior: %s', async (sourceCode) => {
    const formatted = await formatFunctionCode(sourceCode, CodeLanguage.JavaScript)
    expect(formatted.error).toBeNull()

    const [originalResolved, formattedResolved] = await Promise.all([
      resolveFunctionCode(sourceCode, CodeLanguage.JavaScript),
      resolveFunctionCode(formatted.code, CodeLanguage.JavaScript),
    ])

    expect(formattedResolved.contextVariables).toEqual(originalResolved.contextVariables)
    await expect(
      canonicalizeResolvedCode(formattedResolved.code, CodeLanguage.JavaScript)
    ).resolves.toBe(await canonicalizeResolvedCode(originalResolved.code, CodeLanguage.JavaScript))
    expect(executeJavaScript(formattedResolved.code, formattedResolved.contextVariables)).toEqual(
      executeJavaScript(originalResolved.code, originalResolved.contextVariables)
    )
  })

  it.each([
    'item=<Producer.result>\noffset={{OFFSET}}\nreturn {"name":item["name"],"total":sum(item["values"])+offset}',
    "raw='<Producer.result>'\nreturn raw",
    "prompt='''\nSummary: <Producer.result>\n'''\nreturn prompt",
    "# don't confuse quote tracking\nitem=<Producer.result>\nreturn item['values'][1:]",
    'value=({{PYTHON_ASSIGNMENT}})\nreturn value',
    'value=(\n {{EXPRESSION}}\n)\nreturn value',
    'value=(\n # before\n {{EXPRESSION}} # after\n)\nreturn value',
  ])('preserves resolved Python syntax and references: %s', async (sourceCode) => {
    const formatted = await formatFunctionCode(sourceCode, CodeLanguage.Python)
    expect(formatted.error).toBeNull()

    const [originalResolved, formattedResolved] = await Promise.all([
      resolveFunctionCode(sourceCode, CodeLanguage.Python),
      resolveFunctionCode(formatted.code, CodeLanguage.Python),
    ])

    expect(formattedResolved.contextVariables).toEqual(originalResolved.contextVariables)
    const analysis = analyzePythonPrograms(
      originalResolved.code,
      formattedResolved.code,
      originalResolved.contextVariables
    )
    expect(analysis.formatted.ast).toBe(analysis.original.ast)
    expect(analysis.formatted.result).toEqual(analysis.original.result)
  })
})
