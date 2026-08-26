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
   * **Connection fields are deliberately absent from the query key.** React Query keys are
   * retained in browser memory and surfaced by devtools, so server-resolved dependencies are
   * represented by the shared opaque revision instead of their literal or referenced values.
   */
  'imap.mailboxes': {
    key: 'imap.mailboxes',
    contracts: [imapMailboxesContract],
    serverResolvedContextFields: ['host', 'port', 'secure', 'username', 'password'],
    staleTime: SELECTOR_STALE,
    getQueryKey: () => ['selectors', 'imap.mailboxes'],
    enabled: ({ context }) =>
      Boolean(context.host && context.username && context.password && context.workflowId),
    fetchList: async ({ context, signal }: SelectorQueryArgs) => {
      if (!context.host || !context.username || !context.password) return []
      const data = await requestJson(imapMailboxesContract, {
        body: {
          workflowId: context.workflowId!,
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
