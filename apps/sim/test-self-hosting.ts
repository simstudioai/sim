import { createApiKey } from './lib/api-key/auth'

console.log('=== Testing self-hosting scenario (no API_ENCRYPTION_KEY) ===')

// Check environment
console.log('ENCRYPTION_KEY:', `${process.env.ENCRYPTION_KEY?.slice(0, 10)}...`)
console.log('API_ENCRYPTION_KEY:', process.env.API_ENCRYPTION_KEY)

// Ensure API_ENCRYPTION_KEY is not set
process.env.API_ENCRYPTION_KEY = undefined
console.log('API_ENCRYPTION_KEY after delete:', process.env.API_ENCRYPTION_KEY)

try {
  const result = await createApiKey(true)
  console.log('Key generated:', !!result.key)
  console.log('Encrypted key generated:', !!result.encryptedKey)
  console.log('Encrypted key value:', result.encryptedKey)
  console.log('Are they the same?', result.key === result.encryptedKey)
  console.log('Would validation pass?', !!result.encryptedKey)
} catch (error) {
  console.error('Error in createApiKey:', error)
}
