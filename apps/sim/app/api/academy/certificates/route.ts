import { db } from '@sim/db'
import { academyCertificate, user } from '@sim/db/schema'
import { createLogger } from '@sim/logger'
import { and, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { type NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { getCourse } from '@/lib/academy/content'
import type { CertificateMetadata } from '@/lib/academy/types'
import { getSession } from '@/lib/auth'

const logger = createLogger('AcademyCertificatesAPI')

const IssueCertificateSchema = z.object({
  courseId: z.string(),
})

/**
 * POST /api/academy/certificates
 * Issues a certificate for the given course.
 * The client is responsible for verifying completion locally before calling this.
 */
export async function POST(req: NextRequest) {
  try {
    const session = await getSession()
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }

    const body = await req.json()
    const parsed = IssueCertificateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 })
    }

    const { courseId } = parsed.data

    const course = getCourse(courseId)

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

    if (!course) {
      return NextResponse.json({ error: 'Course not found' }, { status: 404 })
    }

    if (existing?.status === 'active') {
      return NextResponse.json({ certificate: existing })
    }

    const certificateNumber = generateCertificateNumber()
    const metadata: CertificateMetadata = {
      recipientName: learner?.name ?? session.user.name ?? 'Partner',
      courseTitle: course.title,
    }

    const [certificate] = await db
      .insert(academyCertificate)
      .values({
        id: nanoid(),
        userId: session.user.id,
        courseId,
        status: 'active',
        certificateNumber,
        metadata,
      })
      .returning()

    return NextResponse.json({ certificate }, { status: 201 })
  } catch (error) {
    logger.error('Failed to issue certificate', { error })
    return NextResponse.json({ error: 'Failed to issue certificate' }, { status: 500 })
  }
}

/**
 * GET /api/academy/certificates?certificateNumber=SIM-2026-00042
 * Public endpoint for verifying a certificate by its number.
 */
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url)
    const certificateNumber = searchParams.get('certificateNumber')

    if (!certificateNumber) {
      return NextResponse.json({ error: 'certificateNumber is required' }, { status: 400 })
    }

    const [certificate] = await db
      .select()
      .from(academyCertificate)
      .where(eq(academyCertificate.certificateNumber, certificateNumber))
      .limit(1)

    if (!certificate) {
      return NextResponse.json({ error: 'Certificate not found' }, { status: 404 })
    }

    return NextResponse.json({ certificate })
  } catch (error) {
    logger.error('Failed to verify certificate', { error })
    return NextResponse.json({ error: 'Failed to verify certificate' }, { status: 500 })
  }
}

/** Generates a human-readable certificate number, e.g. SIM-2026-00042 */
function generateCertificateNumber(): string {
  const year = new Date().getFullYear()
  const suffix = Math.floor(Math.random() * 99999)
    .toString()
    .padStart(5, '0')
  return `SIM-${year}-${suffix}`
}
