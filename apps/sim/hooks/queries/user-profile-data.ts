import type { UserProfileApiUser } from '@/lib/api/contracts/user'

export const USER_PROFILE_STALE_TIME = 5 * 60 * 1000

export const userProfileKeys = {
  all: ['userProfile'] as const,
  profile: () => [...userProfileKeys.all, 'profile'] as const,
}

export type UserProfile = Omit<UserProfileApiUser, 'emailVerified'>

export function mapUserProfileResponse(user: UserProfileApiUser): UserProfile {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    image: user.image,
  }
}
