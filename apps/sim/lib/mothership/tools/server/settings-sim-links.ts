import { z } from 'zod'
import { listSimLinksQuerySchema } from '@/lib/api/contracts/sim-links'
import { presentSimLink, presentSimLinkPage } from '@/lib/api/server/sim-link-presenters'
import type { SettingsContext } from '@/lib/mothership/application/settings-context'
import {
  settingsOperation,
  settingsOrganizationId,
} from '@/lib/mothership/tools/server/settings-operation'
import {
  createSimLink,
  deleteSimLink,
  getSimLinkView,
  listSimLinks,
  updateSimLink,
} from '@/lib/sim-links/application/use-cases'
import { simLinkFieldsSchema } from '@/lib/sim-links/validation'

const linkId = z.string().min(1).max(255)

/** The first page of links this member may browse, or the page `query` selects. */
export async function readSettingsSimLinks(
  context: SettingsContext,
  query: z.output<typeof listSimLinksQuerySchema> = {}
) {
  return presentSimLinkPage(
    await listSimLinks.execute({
      principal: context.principal,
      input: { ...query, organizationId: settingsOrganizationId(context) },
    })
  )
}

/** Per-link edit, unlist and restrict rules, audit and the rollout flag stay in the use cases. */
export const simLinkSettingsActions = {
  list: settingsOperation('read', listSimLinksQuerySchema, readSettingsSimLinks),
  get: settingsOperation(
    'read',
    z.union([
      z.strictObject({ linkId }),
      z.strictObject({
        name: z
          .string()
          .trim()
          .min(1)
          .max(255)
          .describe('The name as typed, with or without a sim/ or go/ prefix'),
      }),
    ]),
    async (context, input) =>
      presentSimLink(
        await getSimLinkView.execute({
          principal: context.principal,
          input: {
            organizationId: settingsOrganizationId(context),
            ...('linkId' in input ? { linkId: input.linkId } : { name: input.name }),
          },
        })
      )
  ),
  create: settingsOperation('write', simLinkFieldsSchema, async (context, fields) =>
    presentSimLink(
      await createSimLink.execute({
        principal: context.principal,
        input: { ...fields, organizationId: settingsOrganizationId(context) },
      })
    )
  ),
  update: settingsOperation(
    'write',
    z.strictObject({
      linkId,
      fields: simLinkFieldsSchema.describe(
        'Every field of the link as it should be saved; read it with get first'
      ),
    }),
    async (context, input) =>
      presentSimLink(
        await updateSimLink.execute({
          principal: context.principal,
          input: {
            ...input.fields,
            linkId: input.linkId,
            organizationId: settingsOrganizationId(context),
          },
        })
      )
  ),
  delete: settingsOperation('write', z.strictObject({ linkId }), async (context, input) => ({
    deleted: (
      await deleteSimLink.execute({
        principal: context.principal,
        input: { ...input, organizationId: settingsOrganizationId(context) },
      })
    ).id,
  })),
}
