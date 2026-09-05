/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockSend } = vi.hoisted(() => ({ mockSend: vi.fn() }))

/**
 * Stands in for every `@aws-sdk/client-ssm` command class. Each stub keeps the
 * request object on `input`, exactly like the real command, so the assertions
 * below read the parameter names the client actually sends to AWS.
 */
vi.mock('@aws-sdk/client-ssm', () => {
  class CommandStub {
    input: unknown
    constructor(input: unknown) {
      this.input = input
    }
  }

  const commandNames = [
    'CancelCommandCommand',
    'DeleteParameterCommand',
    'DescribeAutomationExecutionsCommand',
    'DescribeInstanceInformationCommand',
    'DescribeInstancePatchStatesCommand',
    'DescribeInstancePatchesCommand',
    'DescribeParametersCommand',
    'GetAutomationExecutionCommand',
    'GetCommandInvocationCommand',
    'GetDocumentCommand',
    'GetParameterCommand',
    'GetParametersByPathCommand',
    'GetParametersCommand',
    'ListCommandInvocationsCommand',
    'ListCommandsCommand',
    'ListComplianceItemsCommand',
    'ListComplianceSummariesCommand',
    'ListDocumentsCommand',
    'PutParameterCommand',
    'SendCommandCommand',
    'StartAutomationExecutionCommand',
    'StopAutomationExecutionCommand',
  ] as const

  const commands = Object.fromEntries(commandNames.map((name) => [name, CommandStub]))

  return {
    ...commands,
    SSMClient: class {
      send = mockSend
      destroy = vi.fn()
    },
  }
})

import {
  createSsmClient,
  describeInstancePatchStates,
  getCommandInvocation,
  getParameter,
  listCommands,
  putParameter,
  sendCommand,
} from '@/lib/internal/ssm/client'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function lastCommandInput(): Record<string, unknown> {
  return mockSend.mock.calls.at(-1)?.[0].input
}

