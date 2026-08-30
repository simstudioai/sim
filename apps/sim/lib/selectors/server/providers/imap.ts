import { listImapMailboxes, normalizeResolvedImapConnection } from '@/lib/imap/connection.server'
import { SelectorConnectionUnavailableError } from '@/lib/selectors/server/errors'
import {
  definePreparedSelectorAttachment,
  listSelectorResult,
  type ServerSelectorAttachmentMap,
} from '@/lib/selectors/server/types'

export const imapSelectorAttachments = {
  'imap.mailboxes': definePreparedSelectorAttachment({
    destination: {
      kind: 'user-controlled',
      async prepare(args) {
        const hiddenSharedAuth = ['username', 'password'].some((field) => {
          const reference = args.references.get(field)
          return reference !== undefined && !reference.visible
        })
        if (hiddenSharedAuth) throw new SelectorConnectionUnavailableError()

        return normalizeResolvedImapConnection({
          host: args.context.host,
          port: args.context.port,
          secure: args.context.secure,
          username: args.context.username,
          password: args.context.password,
        })
      },
    },
    async execute(args, connection) {
      const mailboxes = await listImapMailboxes(connection, args.signal)
      return listSelectorResult(
        mailboxes.map((mailbox) => ({ id: mailbox.path, label: mailbox.name }))
      )
    },
  }),
} satisfies ServerSelectorAttachmentMap<'imap.mailboxes'>
