import type {
  SlackSearchInstallationView,
  SlackSearchList,
} from '@/lib/api/contracts/knowledge/slack'

export interface SetupTarget {
  mode: 'shared' | 'custom'
  previous?: SlackSearchInstallationView
}

export interface ManifestView {
  manifest: string
  createAppUrl: string
}

export interface SlackAppFields {
  botToken: string
  clientId: string
  clientSecret: string
  signingSecret: string
}

/**
 * What the Connection section reads and does, filled by the session's example on fixtures and by
 * the Slack Search queries and mutations on live data.
 */
export interface SlackSearchConsole {
  /** Absent while the first read is pending; null when it failed. */
  list: SlackSearchList | null | undefined
  retry: () => void
  /** A row change is underway, so no other may start. */
  busy: boolean
  /** Whether a new install or reconnect can start here. */
  canSetUp: boolean
  updating: boolean
  updateError?: string
  toggle: (installation: SlackSearchInstallationView) => void
  remove: (installation: SlackSearchInstallationView) => Promise<void>
}

/** One setup dialog's flow: the manifest to install from and the steps that connect the app. */
export interface SlackSetupFlow {
  /** Absent while the organization's manifest is read. */
  manifest?: ManifestView
  /** The Slack app the organization already configured, which the manifest step updates. */
  existingAppId?: string
  sharedAvailable: boolean
  manifestError?: string
  retryManifest: () => void
  retrying: boolean
  /** Work the dialog cannot be dismissed from. */
  pending: boolean
  close: () => void
  /** Settles with the start of consent, or returns false where the dialog waits for its return. */
  installShared: () => Promise<boolean> | boolean
  connect: (fields: SlackAppFields) => Promise<void>
}
