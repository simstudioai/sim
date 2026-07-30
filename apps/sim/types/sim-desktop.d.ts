import type { SimDesktopApi } from '@sim/desktop-bridge'

declare global {
  interface Window {
    simDesktop?: SimDesktopApi
  }
}
