/**
 * @vitest-environment jsdom
 *
 * Uploads that need cloud storage explain themselves to the person using the block. Failure mode:
 * the notice telling a user to set server environment variables they cannot reach.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'

vi.mock(
  '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-picker',
  () => ({ FilePicker: () => null })
)
vi.mock('@/platform/lib/data/workflow-editor/uploads', () => ({
  formatUploadedFileSize: () => '',
  useFileUpload: () => ({
    files: [],
    uploadingFiles: [],
    picker: {},
    showCloudStorageWarning: true,
    showFolderScopeNotice: false,
    uploadError: null,
    uploadBlocked: true,
  }),
}))

import { FileUpload } from '@/app/(product)/workspace/[workspaceId]/workflows/_components/editor/file-upload/file-upload'

let container: HTMLDivElement
let root: Root

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
})

afterEach(() => {
  act(() => root.unmount())
  container.remove()
})

it('explains missing file storage without naming server configuration', () => {
  act(() => root.render(<FileUpload blockId='block' subBlockId='file' requiresCloudStorage />))
  expect(container.textContent).toContain('Ask your administrator to set up file storage.')
  expect(container.textContent).not.toMatch(/S3_BUCKET_NAME|AWS_REGION|env vars/)
})
