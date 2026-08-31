import {
  ImapConnectionPolicyError,
  listImapMailboxes,
  normalizeResolvedImapConnection,
} from '@/lib/imap/connection.server'
import {
  SelectorConnectionUnavailableError,
  SelectorContextUnavailableError,
} from '@/lib/selectors/server/errors'
import {
  definePreparedSelectorAttachment,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

function throwPublicImapError(error: unknown): never {
  if (!(error instanceof ImapConnectionPolicyError)) throw error
  if (error.code === 'context') throw new SelectorContextUnavailableError()
  throw new SelectorConnectionUnavailableError()
}

export const imapSelectorAttachments = {
  'imap.mailboxes': definePreparedSelectorAttachment({
    destination: {
      kind: 'user-controlled',
      async prepare(args) {
        args.signal?.throwIfAborted()
        const hiddenSharedAuth = ['username', 'password'].some((field) => {
          const reference = args.references.get(field)
          return reference !== undefined && !reference.visible
        })
        if (hiddenSharedAuth) throw new SelectorConnectionUnavailableError()

        try {
          return normalizeResolvedImapConnection({
            host: args.context.host,
            port: args.context.port,
            secure: args.context.secure,
            username: args.context.username,
            password: args.context.password,
          })
        } catch (error) {
          args.signal?.throwIfAborted()
          throwPublicImapError(error)
        }
      },
    },
    async execute(args, connection) {
      let mailboxes
      try {
        mailboxes = await listImapMailboxes(connection, args.signal)
      } catch (error) {
        args.signal?.throwIfAborted()
        throwPublicImapError(error)
      }
      return listSelectorResult(
        mailboxes.map((mailbox) => ({ id: mailbox.path, label: mailbox.name }))
      )
    },
  }),
} satisfies ServerSelectorAttachmentMap<'imap.mailboxes'>
