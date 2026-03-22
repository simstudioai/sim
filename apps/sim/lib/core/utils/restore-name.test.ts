/**
 * @vitest-environment node
 */
import { describe, expect, it, vi } from 'vitest'
import { generateRestoreName } from '@/lib/core/utils/restore-name'

describe('generateRestoreName', () => {
  it('returns original when unused', async () => {
    const nameExists = vi.fn().mockResolvedValue(false)
    await expect(generateRestoreName('doc.pdf', nameExists, { hasExtension: true })).resolves.toBe(
      'doc.pdf'
    )
    expect(nameExists).toHaveBeenCalledWith('doc.pdf')
  })

  it('uses _restored suffix when original is taken', async () => {
    const nameExists = vi
      .fn()
      .mockImplementation(async (name: string) => name === 'Notes' || name === 'Notes_restored')

    await expect(generateRestoreName('Notes', nameExists)).resolves.toMatch(
      /^Notes_restored_[a-f0-9]{6}$/
    )
  })

  it('throws after max hash attempts when all candidates exist', async () => {
    const nameExists = vi.fn().mockResolvedValue(true)
    await expect(generateRestoreName('x', nameExists)).rejects.toThrow(
      'Could not generate a unique restore name'
    )
  })
})
