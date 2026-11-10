/**
 * @vitest-environment jsdom
 *
 * The service-account setup a block's credential picker offers. Failure modes: a picker offers
 * "Add …" for a provider the Platform has no setup dialog for (AWS and Databricks saved
 * credentials), so the action opens nothing; and the guard over-reaches and hides a provider the
 * shared dialog can add.
 */
import { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useServiceAccountTarget } from '@/platform/lib/data/workflow-editor/selectors/use-service-account-target'

let root: Root
let target: ReturnType<typeof useServiceAccountTarget> | undefined

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  target = undefined
  root = createRoot(document.createElement('div'))
})

afterEach(() => {
  act(() => root.unmount())
})

function resolve(serviceId: string) {
  function Probe() {
    target = useServiceAccountTarget(serviceId, true)
    return null
  }
  act(() => root.render(<Probe />))
  return target
}

it.each(['aws', 'databricks'])(
  'offers no setup for %s, which has no Platform dialog',
  (service) => {
    expect(resolve(service)).toBeNull()
  }
)

it('still offers the setup for a pasted-token service account', () => {
  expect(resolve('fireflies')?.serviceAccountProviderId).toBe('fireflies-service-account')
})
