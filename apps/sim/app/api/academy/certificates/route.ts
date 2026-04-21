import { db } from '@sim/db'
import { academyCertificate, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { generateShortId } from '@sim/utils/id'
import { and, eq } from 'drizzle-orm'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCourseById } from '@/lib/academy/content'
import type { CertificateMetadata } from '@/lib/academy/types'
import { getSession } from '@/lib/auth'
import type { TokenBucketConfig } from '@/lib/core/rate-limiter'
import { RateLimiter } from '@/lib/core/rate-limiter'
import { withRouteHandler } from '@/lib/core/utils/with-route-handler'

const logger = createLogger('AcademyCertificatesAPI')

const rateLimiter = new RateLimiter()
const CERT_RATE_LIMIT: TokenBucketConfig = {
  maxTokens: 5,
  refillRate: 1,
  refillIntervalMs: 60 * 60_000, // 1 per hour refill
}

const IssueCertificateSchema = z.object({
  courseId: z.string(),
  completedLessonIds: z.array(z.string()),
})

/**
 * POST /api/academy/certificates
 * Issues a certificate for the given course after verifying all lessons are completed.
 * Completion is client-attested: the client sends completed lesson IDs and the server
 * validates them against the full lesson list for the course.
 */
export const POST = withRouteHandler(async (req: NextRequest) => {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const { allowed } = await rateLimiter.checkRateLimitDirect(
      `academy:cert:${session.user.id}`,
      CERT_RATE_LIMIT
    )
    if (!allowed) {
      return NextResponse.json({ error: 'Too many requests' }, { status: 429 })
    }

    const body = await req.json()
    const parsed = IssueCertificateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { courseId, completedLessonIds } = parsed.data

    const course = getCourseById(courseId)
    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 })
    }

    // Verify all lessons in the course are reported as completed
    const allLessonIds = course.modules.flatMap((m) => m.lessons.map((l) => l.id))
    const completedSet = new Set(completedLessonIds)
    const incomplete = allLessonIds.filter((id) => !completedSet.has(id))
    if (incomplete.length > 0) {
      return NextResponse.json({ error: 'Course not fully completed', incomplete }, { status: 422 })
    }

    const [existing, learner] = await Promise.all([
      db
        .select()
        .from(academyCertificate)
        .where(
          and(
            eq(academyCertificate.userId, session.user.id),
            eq(academyCertificate.courseId, courseId)
          )
        )
        .limit(1)
        .then((rows) => rows[0] ?? null),
      db
        .select({ name: user.name })
        .from(user)
        .where(eq(user.id, session.user.id))
        .limit(1)
        .then((rows) => rows[0] ?? null),
    ])

    if (existing) {
      if (existing.status === 'active') {
        return NextResponse.json({ certificate: existing })
      }
      return NextResponse.json(
        { error: 'A certificate for this course already exists but is not active.' },
        { status: 409 }
      )
    }

    const certificateNumber = generateCertificateNumber()
    const metadata: CertificateMetadata = {
      recipientName: learner?.name ?? session.user.name ?? 'Partner',
      courseTitle: course.title,
    }

    const [certificate] = await db
      .insert(academyCertificate)
      .values({
        id: generateShortId(),
        userId: session.user.id,
        courseId,
        status: 'active',
        certificateNumber,
        metadata,
      })
      .onConflictDoNothing()
      .returning()

    if (!certificate) {
      const [race] = await db
        .select()
        .from(academyCertificate)
        .where(
          and(
            eq(academyCertificate.userId, session.user.id),
            eq(academyCertificate.courseId, courseId)
          )
        )
        .limit(1)
      if (race?.status === 'active') {
        return NextResponse.json({ certificate: race })
      }
      if (race) {
        return NextResponse.json(
          { error: 'A certificate for this course already exists but is not active.' },
          { status: 409 }
        )
      }
      return NextResponse.json({ error: 'Failed to issue certificate' }, { status: 500 })
    }

    logger.info('Certificate issued', {
      userId: session.user.id,
      courseId,
      certificateNumber,
    })

    return NextResponse.json({ certificate }, { status: 201 })
  } catch (error) {
    logger.error('Failed to issue certificate', { error })
    return NextResponse.json({ error: 'Failed to issue certificate' }, { status: 500 })
  }
})

/**
 * GET /api/academy/certificates?certificateNumber=SIM-2026-00042
 * Public endpoint for verifying a certificate by its number.
 *
 * GET /api/academy/certificates?courseId=...
 * Authenticated endpoint for looking up the current user's certificate for a course.
 */
export const GET = withRouteHandler(async (req: NextRequest) => {
  try {
    const { searchParams } = new URL(req.url)
    const certificateNumber = searchParams.get('certificateNumber')
    const courseId = searchParams.get('courseId')

    if (certificateNumber) {
      const [certificate] = await db
        .select()
        .from(academyCertificate)
        .where(eq(academyCertificate.certificateNumber, certificateNumber))
        .limit(1)

      if (!certificate) {
        return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
      }
      return NextResponse.json({ certificate })
    }

    if (courseId) {
      const session = await getSession()
      if (!session?.user?.id) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
      }

      const [certificate] = await db
        .select()
        .from(academyCertificate)
        .where(
          and(
            eq(academyCertificate.userId, session.user.id),
            eq(academyCertificate.courseId, courseId)
          )
        )
        .limit(1)

      return NextResponse.json({ certificate: certificate ?? null })
    }

    return NextResponse.json(
      { error: 'certificateNumber or courseId query parameter is required' },
      { status: 400 }
    )
  } catch (error) {
    logger.error('Failed to verify certificate', { error })
    return NextResponse.json({ error: 'Failed to verify certificate' }, { status: 500 })
  }
})

/** Generates a human-readable certificate number, e.g. SIM-2026-A3K9XZ2P */
function generateCertificateNumber(): string {
  const year = new Date().getFullYear()
  return `SIM-${year}-${generateShortId(8).toUpperCase()}`
}
