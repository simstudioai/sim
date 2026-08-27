import { requestJson } from '@/lib/api/client/request'
import { imapMailboxesContract } from '@/lib/api/contracts/tools/imap'
import { SELECTOR_STALE } from '@/hooks/selectors/providers/shared'
import type { SelectorDefinition, SelectorKey, SelectorQueryArgs } from '@/hooks/selectors/types'

export const imapSelectors = {
  /**
   * Mailboxes on a self-described IMAP server. Unlike every other selector here the account is
   * not a stored credential the server can resolve by id — the user types the connection in,
   * so the parameters travel on the context.
   *
   * **The password is deliberately absent from the query key.** A query key identifies a
   * resource; a credential authorizes access to it. `oauthCredential` is safe in a key because
   * it is only an id, but a typed password is a secret, and React Query keys are held in cache
   * and surfaced by devtools. Host, port, TLS and username already identify the mailbox list
   * uniquely — the password only proves the caller may read it, and it rides the request body
   * exactly as it did before.
   *
   * The consequence is intentional: correcting a wrong password re-runs the request (the
   * previous attempt failed and cached nothing), while changing ONLY the password on an
   * otherwise identical connection reuses the cached list, which is the same list.
   */
  'imap.mailboxes': {
    key: 'imap.mailboxes',
    contracts: [imapMailboxesContract],
    staleTime: SELECTOR_STALE,
    getQueryKey: ({ context }: SelectorQueryArgs) => [
      'selectors',
      'imap.mailboxes',
      context.host ?? 'none',
      context.port ?? 'default',
      context.secure ?? 'default',
      context.username ?? 'none',
    ],
    enabled: ({ context }) => Boolean(context.host && context.username && context.password),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      if (!context.host || !context.username || !context.password) return []
      const data = await requestJson(imapMailboxesContract, {
        body: {
          host: context.host,
          port: context.port,
          secure: context.secure,
          username: context.username,
          password: context.password,
        },
        signal,
      })
      return data.mailboxes.map((mailbox) => ({ id: mailbox.path, label: mailbox.name }))
    },
  },
} satisfies Partial<Record<SelectorKey, SelectorDefinition>>
