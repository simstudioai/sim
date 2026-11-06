import { createSerializer, parseAsString } from 'nuqs/server'

export const credentialParams = { credential: parseAsString.withDefault('') }
export const serializeCredential = createSerializer(credentialParams)
