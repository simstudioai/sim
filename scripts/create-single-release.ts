#!/usr/bin/env bun

import { execFileSync } from 'node:child_process'
import { Octokit } from '@octokit/rest'
import { createLogger } from '@sim/logger'
import { sleep } from '@sim/utils/helpers'

const logger = createLogger('CreateRelease')
const GITHUB_TOKEN = process.env.GH_PAT
const REPO_OWNER = 'simstudioai'
const REPO_NAME = 'sim'

const targetVersion = process.argv[2]

const octokit = new Octokit({
  auth: GITHUB_TOKEN,
})

interface VersionCommit {
  hash: string
  version: string
  title: string
  date: string
  author: string
}

interface CommitDetail {
  hash: string
  message: string
  author: string
  githubUsername: string
  prNumber?: string
}

function execGit(args: string[]): string {
  try {
    return execFileSync('git', args, { encoding: 'utf8' }).trim()
  } catch (error) {
    logger.error('Git command failed', { args })
    throw error
  }
}

const VERSION_COMMIT_FORMAT = '--format=%H%x00%s%x00%aI%x00%an'

function parseVersionCommit(line: string): VersionCommit | null {
  if (!line) return null

  const [hash, message, date, author] = line.split('\0')
  const versionMatch = message.match(/^\s*(v\d+\.\d+\.?\d*):\s*(.+)$/)
  if (!versionMatch) return null

  return {
    hash,
    version: versionMatch[1],
    title: versionMatch[2],
    date: new Date(date).toISOString(),
    author,
  }
}

/** Reads one release candidate at a time, stopping at the first matching subject. */
function findReleaseCommit(ref: string, version?: string, skip = 0): VersionCommit | null {
  const versionPattern = version ? version.replaceAll('.', '[.]') : 'v[0-9]+[.][0-9]+[.]?[0-9]*'

  while (true) {
    const line = execGit([
      'log',
      '--first-parent',
      '--max-count=1',
      `--skip=${skip}`,
      '--extended-regexp',
      `--grep=^[[:space:]]*${versionPattern}:[[:space:]]*.+`,
      VERSION_COMMIT_FORMAT,
      ref,
      '--',
    ])
    if (!line) return null

    const commit = parseVersionCommit(line)
    if (commit && (!version || commit.version === version)) return commit

    /** Git's grep also matches commit bodies; only release subjects are boundaries. */
    skip++
  }
}

export function findVersionCommit(
  version: string,
  commitSha = process.env.GITHUB_SHA
): VersionCommit | null {
  logger.info(`Finding commit for version ${version}`)
  if (!/^v\d+\.\d+\.?\d*$/.test(version)) return null

  if (commitSha) {
    const commit = parseVersionCommit(
      execGit(['log', '-1', VERSION_COMMIT_FORMAT, commitSha, '--'])
    )
    return commit?.version === version ? commit : null
  }

  return findReleaseCommit('main', version)
}

export function findPreviousVersionCommit(currentCommit: VersionCommit): VersionCommit | null {
  logger.info(`Finding previous version before ${currentCommit.version}`)
  return findReleaseCommit(currentCommit.hash, undefined, 1)
}

