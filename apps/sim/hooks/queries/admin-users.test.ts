/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateUser, mockRequestJson } = vi.hoisted(() => ({
  mockCreateUser: vi.fn(),
  mockRequestJson: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    admin: {
      createUser: mockCreateUser,
    },
  },
}))

vi.mock('@/lib/api/client/request', () => ({
  requestJson: mockRequestJson,
}))

vi.mock('@/lib/core/utils/urls', () => ({
  getBaseUrl: () => 'https://sim.test',
}))

import { forgetPasswordContract } from '@/lib/api/contracts'
import { addUser } from '@/hooks/queries/admin-users'

const CREATED_USER = {
  id: 'user-1',
  name: 'Canary Writer',
  email: 'writer@synthetics.example.com',
  role: 'user',
  banned: false,
  banReason: null,
}

describe('addUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockRequestJson.mockResolvedValue({ success: true })
  })

  it('creates a Better Auth credential user with normalized identity fields', async () => {
    mockCreateUser.mockResolvedValue({
      data: {
        user: {
          id: 'user-1',
          name: 'Canary Writer',
          email: 'writer@synthetics.example.com',
          role: 'user',
          banned: false,
          banReason: null,
        },
      },
      error: null,
    })

    await expect(
      addUser({
        name: '  Canary Writer  ',
        email: '  Writer@Synthetics.Example.com ',
        password: 'canary-password',
        emailVerified: true,
      })
    ).resolves.toEqual({
      id: 'user-1',
      name: 'Canary Writer',
      email: 'writer@synthetics.example.com',
      role: 'user',
      banned: false,
      banReason: null,
    })
    expect(mockCreateUser).toHaveBeenCalledWith({
      name: 'Canary Writer',
      email: 'writer@synthetics.example.com',
      password: 'canary-password',
      role: 'user',
      data: { emailVerified: true },
    })
    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it('omits the password and emails a reset link when no password is given', async () => {
    mockCreateUser.mockResolvedValue({ data: { user: CREATED_USER }, error: null })

    await expect(
      addUser({
        name: 'Canary Writer',
        email: '  Writer@Synthetics.Example.com ',
        emailVerified: true,
      })
    ).resolves.toEqual(CREATED_USER)

    expect(mockCreateUser).toHaveBeenCalledWith({
      name: 'Canary Writer',
      email: 'writer@synthetics.example.com',
      role: 'user',
      data: { emailVerified: true },
    })
    expect(mockCreateUser.mock.calls[0][0]).not.toHaveProperty('password')
    expect(mockRequestJson).toHaveBeenCalledWith(forgetPasswordContract, {
      body: {
        email: 'writer@synthetics.example.com',
        redirectTo: 'https://sim.test/reset-password',
      },
    })
  })

  it('never sends a reset email when the account was not created', async () => {
    mockCreateUser.mockResolvedValue({
      data: null,
      error: { message: 'A user with that email already exists' },
    })

    await expect(
      addUser({
        name: 'Canary Writer',
        email: 'writer@synthetics.example.com',
        emailVerified: true,
      })
    ).rejects.toThrow('A user with that email already exists')
    expect(mockRequestJson).not.toHaveBeenCalled()
  })

  it('names the row-level recovery path when the reset email fails to send', async () => {
    mockCreateUser.mockResolvedValue({ data: { user: CREATED_USER }, error: null })
    mockRequestJson.mockRejectedValue(new Error('SMTP unavailable'))

    await expect(
      addUser({
        name: 'Canary Writer',
        email: 'writer@synthetics.example.com',
        emailVerified: true,
      })
    ).rejects.toThrow(/Account created, but the password reset email failed to send/)
  })

  it('surfaces resolved Better Auth errors', async () => {
    mockCreateUser.mockResolvedValue({
      data: null,
      error: { message: 'A user with that email already exists' },
    })

    await expect(
      addUser({
        name: 'Canary Writer',
        email: 'writer@synthetics.example.com',
        password: 'canary-password',
        emailVerified: true,
      })
    ).rejects.toThrow('A user with that email already exists')
  })

  it('fails fast when Better Auth omits the created user', async () => {
    mockCreateUser.mockResolvedValue({ data: null, error: null })

    await expect(
      addUser({
        name: 'Canary Writer',
        email: 'writer@synthetics.example.com',
        password: 'canary-password',
        emailVerified: true,
      })
    ).rejects.toThrow('Better Auth did not return the created user')
  })
})
