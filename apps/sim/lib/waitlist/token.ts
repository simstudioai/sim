import { jwtVerify, SignJWT } from 'jose'
import { nanoid } from 'nanoid'

interface TokenPayload {
  email: string
  type: 'waitlist-approval' | 'password-reset'
  expiresIn: string
}

interface DecodedToken {
  email: string
  type: string
  jti: string
  iat: number
  exp: number
}

// Get JWT secret from environment variables
const getJwtSecret = () => {
  const secret = process.env.JWT_SECRET
  if (!secret) {
    throw new Error('JWT_SECRET environment variable is not set')
  }
  return new TextEncoder().encode(secret)
}

/**
 * Create a JWT token
 */
export async function createToken({ email, type, expiresIn }: TokenPayload): Promise<string> {
  const jwt = await new SignJWT({ email, type })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(expiresIn)
    .setJti(nanoid())
    .sign(getJwtSecret())

  return jwt
}

/**
 * Verify a JWT token
 */
export async function verifyToken(token: string): Promise<DecodedToken | null> {
  try {
    const { payload } = await jwtVerify(token, getJwtSecret())

    return payload as unknown as DecodedToken
  } catch (error) {
    console.error('Error verifying token:', error)
    return null
  }
}
