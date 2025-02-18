import { type ClassValue, clsx } from 'clsx'
import { createHash } from 'crypto'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Hashes a secret using SHA-256 with a salt
 * @param secret - The secret to hash
 * @param salt - Optional salt to use for hashing. If not provided, a random salt will be generated
 * @returns A promise that resolves to an object containing the hashed secret and salt
 */
export async function hashSecret(
  secret: string,
  salt?: string
): Promise<{ hash: string; salt: string }> {
  const useSalt =
    salt || createHash('sha256').update(crypto.randomUUID()).digest('hex').slice(0, 16)
  const hash = createHash('sha256')
    .update(secret + useSalt)
    .digest('hex')
  return { hash, salt: useSalt }
}
