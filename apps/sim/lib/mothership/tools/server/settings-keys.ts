import { z } from 'zod'
import { updateWorkspaceApiKeyBodySchema } from '@/lib/api/contracts/api-keys'
import { deleteByokKeyBodySchema } from '@/lib/api/contracts/byok-keys'
import { deleteOrganizationByokKey } from '@/lib/api-key/application/organization-byok-keys'
import { revokePersonalApiKey } from '@/lib/api-key/application/personal-api-keys'
import {
  renameWorkspaceApiKey,
  revokeWorkspaceApiKey,
} from '@/lib/api-key/application/workspace-api-keys'
import { deleteWorkspaceByokKey } from '@/lib/api-key/application/workspace-byok-keys'
import {
  settingsOperation,
  settingsOrganizationId,
  settingsWorkspaceId,
} from '@/lib/mothership/tools/server/settings-operation'

const keyIdSchema = z.string().min(1).max(200)

export const personalKeySettingsActions = {
  revoke: settingsOperation('write', z.strictObject({ keyId: keyIdSchema }), (context, input) =>
    revokePersonalApiKey.execute({ principal: context.principal, input })
  ),
}
export const workspaceKeySettingsActions = {
  rename: settingsOperation(
    'write',
    updateWorkspaceApiKeyBodySchema.extend({ keyId: keyIdSchema }).strict(),
    async (context, input) => ({
      key: (
        await renameWorkspaceApiKey.execute({
          principal: context.principal,
          input: { ...input, workspaceId: settingsWorkspaceId(context) },
        })
      ).key,
    })
  ),
  revoke: settingsOperation(
    'write',
    z.strictObject({ keyId: keyIdSchema }),
    async (context, input) => ({
      success: (
        await revokeWorkspaceApiKey.execute({
          principal: context.principal,
          input: { ...input, workspaceId: settingsWorkspaceId(context) },
        })
      ).success,
    })
  ),
}
export const organizationByokSettingsActions = {
  revoke: settingsOperation('write', deleteByokKeyBodySchema.strict(), (context, input) =>
    deleteOrganizationByokKey.execute({
      principal: context.principal,
      input: { ...input, organizationId: settingsOrganizationId(context) },
    })
  ),
}

export const workspaceByokSettingsActions = {
  revoke: settingsOperation('write', deleteByokKeyBodySchema.strict(), (context, input) =>
    deleteWorkspaceByokKey.execute({
      principal: context.principal,
      input: { ...input, workspaceId: settingsWorkspaceId(context) },
    })
  ),
}
