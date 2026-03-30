'use client'

import { useEffect, useState } from 'react'
import { CheckCircle2, Circle, ExternalLink, GraduationCap, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { getCompletedLessons } from '@/lib/academy/local-progress'
import type { Course } from '@/lib/academy/types'
import { useSession } from '@/lib/auth/auth-client'
import { useCourseCertificate, useIssueCertificate } from '@/hooks/queries/academy'

interface CourseProgressProps {
  course: Course
  courseSlug: string
}

export function CourseProgress({ course, courseSlug }: CourseProgressProps) {
  // Start with an empty set so SSR and initial client render match, then hydrate from localStorage.
  const [completedIds, setCompletedIds] = useState<Set<string>>(() => new Set())
  useEffect(() => {
    setCompletedIds(getCompletedLessons())
  }, [])
  const { data: session } = useSession()
  const { data: fetchedCert } = useCourseCertificate(session ? course.id : undefined)
  const { mutate: issueCertificate, isPending, data: issuedCert, error } = useIssueCertificate()
  const certificate = fetchedCert ?? issuedCert

  const allLessons = course.modules.flatMap((m) => m.lessons)
  const totalLessons = allLessons.length
  const completedCount = allLessons.filter((l) => completedIds.has(l.id)).length
  const percentComplete = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0

  return (
    <>
      {completedCount > 0 && (
        <div className='px-4 pt-8 sm:px-8 md:px-[80px]'>
          <div className='mx-auto max-w-3xl rounded-[8px] border border-[#2A2A2A] bg-[#222] p-4'>
            <div className='mb-2 flex items-center justify-between text-[13px]'>
              <span className='text-[#999]'>Your progress</span>
              <span className='text-[#ECECEC]'>
                {completedCount}/{totalLessons} lessons
              </span>
            </div>
            <div className='h-1.5 w-full overflow-hidden rounded-full bg-[#2A2A2A]'>
              <div
                className='h-full rounded-full bg-[#ECECEC] transition-all'
                style={{ width: `${percentComplete}%` }}
              />
            </div>
          </div>
        </div>
      )}

      <section className='px-4 py-14 sm:px-8 md:px-[80px]'>
        <div className='mx-auto max-w-3xl space-y-10'>
          {course.modules.map((mod, modIndex) => (
            <div key={mod.id}>
              <div className='mb-4 flex items-center gap-3'>
                <span className='text-[#555] text-[12px]'>Module {modIndex + 1}</span>
                <div className='h-px flex-1 bg-[#2A2A2A]' />
              </div>
              <h2 className='mb-4 font-[430] text-[#ECECEC] text-[18px]'>{mod.title}</h2>
              <div className='space-y-2'>
                {mod.lessons.map((lesson) => (
                  <Link
                    key={lesson.id}
                    href={`/academy/${courseSlug}/${lesson.slug}`}
                    className='flex items-center gap-3 rounded-[8px] border border-[#2A2A2A] bg-[#222] px-4 py-3 text-[14px] transition-colors hover:border-[#3A3A3A] hover:bg-[#272727]'
                  >
                    {completedIds.has(lesson.id) ? (
                      <CheckCircle2 className='h-4 w-4 flex-shrink-0 text-[#4CAF50]' />
                    ) : (
                      <Circle className='h-4 w-4 flex-shrink-0 text-[#444]' />
                    )}
                    <span className='flex-1 text-[#ECECEC]'>{lesson.title}</span>
                    <span className='text-[#555] text-[12px] capitalize'>{lesson.lessonType}</span>
                    {lesson.videoDurationSeconds && (
                      <span className='text-[#555] text-[12px]'>
                        {Math.round(lesson.videoDurationSeconds / 60)} min
                      </span>
                    )}
                  </Link>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>

      {totalLessons > 0 && completedCount === totalLessons && (
        <section className='px-4 pb-16 sm:px-8 md:px-[80px]'>
          <div className='mx-auto max-w-3xl rounded-[8px] border border-[#3A4A3A] bg-[#1F2A1F] p-6'>
            {certificate ? (
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <GraduationCap className='h-6 w-6 text-[#4CAF50]' />
                  <div>
                    <p className='font-[430] text-[#ECECEC] text-[15px]'>Certificate issued!</p>
                    <p className='font-mono text-[#666] text-[13px]'>
                      {certificate.certificateNumber}
                    </p>
                  </div>
                </div>
                <Link
                  href={`/academy/certificate/${certificate.certificateNumber}`}
                  className='flex items-center gap-1.5 rounded-[5px] bg-[#4CAF50] px-4 py-2 font-[430] text-[#1C1C1C] text-[13px] transition-colors hover:bg-[#5DBF61]'
                >
                  View certificate
                  <ExternalLink className='h-3.5 w-3.5' />
                </Link>
              </div>
            ) : (
              <div className='flex items-center justify-between'>
                <div className='flex items-center gap-3'>
                  <GraduationCap className='h-6 w-6 text-[#4CAF50]' />
                  <div>
                    <p className='font-[430] text-[#ECECEC] text-[15px]'>Course Complete!</p>
                    <p className='text-[#666] text-[13px]'>
                      {session
                        ? error
                          ? 'Something went wrong. Try again.'
                          : 'Claim your certificate of completion.'
                        : 'Sign in to claim your certificate.'}
                    </p>
                  </div>
                </div>
                {session ? (
                  <button
                    type='button'
                    disabled={isPending}
                    onClick={() =>
                      issueCertificate({
                        courseId: course.id,
                        completedLessonIds: [...completedIds],
                      })
                    }
                    className='flex items-center gap-2 rounded-[5px] bg-[#ECECEC] px-4 py-2 font-[430] text-[#1C1C1C] text-[13px] transition-colors hover:bg-white disabled:opacity-50'
                  >
                    {isPending && <Loader2 className='h-3.5 w-3.5 animate-spin' />}
                    {isPending ? 'Issuing…' : 'Get certificate'}
                  </button>
                ) : (
                  <Link
                    href='/login'
                    className='rounded-[5px] bg-[#ECECEC] px-4 py-2 font-[430] text-[#1C1C1C] text-[13px] transition-colors hover:bg-white'
                  >
                    Sign in
                  </Link>
                )}
              </div>
            )}
          </div>
        </section>
      )}
    </>
  )
}
