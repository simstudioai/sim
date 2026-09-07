import { z } from 'zod'

/**
 * Boundary primitives shared by the AWS CloudTrail tool contracts.
 *
 * Every bound and pattern here is transcribed from the CloudTrail API Reference.
 */

/** Longest trail name CloudTrail accepts, per `InvalidTrailNameException`. */
const TRAIL_NAME_MAX_LENGTH = 128

/** Longest trail ARN CloudTrail accepts wherever a name or ARN is allowed. */
const TRAIL_ARN_MAX_LENGTH = 256

const TRAIL_NAME_OR_ARN_PATTERN =
  /^(?:arn:aws[a-zA-Z0-9-]*:cloudtrail:[a-z0-9-]+:\d{12}:trail\/[\w.\-/]+|[a-zA-Z0-9](?:[a-zA-Z0-9]|[._-][a-zA-Z0-9])+)$/

/**
 * A trail name or a full trail ARN. The two branches carry different ceilings: a bare name
 * is 3-128 characters of ASCII alphanumerics plus non-adjacent `.`, `_`, `-`, starting and
 * ending alphanumeric, while an ARN may run to 256. Applying only the ARN ceiling would let
 * a 129-256 character bare name through to AWS, which rejects it with
 * `InvalidTrailNameException`. Shadow trails and organization trails in another Region can
 * only be addressed by ARN.
 * @see https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_GetTrail.html
 * @see https://docs.aws.amazon.com/awscloudtrail/latest/APIReference/API_DescribeTrails.html
 */
export const cloudtrailTrailNameOrArnSchema = z
  .string()
  .trim()
  .min(3, 'Trail name must be at least 3 characters')
  .max(TRAIL_ARN_MAX_LENGTH, 'Trail name or ARN is too long')
  .regex(TRAIL_NAME_OR_ARN_PATTERN, 'Must be a valid trail name or trail ARN')
  .superRefine((value, ctx) => {
    if (!value.startsWith('arn:') && value.length > TRAIL_NAME_MAX_LENGTH) {
      ctx.addIssue({
        code: 'custom',
        message: `Trail name must be at most ${TRAIL_NAME_MAX_LENGTH} characters; use the trail ARN to address a trail in another Region`,
      })
    }
  })
