import { quickValidateEmail } from '@/lib/email/validation'
import type { Organization } from '@/stores/organization/types'

/**
 * Calculate seat usage for an organization
 */
export function calculateSeatUsage(org?: Organization | null) {
  const members = org?.members?.length ?? 0
  const pending = org?.invitations?.filter((inv) => inv.status === 'pending').length ?? 0
  return { used: members + pending, members, pending }
}

/**
 * Generate a URL-friendly slug from a name
 */
export function generateSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-') // Replace non-alphanumeric with hyphens
    .replace(/-+/g, '-') // Replace consecutive hyphens with single hyphen
    .replace(/^-|-$/g, '') // Remove leading and trailing hyphens
}

/**
 * Validate organization slug format
 */
export function validateSlug(slug: string): boolean {
  const slugRegex = /^[a-z0-9-_]+$/
  return slugRegex.test(slug)
}

/**
 * Validate email format
 */
export function validateEmail(email: string): boolean {
  return quickValidateEmail(email.trim().toLowerCase()).isValid
}
