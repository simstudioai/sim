import { type Static, type TSchema, Type } from 'typebox'
import { Check, Errors } from 'typebox/schema'

export const REVIEW_BODY_MAX_LENGTH = 65_000
export const REVIEW_COMMENT_MAX_COUNT = 50
const REVIEW_COMMENT_BODY_MAX_LENGTH = 10_000

const reviewSideSchema = Type.Union([Type.Literal('LEFT'), Type.Literal('RIGHT')])

const reviewCommentFields = {
  path: Type.String({
    minLength: 1,
    maxLength: 4_096,
    pattern: '^[^\\u0000-\\u001F\\u007F]+$',
    description: 'Exact, canonical repository-relative path from the pull request diff',
  }),
  body: Type.String({
    minLength: 1,
    maxLength: REVIEW_COMMENT_BODY_MAX_LENGTH,
    description: 'Specific, actionable inline review comment',
  }),
  line: Type.Integer({ minimum: 1, description: 'Line number in the selected side of the diff' }),
  side: reviewSideSchema,
}

const singleLineReviewCommentSchema = Type.Object(reviewCommentFields, {
  additionalProperties: false,
})

const multilineReviewCommentSchema = Type.Object(
  {
    ...reviewCommentFields,
    start_line: Type.Integer({ minimum: 1, description: 'First line of a multiline comment' }),
    start_side: reviewSideSchema,
  },
  { additionalProperties: false }
)

export const reviewCommentSchema = Type.Union([
  singleLineReviewCommentSchema,
  multilineReviewCommentSchema,
])

const reviewCommentsSchema = Type.Array(reviewCommentSchema, {
  maxItems: REVIEW_COMMENT_MAX_COUNT,
  description: 'Optional inline comments; omit this field or use an empty array when none',
})

/**
 * Shared internal contract for pull request review submissions. This schema
 * family is intentionally not registered as a separate GitHub block tool: the
 * existing Create PR review operation and Pi's private `submit_review` tool
 * reuse it so both paths enforce the same comment shape and coordinate rules.
 */
export const reviewFindingsSchema = Type.Object(
  {
    body: Type.String({
      minLength: 1,
      maxLength: REVIEW_BODY_MAX_LENGTH,
      description: 'Markdown summary for the pull request review',
    }),
    comments: Type.Optional(reviewCommentsSchema),
  },
  { additionalProperties: false }
)

export type ReviewComment = Static<typeof reviewCommentSchema>

export interface ReviewFindings {
  body: string
  comments: ReviewComment[]
}

function validationDetails(schema: TSchema, value: unknown): string {
  const [, errors] = Errors(schema, value)
  return errors
    .slice(0, 3)
    .map((error) => `${error.instancePath || '/'} ${error.message}`)
    .join('; ')
}

function validateReviewPath(path: string, index: number): string {
  if (path !== path.trim()) {
    throw new Error(`comments[${index}].path must not have leading or trailing whitespace`)
  }
  const segments = path.split('/')
  if (
    path === '.' ||
    path.startsWith('/') ||
    segments.some((segment) => segment === '' || segment === '.' || segment === '..')
  ) {
    throw new Error(`comments[${index}].path must be a canonical repository-relative path`)
  }
  return path
}

/** Strictly validates inline comments after the caller's TypeBox normalization step. */
export function parseReviewComments(value: unknown): ReviewComment[] {
  if (value === undefined) return []

  if (!Check(reviewCommentsSchema, value)) {
    const details = validationDetails(reviewCommentsSchema, value)
    throw new Error(`comments is invalid${details ? `: ${details}` : ''}`)
  }

  return value.map((comment, index) => {
    const path = validateReviewPath(comment.path, index)
    const body = comment.body.trim()
    if (!body) throw new Error(`comments[${index}].body must not be blank`)

    if ('start_line' in comment) {
      if (comment.start_side !== comment.side) {
        throw new Error(`comments[${index}] multiline range must stay on one diff side`)
      }
      if (comment.start_line >= comment.line) {
        throw new Error(`comments[${index}].start_line must be less than comments[${index}].line`)
      }
    }

    return { ...comment, path, body }
  })
}

/** Strictly validates a complete, normalized agent review submission. */
export function parseReviewFindings(value: unknown): ReviewFindings {
  if (!Check(reviewFindingsSchema, value)) {
    const details = validationDetails(reviewFindingsSchema, value)
    throw new Error(`Review findings is invalid${details ? `: ${details}` : ''}`)
  }

  const body = value.body.trim()
  if (!body) throw new Error('Review findings body must not be blank')

  return {
    body,
    comments: parseReviewComments(value.comments),
  }
}
