#!/usr/bin/env bun

import { execSync } from 'node:child_process'
import { Octokit } from '@octokit/rest'

const GITHUB_TOKEN = process.env.GH_PAT
const REPO_OWNER = 'simstudioai'
const REPO_NAME = 'sim'

if (!GITHUB_TOKEN) {
  console.error('❌ GH_PAT environment variable is required')
  process.exit(1)
}

const targetVersion = process.argv[2]
if (!targetVersion) {
  console.error('❌ Version argument is required')
  console.error('Usage: bun run scripts/create-single-release.ts v0.3.XX')
  process.exit(1)
}

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

function execCommand(command: string): string {
  try {
    return execSync(command, { encoding: 'utf8' }).trim()
  } catch (error) {
    console.error(`❌ Command failed: ${command}`)
    throw error
  }
}

function findVersionCommit(version: string): VersionCommit | null {
  console.log(`🔍 Finding commit for version ${version}...`)

  const gitLog = execCommand('git log --oneline --format="%H|%s|%ai|%an" main')
  const lines = gitLog.split('\n').filter((line) => line.trim())

  for (const line of lines) {
    const [hash, message, date, author] = line.split('|')

    const versionMatch = message.match(/^(v\d+\.\d+\.?\d*):\s*(.+)$/)
    if (versionMatch && versionMatch[1] === version) {
      return {
        hash,
        version,
        title: versionMatch[2],
        date: new Date(date).toISOString(),
        author,
      }
    }
  }

  return null
}

function findPreviousVersionCommit(currentVersion: string): VersionCommit | null {
  console.log(`🔍 Finding previous version before ${currentVersion}...`)

  const gitLog = execCommand('git log --oneline --format="%H|%s|%ai|%an" main')
  const lines = gitLog.split('\n').filter((line) => line.trim())

  let foundCurrent = false

  for (const line of lines) {
    const [hash, message, date, author] = line.split('|')

    const versionMatch = message.match(/^(v\d+\.\d+\.?\d*):\s*(.+)$/)
    if (versionMatch) {
      if (versionMatch[1] === currentVersion) {
        foundCurrent = true
        continue
      }

      if (foundCurrent) {
        return {
          hash,
          version: versionMatch[1],
          title: versionMatch[2],
          date: new Date(date).toISOString(),
          author,
        }
      }
    }
  }

  return null
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

      let cleanMessage = commit.commit.message.split('\n')[0] // First line only
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

      await new Promise((resolve) => setTimeout(resolve, 100))
    } catch (error: any) {
      console.warn(`⚠️ Could not fetch commit ${hash.substring(0, 7)}: ${error?.message || error}`)

      try {
        const gitData = execCommand(`git log --format="%s|%an" -1 ${hash}`).split('|')
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

    const gitLog = execCommand(`git log --oneline --format="%H|%s" ${range}`)

    if (!gitLog.trim()) {
      console.log(`⚠️ No commits found in range ${range}`)
      return []
    }

    const commitEntries = gitLog.split('\n').filter((line) => line.trim())

    const nonVersionCommits = commitEntries.filter((line) => {
      const [hash, message] = line.split('|')
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

  if (
    msgLower.includes('feat') ||
    msgLower.includes('add') ||
    msgLower.includes('implement') ||
    msgLower.includes('new ')
  ) {
    return 'features'
  }

  if (msgLower.includes('fix') || msgLower.includes('bug') || msgLower.includes('error')) {
    return 'fixes'
  }

  if (
    msgLower.includes('improve') ||
    msgLower.includes('enhance') ||
    msgLower.includes('update') ||
    msgLower.includes('upgrade') ||
    msgLower.includes('optimization')
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

    const previousCommit = findPreviousVersionCommit(targetVersion)
    if (previousCommit) {
      console.log(`✅ Found previous version: ${previousCommit.version}`)
    } else {
      console.log(`ℹ️ No previous version found (this might be the first release)`)
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

main()
