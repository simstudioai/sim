import { defineAuthorizedWorkspaceUseCase } from '@/lib/core/application'
import { defineWorkspaceOperation } from '@/lib/core/application/workspace-operation'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import {
  type InboxSettingsPatch,
  inboxSettingsPatchSchema,
} from '@/lib/mothership/inbox/settings-input'
import {
  readInboxSettingsRecord,
  updateInboxSettingsRecord,
} from '@/lib/mothership/inbox/settings-store'
import { resolveActiveWorkspaceApplicationContext } from '@/lib/workspaces/application/workspace-context'

export const inboxSettingsOperations = {
  read: defineWorkspaceOperation({
    id: 'workspace_inbox.read',
    minimumRole: 'read',
    capability: 'inbox.use',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
  update: defineWorkspaceOperation({
    id: 'workspace_inbox.update',
    minimumRole: 'admin',
    capability: 'inbox.use',
    workspaceApiKey: 'deny',
    principalKinds: ['session', 'delegated'],
    delegatedServices: ['copilot'],
  }),
} as const

interface InboxSettingsInput {
  workspaceId: string
}
interface UpdateInboxSettingsInput extends InboxSettingsInput {
  patch: InboxSettingsPatch
}
const authorizationOptions = { delegation: { audience: 'sim:settings', isWithinScope: () => true } }
const resolveContext = ({ input }: { input: InboxSettingsInput }) =>
  resolveActiveWorkspaceApplicationContext(input.workspaceId)

export const readInboxSettings = defineAuthorizedWorkspaceUseCase({
  operation: inboxSettingsOperations.read,
  resolveContext,
  authorizationOptions,
  execute: ({ context }) => readInboxSettingsRecord(context.workspaceId),
})

export const updateInboxSettings = defineAuthorizedWorkspaceUseCase({
  operation: inboxSettingsOperations.update,
  resolveContext: ({ input }: { input: UpdateInboxSettingsInput }) => resolveContext({ input }),
  authorizationOptions,
  execute: ({ context, input }) => {
    const parsed = inboxSettingsPatchSchema.safeParse(input.patch)
    if (!parsed.success) throw new OrchestrationError('validation', parsed.error.issues[0].message)
    return updateInboxSettingsRecord(context.workspaceId, parsed.data)
  },
})
