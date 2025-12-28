/**
 * Parse repository string into structured format for Greptile API
 * Accepts formats like "github:main:owner/repo" or "owner/repo" (defaults to github:main)
 */
export function parseRepositories(repoString: string): Array<{
  remote: string
  branch: string
  repository: string
}> {
  return repoString
    .split(',')
    .map((r) => r.trim())
    .filter((r) => r.length > 0)
    .map((repo) => {
      const parts = repo.split(':')
      if (parts.length === 3) {
        return {
          remote: parts[0],
          branch: parts[1],
          repository: parts[2],
        }
      }
      return {
        remote: 'github',
        branch: 'main',
        repository: repo,
      }
    })
}
