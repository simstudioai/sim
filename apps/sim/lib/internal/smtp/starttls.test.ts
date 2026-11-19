import { createServer, type Server } from 'node:net'
import {
  inputValidationMock,
  inputValidationMockFns,
} from '@sim/testing/mocks/input-validation.mock'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/security/input-validation.server', () => inputValidationMock)
vi.mock('@/lib/messaging/email/ehlo', () => ({ getSmtpEhloName: () => 'sim.example.com' }))

import { executeSmtpSend } from '@/lib/internal/smtp/operations'

const { mockValidateDatabaseHost } = inputValidationMockFns

/** A plaintext SMTP server that never offers STARTTLS and records every command it receives. */
function startPlaintextSmtpServer(commands: string[]): Promise<{ server: Server; port: number }> {
  const server = createServer((socket) => {
    socket.on('error', () => {})
    let buffered = ''
    let inData = false
    socket.write('220 test ESMTP\r\n')
    socket.on('data', (chunk) => {
      buffered += chunk.toString()
      let lineEnd = buffered.indexOf('\r\n')
      while (lineEnd !== -1) {
        const line = buffered.slice(0, lineEnd)
        buffered = buffered.slice(lineEnd + 2)
        lineEnd = buffered.indexOf('\r\n')
        if (inData) {
          if (line === '.') {
            inData = false
            socket.write('250 queued\r\n')
          }
          continue
        }
        const command = line.split(' ')[0].toUpperCase()
        commands.push(command)
        if (command === 'EHLO') socket.write('250-test\r\n250 AUTH PLAIN LOGIN\r\n')
        else if (command === 'STARTTLS') socket.write('502 command not implemented\r\n')
        else if (command === 'AUTH') socket.write('235 authenticated\r\n')
        else if (command === 'DATA') {
          inData = true
          socket.write('354 go ahead\r\n')
        } else if (command === 'QUIT') socket.end('221 bye\r\n')
        else socket.write('250 ok\r\n')
      }
    })
  })
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      resolve({ server, port: typeof address === 'object' && address ? address.port : 0 })
    })
  })
}

describe('SMTP security modes against a server without STARTTLS', () => {
  let server: Server | undefined
  const commands: string[] = []

  beforeEach(() => {
    commands.length = 0
    mockValidateDatabaseHost.mockResolvedValue({ isValid: true, resolvedIP: '127.0.0.1' })
  })

  afterEach(async () => {
    await new Promise((resolve) => server?.close(resolve) ?? resolve(undefined))
  })

  const send = async (smtpSecure: 'TLS' | 'None') => {
    const started = await startPlaintextSmtpServer(commands)
    server = started.server
    return executeSmtpSend(
      {
        smtpHost: 'smtp.example.com',
        smtpPort: started.port,
        smtpUsername: 'user',
        smtpPassword: 'password',
        smtpSecure,
        from: 'from@example.com',
        to: 'to@example.com',
        subject: 'Hello',
        body: 'Hello',
      },
      { requestId: 'request-1', userId: 'user-1' }
    )
  }

  it('fails in TLS mode before sending credentials', async () => {
    await expect(send('TLS')).rejects.toMatchObject({ status: 500 })
    expect(commands).toContain('EHLO')
    expect(commands).not.toContain('AUTH')
    expect(commands).not.toContain('MAIL')
  })

  it('still sends in None mode, which allows a plaintext session', async () => {
    await expect(send('None')).resolves.toMatchObject({ success: true })
    expect(commands).toContain('AUTH')
  })
})
