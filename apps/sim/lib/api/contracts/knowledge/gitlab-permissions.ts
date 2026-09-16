import { z } from 'zod'
import {
  GITLAB_CSV_MAX_BYTES,
  GITLAB_PERMISSION_MODES,
} from '@/connectors/gitlab/permission-config/types'

const gitLabCsvUploadSchema = z
  .object({
    filename: z.string().trim().min(1).max(255),
    content: z.string().min(1).max(GITLAB_CSV_MAX_BYTES),
  })
  .strict()
export const gitLabPermissionInputSchema = z
  .object({
    provider: z.literal('gitlab'),
    mode: z.enum(GITLAB_PERMISSION_MODES),
    expectedRevision: z.number().int().nonnegative().optional(),
    userMapping: gitLabCsvUploadSchema.optional(),
    projectPermissions: gitLabCsvUploadSchema.optional(),
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
  revision: z.number().int().nonnegative(),
  userMapping: gitLabCsvFileSummarySchema.nullable(),
  projectPermissions: gitLabCsvFileSummarySchema.nullable(),
})
export type GitLabPermissionData = z.output<typeof gitLabPermissionSummarySchema>
