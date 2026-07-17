/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { formatChangedFunctionCode } from '@/lib/copilot/tools/server/workflow/edit-workflow/function-code-formatting'
import { CodeLanguage } from '@/lib/execution/languages'

function functionBlock(
  code: string,
  language: CodeLanguage = CodeLanguage.JavaScript
): Record<string, unknown> {
  return {
    type: 'function',
    subBlocks: {
      code: { value: code },
      language: { value: language },
    },
  }
}

describe('formatChangedFunctionCode', () => {
  it('formats changed JavaScript and Python Function blocks without mutating previous state', async () => {
    const previousWorkflowState = {
      blocks: {
        'existing-function': functionBlock('return 0;'),
        'python-function': functionBlock('value={"foo": 1}\nreturn value', CodeLanguage.Python),
      },
    }
    const modifiedWorkflowState = {
      blocks: {
        'existing-function': functionBlock('const value=1;return value;'),
        'new-function': functionBlock('const value=<start.value>;return {value};'),
        'python-function': functionBlock('value={"foo":1};return value', CodeLanguage.Python),
        agent: {
          type: 'agent',
          subBlocks: { code: { value: 'const value=1;return value;' } },
        },
      },
    }

    const result = await formatChangedFunctionCode(
      new Set(['existing-function', 'new-function', 'python-function']),
      modifiedWorkflowState
    )

    expect(modifiedWorkflowState.blocks['existing-function'].subBlocks.code.value).toBe(
      'const value = 1;\nreturn value;'
    )
    expect(modifiedWorkflowState.blocks['new-function'].subBlocks.code.value).toBe(
      'const value = <start.value>;\nreturn { value };'
    )
    expect(modifiedWorkflowState.blocks['python-function'].subBlocks.code.value).toBe(
      'value = {"foo": 1}\nreturn value'
    )
    expect(modifiedWorkflowState.blocks.agent.subBlocks.code.value).toBe(
      'const value=1;return value;'
    )
    expect(previousWorkflowState.blocks['existing-function'].subBlocks.code.value).toBe('return 0;')
    expect(result).toEqual({
      changedBlockIds: ['existing-function', 'new-function', 'python-function'],
      errors: [],
    })
  })

  it('formats using the final block language after all operations are applied', async () => {
    const modifiedWorkflowState = {
      blocks: {
        'function-1': functionBlock('value={"foo":1};return value', CodeLanguage.Python),
      },
    }

    await formatChangedFunctionCode(new Set(['function-1']), modifiedWorkflowState)

    expect(modifiedWorkflowState.blocks['function-1'].subBlocks.code.value).toBe(
      'value = {"foo": 1}\nreturn value'
    )
  })

  it('formats a replacement Function block from the final state', async () => {
    const modifiedWorkflowState = {
      blocks: {
        replacement: functionBlock('const value=1;return value;', CodeLanguage.JavaScript),
      },
    }

    await formatChangedFunctionCode(new Set(['replacement']), modifiedWorkflowState)

    expect(modifiedWorkflowState.blocks.replacement.subBlocks.code.value).toBe(
      'const value = 1;\nreturn value;'
    )
  })

  it('formats same-source nested edits after the engine resolves child identity', async () => {
    const code = 'const value=1;return value;'
    const modifiedWorkflowState = {
      blocks: { 'existing-child': functionBlock(code, CodeLanguage.JavaScript) },
    }

    await formatChangedFunctionCode(new Set(['existing-child']), modifiedWorkflowState)

    expect(modifiedWorkflowState.blocks['existing-child'].subBlocks.code.value).toBe(
      'const value = 1;\nreturn value;'
    )
  })

  it('does not format untouched JavaScript Function blocks', async () => {
    const untouchedCode = 'const untouched=1;return untouched;'
    const modifiedWorkflowState = {
      blocks: {
        'changed-function': functionBlock('const changed=1;return changed;'),
        'untouched-function': functionBlock(untouchedCode),
      },
    }

    await formatChangedFunctionCode(new Set(['changed-function']), modifiedWorkflowState)

    expect(modifiedWorkflowState.blocks['changed-function'].subBlocks.code.value).toBe(
      'const changed = 1;\nreturn changed;'
    )
    expect(modifiedWorkflowState.blocks['untouched-function'].subBlocks.code.value).toBe(
      untouchedCode
    )
  })

  it('does not format an untouched Function block with identical submitted code', async () => {
    const code = 'const value=1;return value;'
    const modifiedWorkflowState = {
      blocks: {
        'changed-function': functionBlock(code),
        'untouched-function': functionBlock(code),
      },
    }

    await formatChangedFunctionCode(new Set(['changed-function']), modifiedWorkflowState)

    expect(modifiedWorkflowState.blocks['changed-function'].subBlocks.code.value).toBe(
      'const value = 1;\nreturn value;'
    )
    expect(modifiedWorkflowState.blocks['untouched-function'].subBlocks.code.value).toBe(code)
  })

  it('keeps invalid submitted JavaScript unchanged', async () => {
    const code = 'if ('
    const modifiedWorkflowState = {
      blocks: { 'function-1': functionBlock(code) },
    }

    const result = await formatChangedFunctionCode(new Set(['function-1']), modifiedWorkflowState)

    expect(modifiedWorkflowState.blocks['function-1'].subBlocks.code.value).toBe(code)
    expect(result).toEqual({
      changedBlockIds: [],
      errors: [
        {
          blockId: 'function-1',
          language: CodeLanguage.JavaScript,
          error: expect.any(String),
        },
      ],
    })
  })

  it('keeps invalid submitted Python unchanged', async () => {
    const code = 'if ('
    const modifiedWorkflowState = {
      blocks: { 'function-1': functionBlock(code, CodeLanguage.Python) },
    }

    const result = await formatChangedFunctionCode(new Set(['function-1']), modifiedWorkflowState)

    expect(modifiedWorkflowState.blocks['function-1'].subBlocks.code.value).toBe(code)
    expect(result).toEqual({
      changedBlockIds: [],
      errors: [
        {
          blockId: 'function-1',
          language: CodeLanguage.Python,
          error: expect.any(String),
        },
      ],
    })
  })

  it('returns before inspecting workflow state when no code blocks changed', async () => {
    await expect(formatChangedFunctionCode(new Set(), null)).resolves.toEqual({
      changedBlockIds: [],
      errors: [],
    })
  })
})
