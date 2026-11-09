import { afterEach, describe, expect, it } from 'vitest'
import { useInFlightUploadsStore } from '@/stores/in-flight-uploads/store'

const count = () => useInFlightUploadsStore.getState().count

afterEach(() => {
  useInFlightUploadsStore.setState({ count: 0 })
})

describe('in-flight uploads', () => {
  it('keeps guarding another upload when one release runs twice', () => {
    const { begin } = useInFlightUploadsStore.getState()
    const first = begin()
    begin()
    first()
    first()
    expect(count()).toBe(1)
  })
})
