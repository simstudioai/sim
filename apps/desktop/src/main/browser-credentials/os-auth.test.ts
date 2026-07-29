import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const promptTouchID = vi.fn(async () => undefined)
const canPromptTouchID = vi.fn(() => true)
const showMessageBox = vi.fn(async () => ({ response: 1 }))

vi.mock('electron', () => ({
  systemPreferences: {
    get canPromptTouchID() {
      return canPromptTouchID
    },
    get promptTouchID() {
      return promptTouchID
    },
  },
  dialog: {
    get showMessageBox() {
      return showMessageBox
    },
  },
}))

vi.mock('@sim/logger', () => ({
  createLogger: () => ({ warn: vi.fn(), error: vi.fn(), info: vi.fn(), debug: vi.fn() }),
}))

const { authorizeForSecret, revokeSecretAuthorization } = await import(
  '@/main/browser-credentials/os-auth'
)

const GRACE_MS = 30_000

const realPlatform = process.platform

/**
 * Touch ID is reachable only on darwin, so the suite pins the platform rather
 * than inheriting the runner's. Without this the biometric expectations below
 * pass on a Mac and fail on Linux CI, where the gate sends every call to the
 * fallback dialog instead.
 */
function setPlatform(platform: NodeJS.Platform): void {
  Object.defineProperty(process, 'platform', { value: platform, configurable: true })
}

function request(credentialId: string) {
  return {
    credentialId,
    operation: 'reveal' as const,
    reason: 'show a saved password',
    action: 'Show password',
  }
}

/** The weaker of the two operations: plaintext never leaves the main process. */
function copyRequest(credentialId: string) {
  return {
    credentialId,
    operation: 'copy' as const,
    reason: 'copy a saved password',
    action: 'Copy password',
  }
}

describe('authorizeForSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    revokeSecretAuthorization()
    setPlatform('darwin')
    canPromptTouchID.mockReturnValue(true)
    promptTouchID.mockResolvedValue(undefined)
  })

  afterEach(() => {
    setPlatform(realPlatform)
  })

  it('asks the OS the first time a credential is used', async () => {
    await expect(authorizeForSecret(request('c1'))).resolves.toBe(true)
    expect(promptTouchID).toHaveBeenCalledTimes(1)
  })

  it('does not ask again while the proof of presence is fresh', async () => {
    await authorizeForSecret(request('c1'))
    await expect(authorizeForSecret(request('c1'))).resolves.toBe(true)

    // The user proved they were here seconds ago and the plaintext is likely
    // still on their screen; a second prompt would protect nothing.
    expect(promptTouchID).toHaveBeenCalledTimes(1)
  })

  it('confines a grant to the credential it was granted for', async () => {
    await authorizeForSecret(request('c1'))
    await expect(authorizeForSecret(request('c2'))).resolves.toBe(true)

    expect(promptTouchID).toHaveBeenCalledTimes(2)
  })

  it('asks again once the grant lapses', async () => {
    vi.useFakeTimers()
    await authorizeForSecret(request('c1'))

    vi.advanceTimersByTime(GRACE_MS)
    await authorizeForSecret(request('c1'))

    expect(promptTouchID).toHaveBeenCalledTimes(2)
  })

  it('holds the grant right up to the boundary', async () => {
    vi.useFakeTimers()
    await authorizeForSecret(request('c1'))

    vi.advanceTimersByTime(GRACE_MS - 1)
    await authorizeForSecret(request('c1'))

    expect(promptTouchID).toHaveBeenCalledTimes(1)
  })

  it('grants nothing when the user declines', async () => {
    promptTouchID.mockRejectedValueOnce(new Error('cancelled'))
    await expect(authorizeForSecret(request('c1'))).resolves.toBe(false)

    // A refusal must not be cached as a grant, nor as a standing denial.
    await expect(authorizeForSecret(request('c1'))).resolves.toBe(true)
    expect(promptTouchID).toHaveBeenCalledTimes(2)
  })

  it('never lets a copy consent stand in for a plaintext reveal', async () => {
    await expect(authorizeForSecret(copyRequest('c1'))).resolves.toBe(true)
    expect(promptTouchID).toHaveBeenCalledTimes(1)

    // The user approved "Copy password?"; revealing hands the string to the
    // renderer, so it has to ask again rather than ride the copy grant.
    await expect(authorizeForSecret(request('c1'))).resolves.toBe(true)
    expect(promptTouchID).toHaveBeenCalledTimes(2)
  })

  it('lets a reveal consent cover a later copy of the same credential', async () => {
    await expect(authorizeForSecret(request('c1'))).resolves.toBe(true)

    // The plaintext is already on screen, so putting that same string on the
    // clipboard buys nothing by prompting twice.
    await expect(authorizeForSecret(copyRequest('c1'))).resolves.toBe(true)
    expect(promptTouchID).toHaveBeenCalledTimes(1)
  })

  it('keeps a copy grant usable for further copies', async () => {
    await authorizeForSecret(copyRequest('c1'))
    await authorizeForSecret(copyRequest('c1'))

    expect(promptTouchID).toHaveBeenCalledTimes(1)
  })

  it('never widens a grant to another credential', async () => {
    await authorizeForSecret(request('c1'))
    await authorizeForSecret(request('c2'))

    expect(promptTouchID).toHaveBeenCalledTimes(2)
  })

  it('asks again after the credential is explicitly revoked', async () => {
    await authorizeForSecret(request('c1'))
    revokeSecretAuthorization('c1')
    await authorizeForSecret(request('c1'))

    expect(promptTouchID).toHaveBeenCalledTimes(2)
  })

  it('revokes every credential when given no id', async () => {
    await authorizeForSecret(request('c1'))
    await authorizeForSecret(request('c2'))
    revokeSecretAuthorization()

    await authorizeForSecret(request('c1'))
    await authorizeForSecret(request('c2'))
    expect(promptTouchID).toHaveBeenCalledTimes(4)
  })

  it('labels the fallback dialog with the action it is authorizing', async () => {
    canPromptTouchID.mockReturnValue(false)
    await authorizeForSecret(copyRequest('c1'))

    expect(showMessageBox).toHaveBeenCalledWith(
      expect.objectContaining({
        message: 'Copy password?',
        buttons: ['Cancel', 'Copy password'],
        detail: expect.stringContaining('copy a saved password'),
      })
    )
  })

  it('fails closed when the fallback dialog cannot be shown', async () => {
    canPromptTouchID.mockReturnValue(false)
    showMessageBox.mockRejectedValueOnce(new Error('no window'))

    await expect(authorizeForSecret(request('c1'))).resolves.toBe(false)
  })

  it('never reaches for Touch ID off darwin', async () => {
    // Electron exposes canPromptTouchID on every platform; only the darwin
    // guard keeps a non-Mac build out of the biometric path.
    setPlatform('linux')

    await expect(authorizeForSecret(request('c1'))).resolves.toBe(true)

    expect(promptTouchID).not.toHaveBeenCalled()
    expect(showMessageBox).toHaveBeenCalledTimes(1)
  })
})
