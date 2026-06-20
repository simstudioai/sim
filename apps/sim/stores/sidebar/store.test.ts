/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it } from 'vitest'
import { readCollapsedCookie } from './store'

function setCookie(value: string) {
  document.cookie = `sidebar_collapsed=${value}; path=/`
}

afterEach(() => {
  document.cookie = 'sidebar_collapsed=; path=/; max-age=0'
})

describe('readCollapsedCookie', () => {
  it('is true only for an exact value of 1', () => {
    setCookie('1')
    expect(readCollapsedCookie()).toBe(true)
  })

  it('is false for 0', () => {
    setCookie('0')
    expect(readCollapsedCookie()).toBe(false)
  })

  it('does not treat a substring value like 10 as collapsed', () => {
    setCookie('10')
    expect(readCollapsedCookie()).toBe(false)
  })

  it('is false when the cookie is absent', () => {
    expect(readCollapsedCookie()).toBe(false)
  })
})
