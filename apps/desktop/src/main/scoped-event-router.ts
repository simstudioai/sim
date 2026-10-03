import type { WebContents } from 'electron'

interface SurfaceRoutes {
  activeByContents: WeakMap<WebContents, string>
  contentsByScope: Map<string, Set<WebContents>>
}

/**
 * Routes chat-owned resource events only to renderers currently showing that
 * chat. Browser and terminal activation are tracked separately because either
 * surface can mount or unmount without the other.
 */
export class ScopedEventRouter {
  private readonly browser = this.createSurfaceRoutes()
  private readonly terminal = this.createSurfaceRoutes()
  private readonly observedContents = new WeakSet<WebContents>()

  activateBrowser(contents: WebContents, scopeId: string): void {
    this.activate(this.browser, contents, scopeId)
  }

  activateTerminal(contents: WebContents, scopeId: string): void {
    this.activate(this.terminal, contents, scopeId)
  }

  sendBrowser(scopeId: string, channel: string, ...args: unknown[]): void {
    this.send(this.browser, scopeId, channel, args)
  }

  sendTerminal(scopeId: string, channel: string, ...args: unknown[]): void {
    this.send(this.terminal, scopeId, channel, args)
  }

  private createSurfaceRoutes(): SurfaceRoutes {
    return {
      activeByContents: new WeakMap<WebContents, string>(),
      contentsByScope: new Map<string, Set<WebContents>>(),
    }
  }

  private activate(routes: SurfaceRoutes, contents: WebContents, scopeId: string): void {
    const previous = routes.activeByContents.get(contents)
    if (previous === scopeId) return

    if (previous) {
      this.removeFromScope(routes, contents, previous)
    }

    routes.activeByContents.set(contents, scopeId)
    const recipients = routes.contentsByScope.get(scopeId) ?? new Set<WebContents>()
    recipients.add(contents)
    routes.contentsByScope.set(scopeId, recipients)
    this.observe(contents)
  }

  private observe(contents: WebContents): void {
    if (this.observedContents.has(contents)) return
    this.observedContents.add(contents)

    contents.once('destroyed', () => this.forget(contents))
    contents.on('did-start-navigation', (_event, _url, isInPlace, isMainFrame) => {
      // A full main-frame navigation invalidates the renderer that performed
      // the activation. A reloaded app page must activate its chat again.
      if (!isInPlace && isMainFrame) this.forget(contents)
    })
  }

  private forget(contents: WebContents): void {
    this.forgetSurface(this.browser, contents)
    this.forgetSurface(this.terminal, contents)
  }

  private forgetSurface(routes: SurfaceRoutes, contents: WebContents): void {
    const scopeId = routes.activeByContents.get(contents)
    if (!scopeId) return
    routes.activeByContents.delete(contents)
    this.removeFromScope(routes, contents, scopeId)
  }

  private removeFromScope(routes: SurfaceRoutes, contents: WebContents, scopeId: string): void {
    const recipients = routes.contentsByScope.get(scopeId)
    if (!recipients) return
    recipients.delete(contents)
    if (recipients.size === 0) routes.contentsByScope.delete(scopeId)
  }

  private send(routes: SurfaceRoutes, scopeId: string, channel: string, args: unknown[]): void {
    const recipients = routes.contentsByScope.get(scopeId)
    if (!recipients) return

    for (const contents of [...recipients]) {
      if (contents.isDestroyed() || routes.activeByContents.get(contents) !== scopeId) {
        this.removeFromScope(routes, contents, scopeId)
        continue
      }
      try {
        contents.send(channel, ...args)
      } catch {
        // A WebContents can enter teardown between isDestroyed() and send().
        // Removing it also prevents repeated exceptions from high-volume PTY
        // output while Electron finishes closing the window.
        this.forget(contents)
      }
    }
  }
}
