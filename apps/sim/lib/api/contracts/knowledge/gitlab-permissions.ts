import { z } from 'zod'
import { PERMISSION_IMPORT_MAX_ROWS } from '@/lib/knowledge/connectors/permission-import-limits'
import { GITLAB_PERMISSION_MODES } from '@/connectors/gitlab/permission-config/types'

const gitLabCsvUploadSchema = z
  .object({
    filename: z.string().trim().min(1).max(255).describe('CSV filename without path separators.'),
    content: z
      .string()
      .min(1)
      .describe(
        'UTF-8 CSV contents, up to 8 MiB. Both files travel in one request body limited to 10 MiB after JSON encoding.'
      ),
  })
  .strict()
export const gitLabPermissionInputSchema = z
  .object({
    provider: z.literal('gitlab').describe('Provider of the configured Search source.'),
    mode: z
      .enum(GITLAB_PERMISSION_MODES)
      .describe('Administrator lookup or externally managed CSV permissions.'),
    expectedRevision: z
      .number()
      .int()
      .nonnegative()
      .describe('Current permission revision obtained before generating this snapshot.')
      .optional(),
    userMapping: gitLabCsvUploadSchema
      .describe('GitLab user IDs and their verified Sim email addresses.')
      .optional(),
    projectPermissions: gitLabCsvUploadSchema
      .describe('GitLab project paths and the IDs of users granted access.')
      .optional(),
  })
  .strict()
export type GitLabPermissionUploadInput = z.input<typeof gitLabPermissionInputSchema>
const gitLabCsvFileSummarySchema = z.object({
  filename: z.string().min(1).max(255).describe('Uploaded CSV filename.'),
  uploadedAt: z.string().datetime().describe('Upload time in UTC.'),
  rowCount: z
    .number()
    .int()
    .nonnegative()
    .max(PERMISSION_IMPORT_MAX_ROWS)
    .describe('Number of uploaded data records.'),
})
export const gitLabPermissionSummarySchema = z.object({
  provider: z.literal('gitlab').describe('Permission provider.'),
  mode: z
    .enum(GITLAB_PERMISSION_MODES)
    .describe('Administrator lookup or externally managed CSV permissions.'),
  revision: z.number().int().nonnegative().describe('Current revision of the stored permissions.'),
  userMapping: gitLabCsvFileSummarySchema
    .nullable()
    .describe('User mapping file summary, or null when not supplied.'),
  projectPermissions: gitLabCsvFileSummarySchema
    .nullable()
    .describe('Project permission file summary, or null when not supplied.'),
})
export type GitLabPermissionData = z.output<typeof gitLabPermissionSummarySchema>
