import {
  type ApplicationOperation,
  assertOperationCapability,
} from '@/lib/core/application/operation'

interface PublicFileOperation extends ApplicationOperation {
  readonly authority: 'verified_public_file_share'
}
function definePublicFileOperation<const O extends PublicFileOperation>(operation: O): O {
  assertOperationCapability(operation)
  return Object.freeze(operation)
}

export const publicFileOperations = {
  // permission-group-exempt: verified share credentials authorize bearer reads; member publishing enforces sharing policy.
  readMetadata: definePublicFileOperation({
    id: 'public_files.read_metadata',
    authority: 'verified_public_file_share',
    capability: 'none',
  }),
  // permission-group-exempt: verified share credentials authorize bearer reads; member publishing enforces sharing policy.
  readContent: definePublicFileOperation({
    id: 'public_files.read_content',
    authority: 'verified_public_file_share',
    capability: 'none',
  }),
  // permission-group-exempt: the verified share grant covers only current same-owner images referenced by its file.
  readInline: definePublicFileOperation({
    id: 'public_files.read_inline',
    authority: 'verified_public_file_share',
    capability: 'none',
  }),
} as const
export type PublicFileReadOperation =
  (typeof publicFileOperations)[keyof typeof publicFileOperations]
