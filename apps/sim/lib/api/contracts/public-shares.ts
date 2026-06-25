import { z } from 'zod'
import { inlineFileRefQuerySchema, workspaceIdSchema } from '@/lib/api/contracts/primitives'
import { defineRouteContract } from '@/lib/api/contracts/types'

export const shareResourceTypeSchema = z.enum(['file', 'folder'])

/** How a public share is gated. */
export const shareAuthTypeSchema = z.enum(['public', 'password', 'email', 'sso'])

export type ShareAuthType = z.output<typeof shareAuthTypeSchema>

/** An allowed email address or `@domain` pattern for email/SSO shares. */
const allowedEmailSchema = z.string().min(1).max(320)

/**
 * Public-safe representation of a `public_share` row. Never carries the
 * underlying storage key or the (encrypted) password — `hasPassword` is the
 * only password signal exposed to clients. `allowedEmails` is the allow-list for
 * email/SSO shares (visible only to workspace members via the authed share route).
 */
export const shareRecordSchema = z.object({
  id: z.string(),
  token: z.string(),
  url: z.string(),
  isActive: z.boolean(),
  resourceType: shareResourceTypeSchema,
  resourceId: z.string(),
  authType: shareAuthTypeSchema,
  hasPassword: z.boolean(),
  allowedEmails: z.array(allowedEmailSchema),
})

export type ShareRecord = z.output<typeof shareRecordSchema>

const fileShareParamsSchema = z.object({
  id: workspaceIdSchema,
  fileId: z.string().min(1, 'File ID is required'),
})

export const upsertFileShareBodySchema = z.object({
  isActive: z.boolean(),
  authType: shareAuthTypeSchema.optional(),
  password: z
    .string()
    .min(1, 'Password cannot be empty')
    .max(1024, 'Password is too long')
    .optional(),
  allowedEmails: z.array(allowedEmailSchema).max(200, 'Too many allowed emails').optional(),
  // Client-reserved token shown as the link before saving; persisted on first
  // enable so a copied link resolves. Ignored once the share row already exists.
  token: z
    .string()
    .regex(/^[A-Za-z0-9_-]+$/, 'Invalid token')
    .min(16, 'Token is too short')
    .max(64, 'Token is too long')
    .optional(),
})

export type UpsertFileShareBody = z.input<typeof upsertFileShareBodySchema>

const getFileShareResponseSchema = z.object({
  share: shareRecordSchema.nullable(),
})

export type GetFileShareResponse = z.output<typeof getFileShareResponseSchema>

export const getFileShareContract = defineRouteContract({
  method: 'GET',
  path: '/api/workspaces/[id]/files/[fileId]/share',
  params: fileShareParamsSchema,
  response: {
    mode: 'json',
    schema: getFileShareResponseSchema,
  },
})

const upsertFileShareResponseSchema = z.object({
  share: shareRecordSchema,
})

export type UpsertFileShareResponse = z.output<typeof upsertFileShareResponseSchema>

export const upsertFileShareContract = defineRouteContract({
  method: 'PUT',
  path: '/api/workspaces/[id]/files/[fileId]/share',
  params: fileShareParamsSchema,
  body: upsertFileShareBodySchema,
  response: {
    mode: 'json',
    schema: upsertFileShareResponseSchema,
  },
})

export const publicFileTokenParamsSchema = z.object({
  token: z.string().min(1, 'Token is required'),
})

const publicFileMetadataSchema = z.object({
  token: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number(),
  workspaceName: z.string().nullable(),
  ownerName: z.string().nullable(),
})

export type PublicFileMetadata = z.output<typeof publicFileMetadataSchema>

export const getPublicFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/public/[token]',
  params: publicFileTokenParamsSchema,
  response: {
    mode: 'json',
    schema: publicFileMetadataSchema,
  },
})

/** Binary stream of the shared file's bytes. Authorized solely by an active token. */
export const getPublicFileContentContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/public/[token]/content',
  params: publicFileTokenParamsSchema,
  response: {
    mode: 'binary',
  },
})

/**
 * Binary stream of an image embedded in a shared document. Authorized by the parent
 * document's active share — the route serves the bytes only when the reference is
 * actually embedded in the shared document AND the file lives in the same workspace,
 * and only when the bytes are a renderable raster image.
 */
export const getPublicInlineFileContract = defineRouteContract({
  method: 'GET',
  path: '/api/files/public/[token]/inline',
  params: publicFileTokenParamsSchema,
  query: inlineFileRefQuerySchema,
  response: {
    mode: 'binary',
  },
})

const authenticatePublicFileBodySchema = z.object({
  password: z.string().min(1, 'Password is required').max(1024, 'Password is too long'),
})

export type AuthenticatePublicFileBody = z.input<typeof authenticatePublicFileBodySchema>

const authenticatePublicFileResponseSchema = z.object({
  authType: shareAuthTypeSchema,
})

export type AuthenticatePublicFileResponse = z.output<typeof authenticatePublicFileResponseSchema>

/**
 * Exchanges a share password for a `file_auth_{shareId}` cookie. IP rate-limited;
 * returns 401 (`Invalid password`) on mismatch and 429 when throttled.
 */
export const authenticatePublicFileContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/public/[token]',
  params: publicFileTokenParamsSchema,
  body: authenticatePublicFileBodySchema,
  response: {
    mode: 'json',
    schema: authenticatePublicFileResponseSchema,
  },
})

const requestPublicFileOtpBodySchema = z.object({
  email: z.string().email('Invalid email address'),
})

export type RequestPublicFileOtpBody = z.input<typeof requestPublicFileOtpBodySchema>

const requestPublicFileOtpResponseSchema = z.object({
  message: z.string(),
})

/** Sends a 6-digit verification code to an allow-listed email for an email-gated share. */
export const requestPublicFileOtpContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/public/[token]/otp',
  params: publicFileTokenParamsSchema,
  body: requestPublicFileOtpBodySchema,
  response: {
    mode: 'json',
    schema: requestPublicFileOtpResponseSchema,
  },
})

const verifyPublicFileOtpBodySchema = requestPublicFileOtpBodySchema.extend({
  otp: z.string().length(6, 'Verification code must be 6 digits'),
})

export type VerifyPublicFileOtpBody = z.input<typeof verifyPublicFileOtpBodySchema>

const verifyPublicFileOtpResponseSchema = z.object({
  authType: shareAuthTypeSchema,
})

export type VerifyPublicFileOtpResponse = z.output<typeof verifyPublicFileOtpResponseSchema>

/** Verifies the OTP and, on success, sets the `file_auth_{shareId}` cookie. */
export const verifyPublicFileOtpContract = defineRouteContract({
  method: 'PUT',
  path: '/api/files/public/[token]/otp',
  params: publicFileTokenParamsSchema,
  body: verifyPublicFileOtpBodySchema,
  response: {
    mode: 'json',
    schema: verifyPublicFileOtpResponseSchema,
  },
})

const publicFileSSOBodySchema = z.object({
  email: z.string().email('Invalid email address'),
})

export type PublicFileSSOBody = z.input<typeof publicFileSSOBodySchema>

const publicFileSSOResponseSchema = z.object({
  eligible: z.boolean(),
})

export type PublicFileSSOResponse = z.output<typeof publicFileSSOResponseSchema>

/** Reports whether an email is on the allow-list for an SSO-gated share. */
export const publicFileSSOContract = defineRouteContract({
  method: 'POST',
  path: '/api/files/public/[token]/sso',
  params: publicFileTokenParamsSchema,
  body: publicFileSSOBodySchema,
  response: {
    mode: 'json',
    schema: publicFileSSOResponseSchema,
  },
})