async function fetchGitHubCommitDetails(
  commitHashes: string[]
): Promise<Map<string, CommitDetail>> {
  console.log(`🔍 Fetching GitHub commit details for ${commitHashes.length} commits...`)
  const commitMap = new Map<string, CommitDetail>()

  for (let i = 0; i < commitHashes.length; i++) {
    const hash = commitHashes[i]

    try {
      const { data: commit } = await octokit.rest.repos.getCommit({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        ref: hash,
      })

      const prMatch = commit.commit.message.match(/\(#(\d+)\)/)
      const prNumber = prMatch ? prMatch[1] : undefined

      const githubUsername = commit.author?.login || commit.committer?.login || 'unknown'

      let cleanMessage = commit.commit.message.split('\n')[0]
      if (prNumber) {
        cleanMessage = cleanMessage.replace(/\s*\(#\d+\)\s*$/, '')
      }

      commitMap.set(hash, {
        hash,
        message: cleanMessage,
        author: commit.commit.author?.name || 'Unknown',
        githubUsername,
        prNumber,
      })

      await sleep(100)
    } catch (error: any) {
      console.warn(`⚠️ Could not fetch commit ${hash.substring(0, 7)}: ${error?.message || error}`)

      try {
        const gitData = execGit(['log', '--format=%s|%an', '-1', hash, '--']).split('|')
        let message = gitData[0] || 'Unknown commit'

        const prMatch = message.match(/\(#(\d+)\)/)
        const prNumber = prMatch ? prMatch[1] : undefined

        if (prNumber) {
          message = message.replace(/\s*\(#\d+\)\s*$/, '')
        }

        commitMap.set(hash, {
          hash,
          message,
          author: gitData[1] || 'Unknown',
          githubUsername: 'unknown',
          prNumber,
        })
      } catch (fallbackError) {
        console.error(`❌ Failed to get fallback data for ${hash.substring(0, 7)}`)
      }
    }
  }

  return commitMap
}

async function getCommitsBetweenVersions(
  currentCommit: VersionCommit,
  previousCommit?: VersionCommit
): Promise<CommitDetail[]> {
  try {
    let range: string

    if (previousCommit) {
      range = `${previousCommit.hash}..${currentCommit.hash}`
      console.log(
        `🔍 Getting commits between ${previousCommit.version} and ${currentCommit.version}`
      )
    } else {
      range = `${currentCommit.hash}~10..${currentCommit.hash}`
      console.log(`🔍 Getting commits before first version ${currentCommit.version}`)
    }

    const gitLog = execGit(['log', '--format=%H|%s', range, '--'])

    if (!gitLog.trim()) {
      console.log(`⚠️ No commits found in range ${range}`)
      return []
    }

    const commitEntries = gitLog.split('\n').filter((line) => line.trim())

    const nonVersionCommits = commitEntries.filter((line) => {
      const [, message] = line.split('|')
      const isVersionCommit = message.match(/^v\d+\.\d+/)
      if (isVersionCommit) {
        console.log(`⏭️ Skipping version commit: ${message.substring(0, 50)}...`)
        return false
      }
      return true
    })

    console.log(`📋 After filtering version commits: ${nonVersionCommits.length} commits`)

    if (nonVersionCommits.length === 0) {
      return []
    }

    const commitHashes = nonVersionCommits.map((line) => line.split('|')[0])

    const commitMap = await fetchGitHubCommitDetails(commitHashes)

    return commitHashes.map((hash) => commitMap.get(hash)!).filter(Boolean)
  } catch (error) {
    console.error(`❌ Error getting commits between versions:`, error)
    return []
  }
}

function categorizeCommit(message: string): 'features' | 'fixes' | 'improvements' | 'other' {
  const msgLower = message.toLowerCase()

  if (/^feat(\(|:|!)/.test(msgLower)) {
    return 'features'
  }

  if (/^fix(\(|:|!)/.test(msgLower)) {
    return 'fixes'
  }

  if (/^(improvement|improve|perf|refactor)(\(|:|!)/.test(msgLower)) {
    return 'improvements'
  }

  if (/^(chore|docs|style|test|ci|build)(\(|:|!)/.test(msgLower)) {
    return 'other'
  }

  if (msgLower.includes('feat') || msgLower.includes('implement') || msgLower.includes('new ')) {
    return 'features'
  }

  if (msgLower.includes('fix') || msgLower.includes('bug') || msgLower.includes('error')) {
    return 'fixes'
  }

  if (
    msgLower.includes('improve') ||
    msgLower.includes('enhance') ||
    msgLower.includes('upgrade') ||
    msgLower.includes('optimization') ||
    msgLower.includes('add') ||
    msgLower.includes('update')
  ) {
    return 'improvements'
  }

  return 'other'
}

async function generateReleaseBody(
  versionCommit: VersionCommit,
  previousCommit?: VersionCommit
): Promise<string> {
  console.log(`📝 Generating release body for ${versionCommit.version}...`)

  const commits = await getCommitsBetweenVersions(versionCommit, previousCommit)

  if (commits.length === 0) {
    console.log(`⚠️ No commits found, using simple format`)
    return `${versionCommit.title}

[View changes on GitHub](https://github.com/${REPO_OWNER}/${REPO_NAME}/compare/${previousCommit?.version || 'v1.0.0'}...${versionCommit.version})`
  }

  console.log(`📋 Processing ${commits.length} commits for categorization`)

  const features = commits.filter((c) => categorizeCommit(c.message) === 'features')
  const fixes = commits.filter((c) => categorizeCommit(c.message) === 'fixes')
  const improvements = commits.filter((c) => categorizeCommit(c.message) === 'improvements')
  const others = commits.filter((c) => categorizeCommit(c.message) === 'other')

  console.log(
    `📊 Categories: ${features.length} features, ${improvements.length} improvements, ${fixes.length} fixes, ${others.length} other`
  )

  let body = ''

  if (features.length > 0) {
    body += '## Features\n\n'
    for (const commit of features) {
      const prLink = commit.prNumber ? ` (#${commit.prNumber})` : ''
      body += `- ${commit.message}${prLink}\n`
    }
    body += '\n'
  }

  if (improvements.length > 0) {
    body += '## Improvements\n\n'
    for (const commit of improvements) {
      const prLink = commit.prNumber ? ` (#${commit.prNumber})` : ''
      body += `- ${commit.message}${prLink}\n`
    }
    body += '\n'
  }

  if (fixes.length > 0) {
    body += '## Bug Fixes\n\n'
    for (const commit of fixes) {
      const prLink = commit.prNumber ? ` (#${commit.prNumber})` : ''
      body += `- ${commit.message}${prLink}\n`
    }
    body += '\n'
  }

  if (others.length > 0) {
    body += '## Other Changes\n\n'
    for (const commit of others) {
      const prLink = commit.prNumber ? ` (#${commit.prNumber})` : ''
      body += `- ${commit.message}${prLink}\n`
    }
    body += '\n'
  }

  const uniqueContributors = new Set<string>()
  commits.forEach((commit) => {
    if (commit.githubUsername && commit.githubUsername !== 'unknown') {
      uniqueContributors.add(commit.githubUsername)
    }
  })

  if (uniqueContributors.size > 0) {
    body += '## Contributors\n\n'
    for (const contributor of Array.from(uniqueContributors).sort()) {
      body += `- @${contributor}\n`
    }
    body += '\n'
  }

  body += `[View changes on GitHub](https://github.com/${REPO_OWNER}/${REPO_NAME}/compare/${previousCommit?.version || 'v1.0.0'}...${versionCommit.version})`

  return body.trim()
}

async function main() {
  if (!GITHUB_TOKEN) {
    logger.error('GH_PAT environment variable is required')
    process.exit(1)
  }
  if (!targetVersion) {
    logger.error(
      'Version argument is required. Usage: bun run scripts/create-single-release.ts vX.Y.Z'
    )
    process.exit(1)
  }

  try {
    console.log(`🚀 Creating single release for ${targetVersion}...`)

    const versionCommit = findVersionCommit(targetVersion)
    if (!versionCommit) {
      console.error(`❌ No commit found for version ${targetVersion}`)
      process.exit(1)
    }

    console.log(
      `✅ Found version commit: ${versionCommit.hash.substring(0, 7)} - ${versionCommit.title}`
    )

    const previousCommit = findPreviousVersionCommit(versionCommit)
    if (previousCommit) {
      console.log(`✅ Found previous version: ${previousCommit.version}`)
    } else {
      console.log(`ℹ️ No previous version found (this might be the first release)`)
    }

    try {
      const existingRelease = await octokit.rest.repos.getReleaseByTag({
        owner: REPO_OWNER,
        repo: REPO_NAME,
        tag: targetVersion,
      })
      if (existingRelease.data) {
        console.log(`ℹ️ Release ${targetVersion} already exists, skipping creation`)
        console.log(
          `🔗 View release: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${targetVersion}`
        )
        return
      }
    } catch (error: any) {
      if (error.status !== 404) {
        throw error
      }
    }

    const releaseBody = await generateReleaseBody(versionCommit, previousCommit || undefined)

    console.log(`🚀 Creating GitHub release for ${targetVersion}...`)

    await octokit.rest.repos.createRelease({
      owner: REPO_OWNER,
      repo: REPO_NAME,
      tag_name: targetVersion,
      name: targetVersion,
      body: releaseBody,
      draft: false,
      prerelease: false,
      target_commitish: versionCommit.hash,
    })

    console.log(`✅ Successfully created release: ${targetVersion}`)
    console.log(
      `🔗 View release: https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/${targetVersion}`
    )
  } catch (error) {
    console.error('❌ Script failed:', error)
    process.exit(1)
  }
}

if (import.meta.main) {
  main()
}