describe('ssm client', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('maps send_command input onto the documented AWS parameter names', async () => {
    mockSend.mockResolvedValue({ Command: {} })

    await sendCommand(createSsmClient(CONNECTION), {
      ...CONNECTION,
      documentName: 'AWS-RunShellScript',
      instanceIds: ['i-0123456789abcdef0'],
      parameters: { commands: ['df -h'] },
      comment: 'disk check',
      executionTimeoutSeconds: 600,
      maxConcurrency: '50%',
      maxErrors: '0',
      outputS3BucketName: 'bucket',
      outputS3KeyPrefix: 'prefix/',
      serviceRoleArn: 'arn:aws:iam::123456789012:role/notify',
    })

    expect(lastCommandInput()).toEqual({
      DocumentName: 'AWS-RunShellScript',
      InstanceIds: ['i-0123456789abcdef0'],
      Parameters: { commands: ['df -h'] },
      Comment: 'disk check',
      TimeoutSeconds: 600,
      MaxConcurrency: '50%',
      MaxErrors: '0',
      OutputS3BucketName: 'bucket',
      OutputS3KeyPrefix: 'prefix/',
      ServiceRoleArn: 'arn:aws:iam::123456789012:role/notify',
    })
  })

  it('omits every optional send_command field the caller did not set', async () => {
    mockSend.mockResolvedValue({ Command: {} })

    await sendCommand(createSsmClient(CONNECTION), {
      ...CONNECTION,
      documentName: 'AWS-RunShellScript',
      targets: [{ Key: 'tag:Environment', Values: ['prod'] }],
    })

    expect(lastCommandInput()).toEqual({
      DocumentName: 'AWS-RunShellScript',
      Targets: [{ Key: 'tag:Environment', Values: ['prod'] }],
    })
  })

  it('projects the Command response and defaults absent collections', async () => {
    mockSend.mockResolvedValue({
      Command: {
        CommandId: 'command-1',
        DocumentName: 'AWS-RunShellScript',
        Status: 'Pending',
        RequestedDateTime: new Date('2026-01-02T03:04:05.000Z'),
        TimeoutSeconds: 600,
      },
    })

    const result = await sendCommand(createSsmClient(CONNECTION), {
      ...CONNECTION,
      documentName: 'AWS-RunShellScript',
      instanceIds: ['i-0123456789abcdef0'],
    })

    expect(result).toMatchObject({
      commandId: 'command-1',
      status: 'Pending',
      requestedDateTime: '2026-01-02T03:04:05.000Z',
      executionTimeoutSeconds: 600,
      instanceIds: [],
      targets: [],
      comment: null,
      targetCount: null,
    })
  })

  it('passes GetCommandInvocation timestamps through as the strings AWS returns', async () => {
    mockSend.mockResolvedValue({
      CommandId: 'command-1',
      InstanceId: 'i-0123456789abcdef0',
      Status: 'Success',
      ExecutionStartDateTime: '2026-01-02T03:04:05.000Z',
      ExecutionEndDateTime: '2026-01-02T03:04:09.000Z',
      ExecutionElapsedTime: 'PT4S',
      StandardOutputContent: 'ok',
    })

    const result = await getCommandInvocation(createSsmClient(CONNECTION), {
      ...CONNECTION,
      commandId: '11111111-2222-3333-4444-555555555555',
      instanceId: 'i-0123456789abcdef0',
    })

    expect(result.executionStartDateTime).toBe('2026-01-02T03:04:05.000Z')
    expect(result.executionElapsedTime).toBe('PT4S')
    expect(result.standardOutputContent).toBe('ok')
    expect(result.standardErrorContent).toBe('')
  })

  it('sends lowercase key/value CommandFilter members', async () => {
    mockSend.mockResolvedValue({ Commands: [] })

    await listCommands(createSsmClient(CONNECTION), {
      ...CONNECTION,
      filters: [{ key: 'Status', value: 'Failed' }],
    })

    expect(lastCommandInput()).toEqual({ Filters: [{ key: 'Status', value: 'Failed' }] })
  })

  it('only sends WithDecryption when the caller opted in', async () => {
    mockSend.mockResolvedValue({ Parameter: { Name: '/prod/app/db', Value: 'v' } })

    await getParameter(createSsmClient(CONNECTION), { ...CONNECTION, name: '/prod/app/db' })
    expect(lastCommandInput()).toEqual({ Name: '/prod/app/db' })

    await getParameter(createSsmClient(CONNECTION), {
      ...CONNECTION,
      name: '/prod/app/db',
      withDecryption: true,
    })
    expect(lastCommandInput()).toEqual({ Name: '/prod/app/db', WithDecryption: true })
  })

  it('never echoes the written value in the put_parameter result', async () => {
    mockSend.mockResolvedValue({ Version: 4, Tier: 'Standard' })

    const result = await putParameter(createSsmClient(CONNECTION), {
      ...CONNECTION,
      name: '/prod/app/db-password',
      value: 'super-secret-value',
      type: 'SecureString',
    })

    expect(JSON.stringify(result)).not.toContain('super-secret-value')
    expect(result).toEqual({
      message: 'Parameter "/prod/app/db-password" written successfully',
      name: '/prod/app/db-password',
      version: 4,
      tier: 'Standard',
    })
  })

  it('projects InstancePatchState counts and timestamps', async () => {
    mockSend.mockResolvedValue({
      InstancePatchStates: [
        {
          InstanceId: 'i-0123456789abcdef0',
          PatchGroup: 'prod',
          BaselineId: 'pb-1',
          Operation: 'Scan',
          OperationStartTime: new Date('2026-01-02T03:04:05.000Z'),
          OperationEndTime: new Date('2026-01-02T03:14:05.000Z'),
          MissingCount: 3,
        },
      ],
    })

    const result = await describeInstancePatchStates(createSsmClient(CONNECTION), {
      ...CONNECTION,
      instanceIds: ['i-0123456789abcdef0'],
    })

    expect(result.count).toBe(1)
    expect(result.nextToken).toBeNull()
    expect(result.instancePatchStates[0]).toMatchObject({
      instanceId: 'i-0123456789abcdef0',
      patchGroup: 'prod',
      baselineId: 'pb-1',
      operation: 'Scan',
      operationStartTime: '2026-01-02T03:04:05.000Z',
      operationEndTime: '2026-01-02T03:14:05.000Z',
      missingCount: 3,
      installedCount: null,
    })
  })

  it('forwards the abort signal to every SDK call', async () => {
    const controller = new AbortController()
    mockSend.mockResolvedValue({ Commands: [] })

    await listCommands(createSsmClient(CONNECTION), CONNECTION, controller.signal)

    expect(mockSend.mock.calls.at(-1)?.[1]).toEqual({ abortSignal: controller.signal })
  })
})
