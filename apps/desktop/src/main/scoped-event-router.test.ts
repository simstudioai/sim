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

  it('tracks browser and terminal activation independently', () => {
    const router = new ScopedEventRouter()
    const renderer = webContents()

    router.activateBrowser(renderer.contents, 'browser-chat')
    router.activateTerminal(renderer.contents, 'terminal-chat')
    router.sendBrowser('browser-chat', 'browser-agent:tabs-state', { scopeId: 'browser-chat' })
    router.sendTerminal('browser-chat', 'terminal:tabs', { scopeId: 'browser-chat' })
    router.sendTerminal('terminal-chat', 'terminal:tabs', { scopeId: 'terminal-chat' })

    expect(renderer.fake.send).toHaveBeenCalledTimes(2)
    expect(renderer.fake.send).toHaveBeenNthCalledWith(
      1,
      'browser-agent:tabs-state',
      expect.objectContaining({ scopeId: 'browser-chat' })
    )
    expect(renderer.fake.send).toHaveBeenNthCalledWith(
      2,
      'terminal:tabs',
      expect.objectContaining({ scopeId: 'terminal-chat' })
    )
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

  it('forgets activation on navigation and destruction', () => {
    const router = new ScopedEventRouter()
    const navigated = webContents()
    const destroyed = webContents()

    router.activateTerminal(navigated.contents, 'chat-a')
    router.activateTerminal(destroyed.contents, 'chat-a')
    navigated.fake.navigate()
    destroyed.fake.destroy()
    router.sendTerminal('chat-a', 'terminal:data', 'terminal-1', 'secret', 'chat-a')

    expect(navigated.fake.send).not.toHaveBeenCalled()
    expect(destroyed.fake.send).not.toHaveBeenCalled()
  })
})
