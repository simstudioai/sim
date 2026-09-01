/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockRandomItem } = vi.hoisted(() => ({
  mockRandomItem: vi.fn(),
}))

vi.mock('@sim/utils/random', () => ({
  randomItem: mockRandomItem,
}))

import { generateCreativeWorkflowName } from '@/stores/workflows/registry/utils'

function captureNamesForLength(targetLength: number): readonly string[] {
  let names: readonly string[] = []

  mockRandomItem.mockImplementation((items: readonly unknown[]) => {
    if (typeof items[0] === 'number') return targetLength

    names = items as readonly string[]
    return names[0]
  })

  generateCreativeWorkflowName()
  return names
}

describe('generateCreativeWorkflowName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('prefers seven-letter names, then six-letter names, then progressively longer totals', () => {
    let lengthChoices: readonly number[] = []

    mockRandomItem.mockImplementation((items: readonly unknown[]) => {
      if (typeof items[0] === 'number') {
        lengthChoices = items as readonly number[]
        return 7
      }

      return items[0]
    })

    generateCreativeWorkflowName()

    const weightFor = (length: number) => lengthChoices.filter((choice) => choice === length).length

    expect(new Set(lengthChoices)).toEqual(new Set([6, 7, 8, 9, 10]))
    expect(weightFor(7)).toBeGreaterThan(weightFor(6))
    expect(weightFor(6)).toBeGreaterThan(weightFor(8))
    expect(weightFor(8)).toBeGreaterThan(weightFor(9))
    expect(weightFor(9)).toBeGreaterThan(weightFor(10))
  })

  it('only offers short machine-nature pairs within the selected total length', () => {
    const machineWords = new Set<string>()
    const natureWords = new Set<string>()
    const names = [6, 7, 8, 9, 10].flatMap((targetLength) => {
      const candidates = captureNamesForLength(targetLength)

      expect(candidates.length).toBeGreaterThan(0)
      for (const candidate of candidates) {
        const [machine, nature, extra] = candidate.split('-')
        expect(extra).toBeUndefined()
        expect(machine).toMatch(/^[a-z]+$/)
        expect(nature).toMatch(/^[a-z]+$/)
        expect(machine.length).toBeLessThanOrEqual(5)
        expect(nature.length).toBeLessThanOrEqual(5)
        expect(machine.length + nature.length).toBe(targetLength)
        machineWords.add(machine)
        natureWords.add(nature)
      }

      return candidates
    })

    expect(names).toEqual(
      expect.arrayContaining([
        'city-grove',
        'bolt-ivy',
        'cog-tree',
        'gpu-moss',
        'beam-bird',
        'gear-moon',
        'cell-bug',
        'token-fruit',
        'beam-root',
        'gear-snow',
      ])
    )
    for (const excludedWord of [
      'auto',
      'boot',
      'bus',
      'cam',
      'car',
      'cart',
      'host',
      'jet',
      'nut',
      'plug',
      'rig',
      'saw',
      'ship',
      'train',
      'tram',
      'van',
      'vent',
    ]) {
      expect(machineWords.has(excludedWord)).toBe(false)
    }
    for (const excludedWord of ['bear', 'bush', 'cave', 'cow', 'goat', 'horse', 'mud', 'whale']) {
      expect(natureWords.has(excludedWord)).toBe(false)
    }
    expect(names).toHaveLength(6_435)
    expect(new Set(names).size).toBe(names.length)
  })
})
