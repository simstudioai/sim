import { afterEach, describe, expect, it } from 'vitest'
import { trackUpload, useInFlightUploadsStore } from '@/stores/in-flight-uploads/store'

const count = () => useInFlightUploadsStore.getState().count

afterEach(() => {
  useInFlightUploadsStore.setState({ count: 0 })
})

describe('in-flight uploads', () => {
  it('stops guarding a failed upload, so a later close is not held forever', async () => {
    await expect(trackUpload(() => Promise.reject(new Error('storage limit')))).rejects.toThrow(
      'storage limit'
    )
    expect(count()).toBe(0)
  })

  it('keeps guarding another upload when one release runs twice', () => {
    const { begin } = useInFlightUploadsStore.getState()
    const first = begin()
    begin()
    first()
    first()
    expect(count()).toBe(1)
  })
})
