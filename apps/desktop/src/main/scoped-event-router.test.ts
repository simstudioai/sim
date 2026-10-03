import type { WebContents } from 'electron'
import { describe, expect, it, vi } from 'vitest'
import { ScopedEventRouter } from '@/main/scoped-event-router'

type EventListener = (...args: unknown[]) => void

class FakeContents {
  readonly send = vi.fn()
  private destroyed = false
  private readonly listeners = new Map<string, Set<EventListener>>()

  isDestroyed(): boolean {
    return this.destroyed
  }

  on(channel: string, listener: EventListener): this {
    const listeners = this.listeners.get(channel) ?? new Set<EventListener>()
    listeners.add(listener)
    this.listeners.set(channel, listeners)
    return this
  }

  once(channel: string, listener: EventListener): this {
    const wrapped: EventListener = (...args) => {
      this.listeners.get(channel)?.delete(wrapped)
      listener(...args)
    }
    return this.on(channel, wrapped)
  }

  navigate(): void {
    this.emit('did-start-navigation', {}, 'https://sim.ai/workspace/ws', false, true)
  }

  destroy(): void {
    this.destroyed = true
    this.emit('destroyed')
  }

  private emit(channel: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(channel) ?? [])]) listener(...args)
  }
}

function webContents(): { fake: FakeContents; contents: WebContents } {
  const fake = new FakeContents()
  return { fake, contents: fake as unknown as WebContents }
}

describe('ScopedEventRouter', () => {
  it('sends resource events only to renderers activated for the matching scope', () => {
    const router = new ScopedEventRouter()
    const chatA = webContents()
    const alsoChatA = webContents()
    const chatB = webContents()

    router.activateTerminal(chatA.contents, 'chat-a')
    router.activateTerminal(alsoChatA.contents, 'chat-a')
    router.activateTerminal(chatB.contents, 'chat-b')
    router.sendTerminal('chat-a', 'terminal:data', 'terminal-1', 'secret', 'chat-a')

    expect(chatA.fake.send).toHaveBeenCalledWith('terminal:data', 'terminal-1', 'secret', 'chat-a')
    expect(alsoChatA.fake.send).toHaveBeenCalledOnce()
    expect(chatB.fake.send).not.toHaveBeenCalled()
  })

  it('stops delivery to the prior scope as soon as a renderer activates another chat', () => {
    const router = new ScopedEventRouter()
    const renderer = webContents()

    router.activateBrowser(renderer.contents, 'chat-a')
    router.activateBrowser(renderer.contents, 'chat-b')
    router.sendBrowser('chat-a', 'browser-agent:page-state', { scopeId: 'chat-a' })
    router.sendBrowser('chat-b', 'browser-agent:page-state', { scopeId: 'chat-b' })

    expect(renderer.fake.send).toHaveBeenCalledOnce()
    expect(renderer.fake.send).toHaveBeenCalledWith(
      'browser-agent:page-state',
      expect.objectContaining({ scopeId: 'chat-b' })
    )
  })
})
