import { describe, expect, it, vi } from 'vitest'
import { clearRedisMocks, createMockRedis } from './redis.mock'

describe('createMockRedis events', () => {
  it('dispatches an emitted event to its registered listeners', () => {
    const redis = createMockRedis()
    const onReady = vi.fn()
    redis.on('ready', onReady)

    expect(redis.emit('ready')).toBe(true)
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('reports no delivery when nothing is listening', () => {
    expect(createMockRedis().emit('ready')).toBe(false)
  })

  it('stops delivering to a removed listener', () => {
    const redis = createMockRedis()
    const onReady = vi.fn()
    redis.on('ready', onReady)
    redis.removeListener('ready', onReady)

    redis.emit('ready')
    expect(onReady).not.toHaveBeenCalled()
  })

  it('lets a listener remove itself while the event is dispatching', () => {
    const redis = createMockRedis()
    const onReady = vi.fn(() => redis.removeListener('ready', onReady))
    redis.on('ready', onReady)

    expect(() => redis.emit('ready')).not.toThrow()
    redis.emit('ready')
    expect(onReady).toHaveBeenCalledOnce()
  })

  it('drops every listener on removeAllListeners', () => {
    const redis = createMockRedis()
    const onReady = vi.fn()
    const onError = vi.fn()
    redis.on('ready', onReady)
    redis.on('error', onError)

    redis.removeAllListeners()

    redis.emit('ready')
    redis.emit('error')
    expect(onReady).not.toHaveBeenCalled()
    expect(onError).not.toHaveBeenCalled()
  })

  it('drops only the named event when one is given', () => {
    const redis = createMockRedis()
    const onReady = vi.fn()
    const onError = vi.fn()
    redis.on('ready', onReady)
    redis.on('error', onError)

    redis.removeAllListeners('ready')

    redis.emit('ready')
    redis.emit('error')
    expect(onReady).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledOnce()
  })

  it('clears listeners alongside spy history, not just spy history', () => {
    // Handlers left behind would be invoked by a later emit on behalf of a
    // client the test under way never created.
    const redis = createMockRedis()
    const onReady = vi.fn()
    redis.on('ready', onReady)

    clearRedisMocks(redis)

    expect(redis.emit('ready')).toBe(false)
    expect(onReady).not.toHaveBeenCalled()
  })

  it('keeps listeners scoped to the instance that registered them', () => {
    const a = createMockRedis()
    const b = createMockRedis()
    const onA = vi.fn()
    a.on('ready', onA)

    b.emit('ready')
    expect(onA).not.toHaveBeenCalled()
  })
})
