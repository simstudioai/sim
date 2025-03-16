import { describe, expect, test } from 'vitest'

// A simple utility function to test
function addNumbers(a: number, b: number): number {
  return a + b
}

describe('Basic test suite', () => {
  test('addNumbers should correctly add two numbers', () => {
    expect(addNumbers(1, 2)).toBe(3)
    expect(addNumbers(-1, 1)).toBe(0)
    expect(addNumbers(0, 0)).toBe(0)
  })
})
