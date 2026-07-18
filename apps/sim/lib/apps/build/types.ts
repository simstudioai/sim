import type { AppActionManifestEntry } from '@/lib/apps/manifest'

export type AppBuildRequest = {
  projectId: string
  revisionId: string
  /** Raw revision files — platform paths may be present but will be overwritten. */
  files: Record<string, string>
  /** Server-owned revision actions for sim.generated.ts */
  actions: AppActionManifestEntry[]
}

export type AppBuildResult =
  | {
      success: true
      artifactManifestHash: string
      buildImageDigest: string
      diagnostics: Record<string, unknown>
    }
  | { success: false; error: string; diagnostics?: Record<string, unknown> }
