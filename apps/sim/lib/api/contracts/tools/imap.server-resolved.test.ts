/**
 * @vitest-environment node
 */
import { describe, expect, it } from 'vitest'
import {
  imapMailboxesBodySchema,
  resolvedImapMailboxesBodySchema,
} from '@/lib/api/contracts/tools/imap'

describe('IMAP selector contracts', () => {
  it('accepts literal or exact-reference values for every connection field', () => {
    for (const useReferences of [false, true]) {
      expect(
        imapMailboxesBodySchema.safeParse({
          workflowId: 'workflow-1',
          host: useReferences ? '{{IMAP_HOST}}' : 'imap.example.com',
          port: useReferences ? '{{IMAP_PORT}}' : 993,
          secure: useReferences ? '{{IMAP_TLS}}' : true,
          username: useReferences ? '{{IMAP_USERNAME}}' : 'mailbox@example.com',
          password: useReferences ? '{{IMAP_PASSWORD}}' : 'literal-password',
        }).success
      ).toBe(true)
    }
  })

  it.each([
    ['993', 'true', 993, true],
    ['143', 'false', 143, false],
    [undefined, undefined, 993, true],
  ])('coerces resolved port %s and TLS %s', (port, secure, expectedPort, expectedSecure) => {
    expect(
      resolvedImapMailboxesBodySchema.parse({
        host: 'imap.example.com',
        port,
        secure,
        username: 'mailbox@example.com',
        password: 'resolved-password',
      })
    ).toMatchObject({ port: expectedPort, secure: expectedSecure })
  })

  it('rejects invalid resolved port and TLS values', () => {
    expect(
      resolvedImapMailboxesBodySchema.safeParse({
        host: 'imap.example.com',
        port: 'invalid',
        secure: 'invalid',
        username: 'mailbox@example.com',
        password: 'resolved-password',
      }).success
    ).toBe(false)
  })
})
