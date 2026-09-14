import type { DesktopServerChangeResult, DesktopServerConfiguration } from '@sim/desktop-bridge'

export interface ShellDialogConfiguration {
  title: string
  message: string
  detail: string
  type: 'none' | 'info' | 'error' | 'question' | 'warning'
  buttons: string[]
  defaultId: number
  cancelId: number
  primaryVariant: 'primary' | 'destructive'
}

/** Narrow bridge for bundled dialogs and server settings, isolated from app and browser sessions. */
export interface ShellWindowApi {
  resizeContent(height: number): void
  getDialogConfiguration(): Promise<ShellDialogConfiguration>
  respond(response: number): void
  server: {
    getConfiguration(): Promise<DesktopServerConfiguration>
    setOrigin(origin: string): Promise<DesktopServerChangeResult>
  }
}
