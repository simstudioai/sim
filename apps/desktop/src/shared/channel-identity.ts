/**
 * Each desktop channel's identity, in the one table both the packager and the running app read:
 * `scripts/channels.ts` stamps it into the bundle and installer, and `src/main` claims it at
 * startup (`app.setName`, which decides the userData directory and single-instance lock, and the
 * Windows AppUserModelID). When the two disagree, the app on disk and the running app disagree
 * about which app they are.
 */

/**
 * The environment a build is keyed to. Each is a separate app, so one developer can keep a prod,
 * staging, dev, and localhost install side by side, each with its own settings, sessions, and
 * update feed.
 */
export type DesktopChannel = 'prod' | 'staging' | 'dev' | 'local'

export interface DesktopChannelIdentity {
  /**
   * Display and bundle name; also the userData directory name. Prod keeps the plain name every
   * existing install already has, so its userData never moves.
   */
  name: string
  /**
   * The installer's app ID. On Windows it is also the AppUserModelID: the running process must
   * claim the ID the installer stamped on its Start-menu shortcut, or toasts lose their
   * attribution and taskbar pins group under a separate icon.
   */
  appId: string
  /**
   * The 512px app icon under `static/`, for runs with no packaged icon to inherit and for the
   * Windows tray; the Windows icon is generated from it (`scripts/generate-windows-icons.ts`).
   */
  dockIcon: string
  /** Native Icon Composer source copied into the packager's generated path. */
  icon: string
  /** Multi-size Windows icon copied into the packager's generated path. */
  windowsIcon: string
  /**
   * Artifact filename stem, and the per-channel scratch directory name. Space-free for the same
   * reason electron-builder.yml's artifactName is: GitHub rewrites asset names containing spaces,
   * which desyncs the electron-updater manifest from the uploaded files.
   */
  slug: string
}

export const CHANNEL_IDENTITIES: Record<DesktopChannel, DesktopChannelIdentity> = {
  prod: {
    name: 'Sim',
    appId: 'ai.sim.desktop',
    dockIcon: 'dock-icon.png',
    icon: 'build/icon.icon',
    windowsIcon: 'build/icon.ico',
    slug: 'sim',
  },
  staging: {
    name: 'Sim Staging',
    appId: 'ai.sim.desktop.staging',
    dockIcon: 'dock-icon-staging.png',
    icon: 'build/icon-staging.icon',
    windowsIcon: 'build/icon-staging.ico',
    slug: 'sim-staging',
  },
  dev: {
    name: 'Sim Dev',
    appId: 'ai.sim.desktop.dev',
    dockIcon: 'dock-icon-dev.png',
    icon: 'build/icon-dev.icon',
    windowsIcon: 'build/icon-dev.ico',
    slug: 'sim-dev',
  },
  local: {
    name: 'Sim Local',
    appId: 'ai.sim.desktop.local',
    dockIcon: 'dock-icon-local.png',
    icon: 'build/icon-local.icon',
    windowsIcon: 'build/icon-local.ico',
    slug: 'sim-local',
  },
}
