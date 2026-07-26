import { beforeEach, describe, expect, it, vi } from 'vitest'

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

function request(credentialId: string) {
  return { credentialId, reason: 'show a saved password', action: 'Show password' }
}

describe('authorizeForSecret', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useRealTimers()
    revokeSecretAuthorization()
    canPromptTouchID.mockReturnValue(true)
    promptTouchID.mockResolvedValue(undefined)
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
    await authorizeForSecret({
      credentialId: 'c1',
      reason: 'copy a saved password',
      action: 'Copy password',
    })

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
})
