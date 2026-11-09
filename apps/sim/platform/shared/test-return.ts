/** On a frozen workflow opened from a test's results, names the test whose results Back returns to. */
export const TEST_RETURN_PARAM = 'test'

/** The test a frozen workflow was opened from, read from its page's query; null when there is none. */
export function readTestReturn(query: Record<string, string | string[] | undefined>) {
  const name = query[TEST_RETURN_PARAM]
  return typeof name === 'string' && name.length > 0 ? name : null
}
