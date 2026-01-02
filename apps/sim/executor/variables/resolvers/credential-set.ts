import { createLogger } from '@sim/logger'
import { parseReferencePath, REFERENCE } from '@/executor/constants'
import type { ResolutionContext, Resolver } from '@/executor/variables/resolvers/reference'

const logger = createLogger('CredentialSetResolver')

export const CREDENTIAL_SET_USER_PREFIX = 'credentialSetUser:'

export class CredentialSetResolver implements Resolver {
  canResolve(reference: string): boolean {
    const parts = parseReferencePath(reference)
    if (parts.length < 1) return false

    const type = parts[0]
    return type === REFERENCE.PREFIX.CREDENTIAL_SET
  }

  resolve(reference: string, context: ResolutionContext): any {
    const parts = parseReferencePath(reference)
    if (parts.length < 2) {
      logger.warn('Invalid credential set reference - missing property', { reference })
      return undefined
    }

    const [_, property] = parts

    if (property === 'currentUser') {
      const credentialAccountUserId = context.executionContext.metadata?.credentialAccountUserId
      if (!credentialAccountUserId) {
        logger.warn(
          'credentialSet.currentUser referenced but no credentialAccountUserId in execution context',
          { reference }
        )
        return undefined
      }
      return `${CREDENTIAL_SET_USER_PREFIX}${credentialAccountUserId}`
    }

    logger.warn('Unknown credential set property', { property, reference })
    return undefined
  }
}
