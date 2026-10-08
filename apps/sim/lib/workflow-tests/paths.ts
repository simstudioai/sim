import { TEST_NAME_PATTERN } from '@/lib/api/contracts/mothership-tests'
import { OrchestrationError } from '@/lib/core/orchestration/types'
import { decodeVfsPathSegments } from '@/lib/mothership/vfs/path-utils'

/** Test files live flat in this namespace as `tests/<name>.test.js`. */
const TEST_FILE_PREFIX = 'tests/'
export const TEST_FILE_SUFFIX = '.test.js'

export function testFilePath(name: string): string {
  return `${TEST_FILE_PREFIX}${name}${TEST_FILE_SUFFIX}`
}

/** The test name in a `tests/<name>.test.js` reference; null for any other reference. */
export function parseTestFileReference(reference: string): string | null {
  const trimmed = reference.trim().replace(/^\/+/, '')
  if (!trimmed.startsWith(TEST_FILE_PREFIX)) return null
  const segments = decodeVfsPathSegments(trimmed)
  if (segments.length !== 2 || !segments[1].endsWith(TEST_FILE_SUFFIX)) return null
  return segments[1].slice(0, -TEST_FILE_SUFFIX.length)
}

/** Throws a message that tells the writer what a valid test file path looks like. */
export function assertTestName(name: string): void {
  if (!TEST_NAME_PATTERN.test(name)) {
    throw new OrchestrationError(
      'validation',
      `"${testFilePath(name)}" is not a valid test file. Use tests/<name>.test.js with a lowercase name of letters, numbers, and dashes other than "run", like tests/billing-routing.test.js`
    )
  }
}
