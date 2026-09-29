import { z } from 'zod'
import {
  createDashboardBodySchema,
  createDashboardFolderBodySchema,
  moveDashboardBodySchema,
  moveDashboardFolderBodySchema,
  updateDashboardBodySchema,
} from '@/lib/api/contracts/dashboards'

const scope = z.object({ workspaceId: z.string().min(1).max(100).optional() })
const target = scope.extend({ dashboardId: z.string().min(1).max(100) })
export const mothershipDashboardsInputSchema = z.discriminatedUnion('action', [
  scope.extend({ action: z.literal('list'), search: z.string().max(255).optional() }).strict(),
  target.extend({ action: z.literal('get') }).strict(),
  scope.extend({ ...createDashboardBodySchema.shape, action: z.literal('create') }).strict(),
  target.extend({ ...updateDashboardBodySchema.shape, action: z.literal('update') }).strict(),
  target.extend({ ...moveDashboardBodySchema.shape, action: z.literal('move') }).strict(),
  target.extend({ action: z.literal('delete') }).strict(),
])
export const mothershipDashboardFoldersInputSchema = z.discriminatedUnion('action', [
  scope.extend({ action: z.literal('list') }).strict(),
  scope.extend({ ...createDashboardFolderBodySchema.shape, action: z.literal('create') }).strict(),
  scope.extend({ ...moveDashboardFolderBodySchema.shape, action: z.literal('move') }).strict(),
  scope.extend({ ...createDashboardFolderBodySchema.shape, action: z.literal('delete') }).strict(),
])
