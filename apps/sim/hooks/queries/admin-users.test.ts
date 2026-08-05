/**
 * @vitest-environment node
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'

const { mockCreateUser } = vi.hoisted(() => ({
  mockCreateUser: vi.fn(),
}))

vi.mock('@/lib/auth/auth-client', () => ({
  client: {
    admin: {
      createUser: mockCreateUser,
    },
  },
}))

import { addUser } from '@/hooks/queries/admin-users'

describe('addUser', () => {
  beforeEach(() => {
    vi.clearAllMocks()
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
