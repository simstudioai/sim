/**
 * The release artifacts each self-updating desktop platform publishes, shared by the shell's
 * updater, which follows a manifest only to these names, and the deployment's update feed, which
 * serves them. Both must agree, so they are named once here.
 */
export interface DesktopUpdateArtifacts {
  /**
   * The electron-updater manifest the build uploads and the shell requests. electron-builder
   * names it the same for every channel; a release's channel is carried by its tag.
   */
  manifest: 'latest-mac.yml' | 'latest.yml'
  /** Every artifact a manifest for `version` may reference, most human-installable first. */
  artifactNames(version: string): readonly string[]
}

export const DESKTOP_UPDATE_ARTIFACTS: Record<'mac' | 'windows', DesktopUpdateArtifacts> = {
  mac: {
    manifest: 'latest-mac.yml',
    artifactNames: (version) => [`Sim-${version}-universal.dmg`, `Sim-${version}-universal.zip`],
  },
  windows: {
    manifest: 'latest.yml',
    // x64 only: a manifest naming any other architecture is not one Sim ships.
    artifactNames: (version) => [`Sim-${version}-x64.exe`],
  },
}
