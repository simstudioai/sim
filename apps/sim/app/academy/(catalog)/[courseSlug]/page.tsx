'use client'
import { use, useEffect, useState } from 'react'
import { CheckCircle2, Circle, Clock, GraduationCap } from 'lucide-react'
import Link from 'next/link'
import { getCourse } from '@/lib/academy/content'
import { getCompletedLessons } from '@/lib/academy/local-progress'

interface CourseDetailPageProps {
  params: Promise<{ courseSlug: string }>
}

export default function CourseDetailPage({ params }: CourseDetailPageProps) {
  const { courseSlug } = use(params)
  const course = getCourse(courseSlug)
  const [completedIds, setCompletedIds] = useState<Set<string>>(new Set())

  useEffect(() => {
    setCompletedIds(getCompletedLessons())
  }, [])

  if (!course) {
    return (
      <main className='flex min-h-[60vh] items-center justify-center'>
        <p className='text-[#666] text-[14px]'>Course not found.</p>
      </main>
    )
  }

  const allLessons = course.modules.flatMap((m) => m.lessons)
  const totalLessons = allLessons.length
  const completedCount = allLessons.filter((l) => completedIds.has(l.id)).length
  const percentComplete = totalLessons > 0 ? Math.round((completedCount / totalLessons) * 100) : 0

  return (
    <main>
      {/* Course header */}
      <section className='border-[#2A2A2A] border-b px-4 py-16 sm:px-8 md:px-[80px]'>
        <div className='mx-auto max-w-3xl'>
          <Link
            href='/academy'
            className='mb-4 inline-flex items-center gap-1.5 text-[#666] text-[13px] transition-colors hover:text-[#999]'
          >
            ← All courses
          </Link>
          <h1 className='mb-3 font-[430] text-[#ECECEC] text-[36px] leading-[115%] tracking-[-0.02em]'>
            {course.title}
          </h1>
          {course.description && (
            <p className='mb-6 text-[#F6F6F0]/60 text-[16px] leading-[160%]'>
              {course.description}
            </p>
          )}

          {/* Progress bar — only shown once the user has started */}
          {completedCount > 0 && (
            <div className='mt-6 rounded-[8px] border border-[#2A2A2A] bg-[#222] p-4'>
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
          )}

          <div className='mt-6 flex items-center gap-5 text-[#666] text-[13px]'>
            {course.estimatedMinutes && (
              <span className='flex items-center gap-1.5'>
                <Clock className='h-3.5 w-3.5' />
                {course.estimatedMinutes} min total
              </span>
            )}
            <span className='flex items-center gap-1.5'>
              <GraduationCap className='h-3.5 w-3.5' />
              Certificate upon completion
            </span>
          </div>
        </div>
      </section>

      {/* Modules & lessons */}
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

      {/* Completion banner — shown when all lessons done */}
      {totalLessons > 0 && completedCount === totalLessons && (
        <section className='px-4 pb-16 sm:px-8 md:px-[80px]'>
          <div className='mx-auto max-w-3xl rounded-[8px] border border-[#3A4A3A] bg-[#1F2A1F] p-6'>
            <div className='flex items-center justify-between'>
              <div className='flex items-center gap-3'>
                <GraduationCap className='h-6 w-6 text-[#4CAF50]' />
                <div>
                  <p className='font-[430] text-[#ECECEC] text-[15px]'>Course Complete!</p>
                  <p className='text-[#666] text-[13px]'>Sign in to claim your certificate.</p>
                </div>
              </div>
              <Link
                href='/sign-in'
                className='rounded-[5px] bg-[#ECECEC] px-4 py-2 font-[430] text-[#1C1C1C] text-[13px] transition-colors hover:bg-white'
              >
                Get certificate
              </Link>
            </div>
          </div>
        </section>
      )}
    </main>
  )
}
