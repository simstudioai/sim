import { describe, expect, it } from 'vitest'
import { crowdstrikeQueryBodySchema } from '@/lib/api/contracts/tools/crowdstrike'

const credentials = {
  clientId: 'client-id',
  clientSecret: 'client-secret',
  cloud: 'us-1' as const,
}

describe('CrowdStrike RTR read-only base commands', () => {
  function parseBaseCommand(baseCommand: string) {
    return crowdstrikeQueryBodySchema.safeParse({
      ...credentials,
      operation: 'crowdstrike_execute_rtr_command',
      sessionId: 'session-1',
      baseCommand,
      commandString: `${baseCommand} `,
    })
  }

  it('accepts the non-Windows network and session triage commands', () => {
    expect(parseBaseCommand('ifconfig').success).toBe(true)
    expect(parseBaseCommand('users').success).toBe(true)
  })

  it('keeps the read-tier commands PSFalcon and Caracara document', () => {
    for (const baseCommand of ['csrutil', 'reg', 'eventlog']) {
      expect(parseBaseCommand(baseCommand).success).toBe(true)
    }
  })

  it('still rejects a write-tier base command', () => {
    expect(parseBaseCommand('rm').success).toBe(false)
  })
})
