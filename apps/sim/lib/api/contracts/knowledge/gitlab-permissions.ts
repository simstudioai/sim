import { z } from 'zod'
import {
  GITLAB_CSV_MAX_BYTES,
  GITLAB_PERMISSION_MODES,
} from '@/connectors/gitlab/permission-config/types'

const gitLabCsvUploadSchema = z
  .object({
    filename: z.string().trim().min(1).max(255).describe('CSV filename without path separators.'),
    content: z
      .string()
      .min(1)
      .max(GITLAB_CSV_MAX_BYTES)
      .describe(
        'UTF-8 CSV contents, up to 4 MiB. Both files travel in one request body limited to 10 MiB after JSON encoding.'
      ),
  })
  .strict()
export const gitLabPermissionInputSchema = z
  .object({
    provider: z.literal('gitlab').describe('Provider of the configured Search source.'),
    mode: z.enum(GITLAB_PERMISSION_MODES),
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
  filename: z.string().min(1).max(255),
  uploadedAt: z.string().datetime(),
  rowCount: z.number().int().nonnegative().max(100_000),
})
export const gitLabPermissionSummarySchema = z.object({
  provider: z.literal('gitlab'),
  mode: z.enum(GITLAB_PERMISSION_MODES),
  revision: z.number().int().nonnegative().describe('Current revision of the stored permissions.'),
  userMapping: gitLabCsvFileSummarySchema.nullable(),
  projectPermissions: gitLabCsvFileSummarySchema.nullable(),
})
export type GitLabPermissionData = z.output<typeof gitLabPermissionSummarySchema>
