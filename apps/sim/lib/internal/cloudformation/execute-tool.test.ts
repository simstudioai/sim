/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const mockOperations = vi.hoisted(() => ({
  executeCloudformationCancelUpdateStack: vi.fn(),
  executeCloudformationCreateChangeSet: vi.fn(),
  executeCloudformationCreateStack: vi.fn(),
  executeCloudformationDeleteStack: vi.fn(),
  executeCloudformationDescribeChangeSet: vi.fn(),
  executeCloudformationDescribeStackDriftDetectionStatus: vi.fn(),
  executeCloudformationDescribeStackEvents: vi.fn(),
  executeCloudformationDescribeStacks: vi.fn(),
  executeCloudformationDetectStackDrift: vi.fn(),
  executeCloudformationExecuteChangeSet: vi.fn(),
  executeCloudformationGetTemplate: vi.fn(),
  executeCloudformationGetTemplateSummary: vi.fn(),
  executeCloudformationListStackResources: vi.fn(),
  executeCloudformationUpdateStack: vi.fn(),
  executeCloudformationValidateTemplate: vi.fn(),
}))

vi.mock('@/lib/internal/cloudformation/operations', () => mockOperations)

import { executeCloudformationTool } from '@/lib/internal/cloudformation/execute-tool'
import type { InternalToolOperationCall } from '@/lib/internal/tool-operations/types'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function createRequest(
  overrides: Partial<InternalToolOperationCall> = {}
): InternalToolOperationCall {
  return {
    toolId: 'cloudformation_describe_stacks',
    input: CONNECTION,
    headers: new Headers({ 'content-type': 'application/json' }),
    context: {
      workflowId: 'workflow-1',
      workspaceId: 'workspace-1',
      userId: 'user-1',
      metadata: {},
    },
    requestId: 'request-1',
    ...overrides,
  }
}

const STACK = { ...CONNECTION, stackName: 'stack' }
const CHANGE_SET = { ...CONNECTION, changeSetName: 'change-set' }

const TOOL_CASES = [
  [
    'cloudformation_cancel_update_stack',
    STACK,
    mockOperations.executeCloudformationCancelUpdateStack,
  ],
  [
    'cloudformation_create_change_set',
    { ...STACK, changeSetName: 'change-set', templateBody: '{}' },
    mockOperations.executeCloudformationCreateChangeSet,
  ],
  [
    'cloudformation_create_stack',
    { ...STACK, templateBody: '{}' },
    mockOperations.executeCloudformationCreateStack,
  ],
  ['cloudformation_delete_stack', STACK, mockOperations.executeCloudformationDeleteStack],
  [
    'cloudformation_describe_change_set',
    CHANGE_SET,
    mockOperations.executeCloudformationDescribeChangeSet,
  ],
  [
    'cloudformation_describe_stack_drift_detection_status',
    { ...CONNECTION, stackDriftDetectionId: 'drift-id' },
    mockOperations.executeCloudformationDescribeStackDriftDetectionStatus,
  ],
  [
    'cloudformation_describe_stack_events',
    STACK,
    mockOperations.executeCloudformationDescribeStackEvents,
  ],
  [
    'cloudformation_describe_stacks',
    CONNECTION,
    mockOperations.executeCloudformationDescribeStacks,
  ],
  [
    'cloudformation_detect_stack_drift',
    STACK,
    mockOperations.executeCloudformationDetectStackDrift,
  ],
  [
    'cloudformation_execute_change_set',
    CHANGE_SET,
    mockOperations.executeCloudformationExecuteChangeSet,
  ],
  ['cloudformation_get_template', STACK, mockOperations.executeCloudformationGetTemplate],
  [
    'cloudformation_get_template_summary',
    STACK,
    mockOperations.executeCloudformationGetTemplateSummary,
  ],
  [
    'cloudformation_list_stack_resources',
    STACK,
    mockOperations.executeCloudformationListStackResources,
  ],
  [
    'cloudformation_update_stack',
    { ...STACK, usePreviousTemplate: true },
    mockOperations.executeCloudformationUpdateStack,
  ],
  [
    'cloudformation_validate_template',
    { ...CONNECTION, templateBody: '{}' },
    mockOperations.executeCloudformationValidateTemplate,
  ],
] as const

describe('executeCloudformationTool', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it.each(TOOL_CASES)('validates and dispatches %s', async (toolId, input, operation) => {
    const controller = new AbortController()
    operation.mockResolvedValue({ toolId })

    const response = await executeCloudformationTool(
      createRequest({ toolId, input, signal: controller.signal })
    )

    expect(response.status).toBe(200)
    await expect(response.json()).resolves.toEqual({ toolId })
    expect(operation).toHaveBeenCalledWith(input, controller.signal)
  })

  it('returns the canonical validation envelope before provider work', async () => {
    const response = await executeCloudformationTool(createRequest({ input: { region: '' } }))

    expect(response.status).toBe(400)
    await expect(response.json()).resolves.toMatchObject({
      error: 'Invalid request data',
      details: expect.any(Array),
    })
    expect(mockOperations.executeCloudformationDescribeStacks).not.toHaveBeenCalled()
  })

  it('preserves the provider error envelope', async () => {
    mockOperations.executeCloudformationDescribeStacks.mockRejectedValue(new Error('AWS rejected'))

    const response = await executeCloudformationTool(createRequest())

    expect(response.status).toBe(500)
    await expect(response.json()).resolves.toEqual({ error: 'AWS rejected' })
  })

  it('propagates cancellation without starting provider work', async () => {
    const controller = new AbortController()
    controller.abort(new DOMException('cancelled', 'AbortError'))

    await expect(
      executeCloudformationTool(createRequest({ signal: controller.signal }))
    ).rejects.toMatchObject({ name: 'AbortError' })
    expect(mockOperations.executeCloudformationDescribeStacks).not.toHaveBeenCalled()
  })
})
