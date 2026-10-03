/** Accepts GitHub repository names and web URLs without allowing provider-path traversal. */
export function parseGitHubRepository(repository: string): { owner: string; repo: string } {
  const cleaned = repository
    .trim()
    .replace(/^https?:\/\/github\.com\//i, '')
    .replace(/\/$/, '')
    .replace(/\.git$/, '')
  const parts = cleaned.split('/')
  if (
    parts.length !== 2 ||
    !/^[a-z\d](?:[a-z\d-]*[a-z\d])?$/i.test(parts[0] ?? '') ||
    !/^[a-z\d_.-]+$/i.test(parts[1] ?? '') ||
    parts[1] === '.' ||
    parts[1] === '..'
  ) {
    throw new Error(`Invalid repository format: "${repository}". Use "owner/repo".`)
  }
  return { owner: parts[0], repo: parts[1] }
}
