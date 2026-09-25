import { describe, expect, it, vi } from 'vitest'

vi.mock('@/lib/core/config/env', () => ({ env: { ENCRYPTION_KEY: 'ab'.repeat(32) } }))

import {
  decryptMemoryCheckpoint,
  encryptMemoryCheckpoint,
  MAX_MEMORY_CHECKPOINT_BYTES,
  projectableMemoryCheckpoint,
} from '@/lib/memory/checkpoint-codec'

describe('private memory checkpoint encoding', () => {
  it('round-trips ciphertext close to the size limit, including its authentication overhead', async () => {
    const value = { data: 'x'.repeat(MAX_MEMORY_CHECKPOINT_BYTES - 200) }
    const encrypted = await encryptMemoryCheckpoint(value)
    expect(Buffer.byteLength(encrypted)).toBeLessThan(4 * 1024 * 1024)
    expect(await decryptMemoryCheckpoint(encrypted)).toEqual(value)
  })

  it('bounds traversal and does not invoke accessors or custom serializers', async () => {
    const getter = vi.fn(() => 'secret')
    const accessor = Object.defineProperty({}, 'value', { enumerable: true, get: getter })
    const toJSON = vi.fn(() => 'secret')
    const cycle: Record<string, unknown> = {}
    cycle.self = cycle
    for (const value of [
      accessor,
      { toJSON },
      cycle,
      Array(100_001),
      new Uint8Array(MAX_MEMORY_CHECKPOINT_BYTES),
    ]) {
      await expect(encryptMemoryCheckpoint(value)).rejects.toThrow()
    }
    expect(getter).not.toHaveBeenCalled()
    expect(toJSON).not.toHaveBeenCalled()
  })

  it('provides a JSON-safe projection and handles a root byte value', async () => {
    const bytes = new Uint8Array([1, 2, 3])
    expect(projectableMemoryCheckpoint({ bytes }).data).toEqual({ bytes: null })
    expect(await decryptMemoryCheckpoint(await encryptMemoryCheckpoint(bytes))).toEqual(bytes)
  })

  it('round-trips a large binary signature within the same byte budget', async () => {
    const bytes = new Uint8Array(1024 * 1024).fill(255)
    const restored = (await decryptMemoryCheckpoint(await encryptMemoryCheckpoint({ bytes }))) as {
      bytes: Uint8Array
    }
    expect(restored).toEqual({ bytes: expect.any(Uint8Array) })
    expect(restored.bytes.byteLength).toBe(bytes.byteLength)
    expect(
      Buffer.from(
        restored.bytes.buffer,
        restored.bytes.byteOffset,
        restored.bytes.byteLength
      ).equals(Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength))
    ).toBe(true)
  })

  it('encrypts private signatures and preserves binary state without interpreting user JSON', async () => {
    const value = {
      version: 1,
      signature: 'private-provider-signature',
      bytes: new Uint8Array([0, 7, 255]),
      modelArguments: { __bytes: 'not-a-special-tag', type: 'Buffer', data: [1, 2] },
    }
    const encrypted = await encryptMemoryCheckpoint(value)
    expect(encrypted).not.toContain('private-provider-signature')
    expect(await decryptMemoryCheckpoint(encrypted)).toEqual(value)
  })

  it('rejects altered ciphertext and oversized plaintext before decryption', async () => {
    const encrypted = await encryptMemoryCheckpoint({ private: 'value' })
    /** Always change the auth tag's last hex digit; overwriting it with a fixed value can be a no-op. */
    const tampered = `${encrypted.slice(0, -1)}${encrypted.endsWith('0') ? '1' : '0'}`
    expect(tampered).not.toBe(encrypted)
    await expect(decryptMemoryCheckpoint(tampered)).rejects.toThrow()
    await expect(encryptMemoryCheckpoint({ output: 'a'.repeat(3 * 1024 * 1024) })).rejects.toThrow(
      'byte limit'
    )
    await expect(decryptMemoryCheckpoint('a'.repeat(7 * 1024 * 1024))).rejects.toThrow('byte limit')
  })
})
