const GITHUB_OWNER_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,37}[A-Za-z0-9])?$/
const GITHUB_REPO_PATTERN = /^[A-Za-z0-9_.-]+$/
const GIT_BRANCH_PATTERN = /^(?!-)(?!.*(?:\.\.|@\{|\/\/|\\|\s))[^~^:?*[\]]+$/

export function validateGitHubRepository(owner: string, repo: string): void {
  if (
    !GITHUB_OWNER_PATTERN.test(owner) ||
    !GITHUB_REPO_PATTERN.test(repo) ||
    repo === '.' ||
    repo === '..'
  ) {
    throw new Error('Invalid GitHub repository coordinates')
  }
}

export function validateGitBranch(branch: string): void {
  if (
    !branch ||
    branch === 'HEAD' ||
    branch.endsWith('.') ||
    branch.endsWith('/') ||
    branch.includes('/.') ||
    branch.includes('.lock') ||
    !GIT_BRANCH_PATTERN.test(branch)
  ) {
    throw new Error('Invalid Git branch name')
  }
}

export function validateCommitSha(sha: string): void {
  if (!/^[0-9a-f]{40}(?:[0-9a-f]{24})?$/i.test(sha)) {
    throw new Error('Invalid commit SHA')
  }
}
