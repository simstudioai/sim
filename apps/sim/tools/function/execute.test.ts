/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_EXECUTION_TIMEOUT_MS } from '@/lib/execution/constants'
import {
  MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
  PRIVATE_SECRET_PROVENANCE_FIELD,
} from '@/lib/execution/private-tool-metadata'
import { buildFunctionExecuteBody, functionExecuteTool } from '@/tools/function/execute'

describe('Function Execute Tool', () => {
  it('declares an in-process operation without HTTP-shaped configuration', () => {
    expect(functionExecuteTool.operation).toBeDefined()
    expect('request' in functionExecuteTool).toBe(false)
  })

  it('materializes the canonical operation input', () => {
    expect(
      functionExecuteTool.operation.input({
        code: 'return 42',
        timeout: 5000,
      })
    ).toEqual({
      code: 'return 42',
      language: 'javascript',
      timeout: 5000,
      title: undefined,
      outputPath: undefined,
      outputFormat: undefined,
      outputTable: undefined,
      outputSandboxPath: undefined,
      outputMimeType: undefined,
      sandboxId: undefined,
      secretScope: undefined,
      mountedSecrets: undefined,
      unredactedSecretNames: undefined,
      overwriteFileId: undefined,
      inputs: undefined,
      outputs: undefined,
      envVars: {},
      workflowVariables: {},
      blockData: {},
      blockNameMapping: {},
      blockOutputSchemas: {},
      contextVariables: {},
      workflowId: undefined,
      executionId: undefined,
      largeValueExecutionIds: undefined,
      largeValueKeys: undefined,
      fileKeys: undefined,
      allowLargeValueWorkflowScope: undefined,
      userId: undefined,
      workspaceId: undefined,
      isCustomTool: false,
    })
  })

  it('joins serialized code blocks and applies the default timeout', () => {
    const body = buildFunctionExecuteBody({
      code: [
        { content: 'const x = 40;', id: 'block1' },
        { content: 'return x + 2;', id: 'block2' },
      ],
    })

    expect(body.code).toBe('const x = 40;\nreturn x + 2;')
    expect(body.timeout).toBe(DEFAULT_EXECUTION_TIMEOUT_MS)
  })

  it('preserves reference context and large-value authorization', () => {
    const body = buildFunctionExecuteBody({
      code: 'return contextVariables.previous.result',
      contextVariables: { previous: { result: 42 } },
      _context: {
        workflowId: 'workflow-1',
        executionId: 'execution-1',
        userId: 'user-1',
        workspaceId: 'workspace-1',
        largeValueExecutionIds: ['execution-parent'],
        largeValueKeys: ['large-value-key'],
        fileKeys: ['file-key'],
        allowLargeValueWorkflowScope: true,
      },
    })

    expect(body).toMatchObject({
      contextVariables: { previous: { result: 42 } },
      workflowId: 'workflow-1',
      executionId: 'execution-1',
      userId: 'user-1',
      workspaceId: 'workspace-1',
      largeValueExecutionIds: ['execution-parent'],
      largeValueKeys: ['large-value-key'],
      fileKeys: ['file-key'],
      allowLargeValueWorkflowScope: true,
    })
  })

  it('keeps mounted-file provenance inside the private operation envelope', () => {
    const bundle = {
      version: 1 as const,
      complete: true,
      selections: [
        {
          key: MOUNTED_WORKSPACE_FILES_PROVENANCE_KEY,
          provenance: {
            version: 1 as const,
            complete: true,
            entries: [{ encryptedValue: 'encrypted-secret' }],
          },
        },
      ],
    }
    const body = buildFunctionExecuteBody({
      code: 'return 42',
      [PRIVATE_SECRET_PROVENANCE_FIELD]: bundle,
    })

    expect(body[PRIVATE_SECRET_PROVENANCE_FIELD]).toEqual(bundle)
    expect(JSON.stringify(body)).not.toContain('plaintext')
  })

  it('preserves sandbox cost in a successful Function result', async () => {
    const cost = { input: 0, output: 0, total: 0.00012345 }
    const result = await functionExecuteTool.transformResponse?.(
      Response.json({
        success: true,
        output: { result: 42, stdout: 'done', cost },
      }),
      { code: 'return 42' }
    )

    expect(result).toMatchObject({
      success: true,
      output: { result: 42, stdout: 'done', cost },
    })
  })
})
