import { dbChainMockFns } from '@sim/testing'
import { billingStorageMock } from '@sim/testing/mocks/billing-storage.mock'
import { realtimeNotifyMock } from '@sim/testing/mocks/realtime-notify.mock'
import { storageServiceMock, storageServiceMockFns } from '@sim/testing/mocks/storage-service.mock'
import { uploadsMock } from '@sim/testing/mocks/uploads.mock'
import {
  workspaceFileFoldersMock,
  workspaceFileFoldersMockFns,
} from '@sim/testing/mocks/workspace-file-folders.mock'
import { beforeEach, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => {
  const values = vi.fn()
  const insert = vi.fn(() => ({
    values: (metadata: Record<string, unknown>) => {
      values(metadata)
      return { onConflictDoNothing: () => ({ returning: async () => [metadata] }) }
    },
  }))
  return { values, insert }
})
vi.mock('@/lib/billing/storage', () => billingStorageMock)
vi.mock('@/lib/folders/locks', () => ({ acquireFolderMutationLock: vi.fn() }))
vi.mock('@/lib/realtime/notify', () => realtimeNotifyMock)
vi.mock('@/lib/uploads', () => uploadsMock)
vi.mock('@/lib/uploads/core/storage-service', () => storageServiceMock)
vi.mock(
  '@/lib/uploads/contexts/workspace/workspace-file-folder-manager',
  () => workspaceFileFoldersMock
)

import { createWorkspaceFileBodySchema } from '@/lib/api/contracts/workspace-files'
import { uploadWorkspaceFile } from '@/lib/uploads/contexts/workspace/workspace-file-manager'
import { compileSimPage, SIM_PAGE_CONTENT_TYPE } from '@/lib/workspace-files/page-compile'

workspaceFileFoldersMockFns.mockBuildWorkspaceFileFolderPathMap.mockImplementation(() => new Map())
workspaceFileFoldersMockFns.mockNormalizeWorkspaceFileItemName.mockImplementation(
  (name: string) => name
)

const mockUpload = storageServiceMockFns.mockUploadFile

beforeEach(() => {
  dbChainMockFns.transaction.mockImplementation(
    async (run: (tx: { insert: typeof mocks.insert }) => Promise<unknown>) =>
      run({ insert: mocks.insert })
  )
  mockUpload.mockImplementation(async ({ fileName }: { fileName: string }) => ({ key: fileName }))
})

it('registers agent-authored Page source as a native Page and preserves editable source', async () => {
  const input = createWorkspaceFileBodySchema.parse({
    name: 'Team handbook.html',
    contentType: 'text/html',
    content: '---\ntitle: Team handbook\n---\n# Getting started\nRead the schedule.',
  })
  const bytes = Buffer.from(input.content)
  const file = await uploadWorkspaceFile(
    'workspace',
    'author',
    bytes,
    input.name,
    input.contentType!,
    { exactName: true }
  )
  expect(file).toMatchObject({
    name: 'Team handbook',
    type: SIM_PAGE_CONTENT_TYPE,
    size: bytes.length,
  })
  expect(mocks.values).toHaveBeenCalledWith(
    expect.objectContaining({ originalName: 'Team handbook', contentType: SIM_PAGE_CONTENT_TYPE })
  )
  expect(mockUpload).toHaveBeenCalledWith(
    expect.objectContaining({ file: bytes, contentType: SIM_PAGE_CONTENT_TYPE })
  )
  expect(compileSimPage(input.content)).toContain('Team handbook')
})

it('keeps a complete HTML document as HTML rather than mislabeling it a native Page', async () => {
  const bytes = Buffer.from('<!DOCTYPE html><html><body>Custom report</body></html>')
  const file = await uploadWorkspaceFile('workspace', 'author', bytes, 'report.html', 'text/html', {
    exactName: true,
  })
  expect(file).toMatchObject({ name: 'report.html', type: 'text/html' })
  expect(mocks.values).toHaveBeenCalledWith(
    expect.objectContaining({ originalName: 'report.html', contentType: 'text/html' })
  )
})
