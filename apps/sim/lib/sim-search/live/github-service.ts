import { decryptSecret } from '@/lib/core/security/encryption'
import type { PinnedConnectionPool } from '@/lib/core/security/input-validation.server'
import {
  assertGitHubInstallationRepositoryActive,
  parseGitHubInstallationBinding,
  resolveGitHubInstallationAccessToken,
} from '@/lib/oauth/github-installation'
import {
  createNativeClient,
  NativeSearchError,
  object,
  segment,
  string,
} from '@/lib/sim-search/live/http'
import { permitsPath } from '@/lib/sim-search/live/policy'
import {
  defaultLiveSearchPolicy,
  normalizeLiveSearchPolicy,
} from '@/lib/sim-search/live/policy-schema'
import type { LiveGitHubSource } from '@/lib/sim-search/live/service-sources'
import type { NativeClient, NativeDocument } from '@/lib/sim-search/live/types'

const REPOSITORY = /^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/
const REPOSITORY_ID = /^[1-9]\d{0,19}$/

function codeAllowed(source: LiveGitHubSource, document: Pick<NativeDocument, 'id' | 'kind'>) {
  if (document.kind !== 'code') return true
  const prefix = string(source.config.pathPrefix).trim().replace(/\/$/, '')
  if (
    !permitsPath(
      { ...defaultLiveSearchPolicy('github'), pathPrefixes: prefix ? [prefix] : [] },
      document.id
    )
  )
    return false
  const extensions = string(source.config.extensions)
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .map((value) => (value.startsWith('.') ? value : `.${value}`))
  return (
    !extensions.length ||
    extensions.some((extension) => document.id.toLowerCase().endsWith(extension))
  )
}

/** Each repository is admitted by the current GitHub App installation and the connected member. */
export function createGitHubServiceVerifier(
  sources: readonly LiveGitHubSource[],
  member: NativeClient,
  signal: AbortSignal,
  pool?: PinnedConnectionPool
) {
  const byRepository = new Map<string, LiveGitHubSource[]>()
  for (const source of sources) {
    const repository = string(source.config.repository)
    const repositoryId = string(source.config.githubRepositoryId)
    if (
      !REPOSITORY.test(repository) ||
      repository.split('/').some((part) => part === '.' || part === '..') ||
      !REPOSITORY_ID.test(repositoryId)
    )
      throw new NativeSearchError(
        'unavailable',
        'A configured GitHub repository is invalid. Check Sources.'
      )
    const key = repository.toLowerCase()
    byRepository.set(key, [...(byRepository.get(key) ?? []), source])
  }
  if (!byRepository.size)
    throw new NativeSearchError(
      'unavailable',
      'Add a GitHub App repository in Sources before searching.'
    )
  const policy = normalizeLiveSearchPolicy('github', {
    ...defaultLiveSearchPolicy('github'),
    accessMode: 'service_account',
    mode: 'selected',
    included: [...byRepository.keys()],
  })
  const proofs = new Map<string, Promise<{ allowed: boolean; defaultBranch: string }>>()
  const prove = (source: LiveGitHubSource) => {
    let proof = proofs.get(source.id)
    if (!proof) {
      proof = (async () => {
        signal.throwIfAborted()
        if (!source.encryptedKey || source.encryptedKey.length > 16_384)
          throw new NativeSearchError('unavailable', 'Reconnect the GitHub App installation.')
        const { decrypted } = await decryptSecret(source.encryptedKey)
        const binding = parseGitHubInstallationBinding(JSON.parse(decrypted))
        if (
          binding.installationId !== source.installationId ||
          binding.accountId !== source.accountId
        )
          throw new NativeSearchError(
            'unavailable',
            'The GitHub App installation identity changed.'
          )
        const repository = string(source.config.repository)
        const repositoryId = string(source.config.githubRepositoryId)
        await assertGitHubInstallationRepositoryActive(binding, repository, { signal })
        const { accessToken } = await resolveGitHubInstallationAccessToken(
          binding,
          { repository, repositoryId },
          { signal }
        )
        const path = `/repos/${repository.split('/').map(segment).join('/')}`
        const app = createNativeClient({
          origin: 'https://api.github.com',
          accessToken,
          signal,
          pool,
        })
        const [appRepository, memberRepository] = await Promise.all([
          app.json(path).then(object),
          member.json(path).then(object),
        ])
        return {
          allowed: [appRepository, memberRepository].every(
            (row) =>
              string(row.id) === repositoryId &&
              string(object(row.owner).id) === binding.accountId &&
              string(row.full_name).toLowerCase() === repository.toLowerCase()
          ),
          defaultBranch: string(memberRepository.default_branch),
        }
      })()
      proofs.set(source.id, proof)
    }
    return proof
  }
  return {
    policy,
    partial: false,
    async verify(document: Pick<NativeDocument, 'id' | 'container' | 'kind'>) {
      const repository = document.container?.toLowerCase()
      if (!repository) return false
      const matches = byRepository.get(repository) ?? []
      let failure: unknown
      for (const source of matches) {
        if (!codeAllowed(source, document)) continue
        try {
          const proof = await prove(source)
          const selectedBranch = string(source.config.branch).trim()
          if (
            proof.allowed &&
            (document.kind !== 'code' || !selectedBranch || selectedBranch === proof.defaultBranch)
          )
            return true
        } catch (error) {
          signal.throwIfAborted()
          failure = error
        }
      }
      if (failure) throw failure
      return false
    },
  }
}
