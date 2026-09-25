import { describe, expect, it, vi } from 'vitest'

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

import { createSsmClient, getParameter, putParameter } from '@/lib/internal/ssm/client'

const CONNECTION = {
  region: 'us-east-1',
  accessKeyId: 'access-key',
  secretAccessKey: 'secret-key',
}

function lastCommandInput(): Record<string, unknown> {
  return mockSend.mock.calls.at(-1)?.[0].input
}

describe('ssm client', () => {
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
})
