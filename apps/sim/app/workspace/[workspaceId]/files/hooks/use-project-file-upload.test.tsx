/** @vitest-environment jsdom */

import { act } from 'react'
import { createDeferred } from '@sim/testing/helpers/deferred'
import { nextNavigationMock } from '@sim/testing/mocks/next-navigation.mock'
import { createRoot } from 'react-dom/client'
import { expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ mutateAsync: vi.fn() }))
vi.mock('@/hooks/queries/project-files', () => ({
  useUploadProjectFile: () => ({ mutateAsync: mocks.mutateAsync }),
}))
vi.mock('next/navigation', () => nextNavigationMock)

import { useProjectFileUpload } from '@/app/workspace/[workspaceId]/files/hooks/use-project-file-upload'

interface UploadProbeProps {
  canWrite: boolean
  onStart: (completion: Promise<void>) => void
}

function UploadProbe({ canWrite, onStart }: UploadProbeProps) {
  const { uploadFiles } = useProjectFileUpload({ projectId: 'project-upload', canWrite })
  return (
    <button
      type='button'
      onClick={() => onStart(uploadFiles([new File(['draft'], 'notes.md')], null))}
    >
      Upload
    </button>
  )
}

it('aborts the current upload when Project write access is revoked', async () => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const pending = createDeferred<void>()
  const started = createDeferred<AbortSignal>()
  mocks.mutateAsync.mockImplementation(({ signal }: { signal: AbortSignal }) => {
    started.resolve(signal)
    return pending.promise
  })
  const container = document.createElement('div')
  document.body.appendChild(container)
  const root = createRoot(container)
  let completion: Promise<void> | undefined
  const onStart = (upload: Promise<void>) => {
    completion = upload
  }
  try {
    act(() => root.render(<UploadProbe canWrite onStart={onStart} />))
    act(() => container.querySelector('button')?.click())
    const signal = await started.promise
    expect(signal.aborted).toBe(false)

    act(() => root.render(<UploadProbe canWrite={false} onStart={onStart} />))
    expect(signal.aborted).toBe(true)
  } finally {
    await act(async () => {
      pending.resolve()
      await completion
    })
    act(() => root.unmount())
    container.remove()
  }
})
