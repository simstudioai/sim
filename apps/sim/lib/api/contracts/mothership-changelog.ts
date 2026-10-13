import { z } from 'zod'
import {
  changelogBumpReasonSchema,
  changelogChangesInputSchema,
  changelogRevisionSchema,
  changelogTitleSchema,
  changelogVersionSchema,
} from '@/lib/api/contracts/changelog'

const scope = z.object({ workspaceId: z.string().min(1).max(100).optional() })
const releaseIdSchema = z.string().min(1).max(128).describe('The release id from list or publish.')

/** Publish and edit the workspace changelog. Release bodies live in `changelog/<id>.md`. */
export const mothershipChangelogInputSchema = z.discriminatedUnion('action', [
  scope
    .extend({
      action: z.literal('list'),
      cursor: z.string().min(1).max(256).optional().describe('nextCursor from the previous list.'),
    })
    .strict(),
  scope.extend({ action: z.literal('get'), releaseId: releaseIdSchema }).strict(),
  scope
    .extend({
      action: z.literal('publish'),
      title: changelogTitleSchema.describe('The release headline: what people get, not how.'),
      body: z
        .string()
        .min(1)
        .max(256 * 1024)
        .describe(
          'Markdown body: a short summary, then evidence (```dashboard embeds for impact charts and stats).'
        ),
      bump: z
        .enum(['major', 'minor', 'patch'])
        .describe(
          'How significant the release is. The server computes the version from the highest one.'
        ),
      bumpReason: changelogBumpReasonSchema,
      changes: changelogChangesInputSchema.min(1),
    })
    .strict(),
  scope
    .extend({
      action: z.literal('update'),
      releaseId: releaseIdSchema,
      expectedRevision: changelogRevisionSchema.describe(
        'The revision from get, list, or publish.'
      ),
      title: changelogTitleSchema.optional(),
      bumpReason: changelogBumpReasonSchema.optional(),
      version: changelogVersionSchema.optional(),
      changes: changelogChangesInputSchema
        .optional()
        .describe('Replaces every change line of the release.'),
    })
    .strict(),
])
