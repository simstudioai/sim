import { isValidEmailSyntax, normalizeEmail } from '@sim/utils/string'
import { parse } from 'csv-parse/browser/esm/sync'
import {
  GITLAB_CSV_MAX_BYTES,
  GITLAB_CSV_MAX_ROWS,
  type GitLabCsvKind,
  type GitLabCsvUpload,
} from '@/connectors/gitlab/permission-config/types'

const USER_ID = /^[1-9]\d{0,15}$/
const PROJECT_PATH = /^[\p{L}\p{N}_.-]+(?:\/[\p{L}\p{N}_.-]+)+$/u
const HEADERS = {
  userMapping: ['user_id', 'email'],
  projectPermissions: ['project_path', 'user_id'],
} as const

export class GitLabCsvValidationError extends Error {
  constructor(
    readonly field: GitLabCsvKind,
    message: string
  ) {
    super(`${field === 'userMapping' ? 'User mapping' : 'Project permissions'}: ${message}`)
    this.name = 'GitLabCsvValidationError'
  }
}

/** Strict, bounded parsing. Diagnostics never include uploaded cell contents. */
export function parseGitLabCsv(upload: GitLabCsvUpload, kind: GitLabCsvKind): [string, string][] {
  const reject = (message: string): never => {
    throw new GitLabCsvValidationError(kind, message)
  }
  if (
    !upload.filename.trim() ||
    upload.filename.length > 255 ||
    /[\p{Cc}/\\]/u.test(upload.filename)
  ) {
    reject('Use a filename of 1–255 characters without path separators.')
  }
  if (new TextEncoder().encode(upload.content).byteLength > GITLAB_CSV_MAX_BYTES) {
    reject('The file must be 4 MiB or smaller.')
  }
  const rows: [string, string][] = []
  const seen = new Set<string>()
  const identities = new Map<string, string>()
  const emails = new Map<string, string>()
  let recordCount = 0
  let firstRecord = true
  try {
    parse(upload.content, {
      bom: true,
      trim: true,
      skip_empty_lines: true,
      max_record_size: 4096,
      on_record(record: string[], context: { lines: number }) {
        const line = context.lines
        if (record.length !== 2)
          reject(`Row ending at line ${line} must contain exactly two columns.`)
        if (firstRecord) {
          firstRecord = false
          if (record[0] === HEADERS[kind][0] && record[1] === HEADERS[kind][1]) return null
        }
        recordCount++
        if (recordCount > GITLAB_CSV_MAX_ROWS) reject('The file must contain at most 100,000 rows.')
        const id = kind === 'userMapping' ? record[0] : record[1]
        if (!USER_ID.test(id) || !Number.isSafeInteger(Number(id))) {
          reject(`Row ending at line ${line} has an invalid user_id; use a positive integer.`)
        }
        let row: [string, string]
        if (kind === 'userMapping') {
          const email = normalizeEmail(record[1])
          if (email.length > 254 || !isValidEmailSyntax(email))
            reject(`Row ending at line ${line} has an invalid email.`)
          if (
            (identities.has(id) && identities.get(id) !== email) ||
            (emails.has(email) && emails.get(email) !== id)
          ) {
            reject(`Row ending at line ${line} conflicts with another identity mapping.`)
          }
          identities.set(id, email)
          emails.set(email, id)
          row = [id, email]
        } else {
          const path = record[0]
          if (
            path.length > 1024 ||
            !PROJECT_PATH.test(path) ||
            path.split('/').some((part) => part === '.' || part === '..')
          ) {
            reject(`Row ending at line ${line} has an invalid project_path; use group/project.`)
          }
          row = [path, id]
        }
        const key = JSON.stringify(row)
        if (!seen.has(key)) {
          seen.add(key)
          rows.push(row)
        }
        return null
      },
    })
  } catch (error) {
    if (error instanceof GitLabCsvValidationError) throw error
    reject('Malformed CSV. Check quoting, column counts, and field lengths.')
  }
  if (rows.length === 0) reject('The file must contain at least one data row.')
  return rows
}

/** Only explicitly mapped users in the selected canonical project receive grants. */
export function gitLabCsvSubjects(
  users: readonly [string, string][],
  permissions: readonly [string, string][],
  projectPath: string
): string[] {
  const identities = new Map(users)
  const subjects = new Set<string>()
  for (const [path, id] of permissions) {
    if (path !== projectPath) continue
    const email = identities.get(id)
    if (email) subjects.add(`u:${email}`)
  }
  return [...subjects].sort()
}
