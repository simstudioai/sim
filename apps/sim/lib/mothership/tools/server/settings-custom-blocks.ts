import { z } from 'zod'
import {
  settingsOperation,
  settingsWorkspaceId,
} from '@/lib/mothership/tools/server/settings-operation'
import {
  deleteCustomBlockSettings,
  publishCustomBlockSettings,
  readCustomBlockUsages,
  updateCustomBlockSettings,
} from '@/lib/workflows/custom-blocks/application/settings'
import {
  publishCustomBlockBodySchema,
  updateCustomBlockBodySchema,
} from '@/lib/workflows/custom-blocks/settings-input'

const blockInput = z.strictObject({ id: z.string().min(1).max(200) })
export const customBlockSettingsActions = {
  publish: settingsOperation(
    'write',
    publishCustomBlockBodySchema.omit({ workspaceId: true }).strict(),
    (context, input) =>
      publishCustomBlockSettings.execute({
        principal: context.principal,
        input: { ...input, workspaceId: settingsWorkspaceId(context) },
      })
  ),
  update: settingsOperation(
    'write',
    blockInput.extend({ patch: updateCustomBlockBodySchema.strict() }),
    (context, input) =>
      updateCustomBlockSettings.execute({
        principal: context.principal,
        input: { ...input, workspaceId: settingsWorkspaceId(context) },
      })
  ),
  delete: settingsOperation('write', blockInput, (context, input) =>
    deleteCustomBlockSettings.execute({
      principal: context.principal,
      input: { ...input, workspaceId: settingsWorkspaceId(context) },
    })
  ),
  usages: settingsOperation('read', blockInput, (context, input) =>
    readCustomBlockUsages.execute({
      principal: context.principal,
      input: { ...input, workspaceId: settingsWorkspaceId(context) },
    })
  ),
}
