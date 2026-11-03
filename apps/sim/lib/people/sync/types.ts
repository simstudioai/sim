/** Source identities and reporting references, independent of Sim accounts and memberships. */
export interface DirectoryPerson {
  externalId: string
  managerExternalId: string | null
  name: string
  email: string
  title: string | null
  department: string | null
  location: string | null
}

export interface DirectoryReportRequest {
  managerId: string
  cursor: string | null
}

export type DirectoryReportResult =
  | { managerId: string; reportIds: string[]; next: string | null }
  | { managerId: string; retryAfterMs: number }

/** A stateless page reader. The caller owns the checkpoints for users and individual manager lists. */
export interface DirectoryReader {
  sourceId: string
  users: (cursor: string | null) => Promise<{ people: DirectoryPerson[]; next: string | null }>
  reports?: (items: readonly DirectoryReportRequest[]) => Promise<DirectoryReportResult[]>
}
