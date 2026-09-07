/** Receipt for a workspace file explicitly exported by code execution. */
export interface SandboxExportedFile {
  fileId: string
  fileName: string
  vfsPath: string
  downloadUrl?: string
  sandboxPath?: string
  size: number
  previousSize?: number
  sha256: string
  unchanged: boolean
}

export interface SandboxExportReceipt {
  message: string
  files: SandboxExportedFile[]
}
