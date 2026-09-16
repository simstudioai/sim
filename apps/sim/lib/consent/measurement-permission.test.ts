/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi } from 'vitest'
import {
  getStoredMeasurementPermission,
  subscribeStoredMeasurementPermission,
} from '@/lib/consent/measurement-permission'

function save(consents: { measurement: boolean; marketing: boolean }) {
  const newValue = JSON.stringify({ consents })
  localStorage.setItem('c15t', newValue)
  window.dispatchEvent(new StorageEvent('storage', { key: 'c15t', newValue }))
}

describe('stored measurement permission', () => {
  it('distinguishes initial absence, withdrawal, deletion, and a new grant', () => {
    localStorage.clear()
    expect(getStoredMeasurementPermission()).toBe(true)
    const onChange = vi.fn()
    const unsubscribe = subscribeStoredMeasurementPermission(onChange)
    window.dispatchEvent(new StorageEvent('storage', { key: 'theme', newValue: 'dark' }))
    expect(onChange).not.toHaveBeenCalled()
    save({ measurement: true, marketing: true })
    expect(getStoredMeasurementPermission()).toBe(true)
    save({ measurement: true, marketing: false })
    expect(getStoredMeasurementPermission()).toBe(true)
    save({ measurement: false, marketing: false })
    expect(getStoredMeasurementPermission()).toBe(false)
    localStorage.removeItem('c15t')
    window.dispatchEvent(new StorageEvent('storage', { key: 'c15t' }))
    expect(getStoredMeasurementPermission()).toBe(false)
    save({ measurement: true, marketing: false })
    expect(getStoredMeasurementPermission()).toBe(true)
    unsubscribe()
    onChange.mockClear()
    save({ measurement: false, marketing: false })
    expect(onChange).not.toHaveBeenCalled()
    localStorage.clear()
  })

  it.each(['invalid', '{}', '{"consents":{"measurement":"true"}}'])(
    'denies malformed storage: %s',
    (value) => {
      localStorage.setItem('c15t', value)
      expect(getStoredMeasurementPermission()).toBe(false)
      localStorage.clear()
    }
  )
})
