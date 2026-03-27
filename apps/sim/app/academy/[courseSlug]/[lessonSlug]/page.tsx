'use client'

import { use, useCallback, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { getCourse } from '@/lib/academy/content'
import type { Lesson } from '@/lib/academy/types'
import { LessonVideo } from '@/app/academy/components/lesson-video'
import { ExerciseView } from './components/exercise-view'
import { LessonQuiz } from './components/lesson-quiz'

interface LessonPageProps {
  params: Promise<{ courseSlug: string; lessonSlug: string }>
}

export default function LessonPage({ params }: LessonPageProps) {
  const { courseSlug, lessonSlug } = use(params)
  const course = getCourse(courseSlug)
  const [exerciseComplete, setExerciseComplete] = useState(false)

  const allLessons = useMemo<Lesson[]>(
    () => course?.modules.flatMap((m) => m.lessons) ?? [],
    [course]
  )

  const currentIndex = allLessons.findIndex((l) => l.slug === lessonSlug)
  const lesson = allLessons[currentIndex]
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null

  const handleComplete = useCallback(() => setExerciseComplete(true), [])
  const canAdvance = (!lesson.exerciseConfig && !lesson.quizConfig) || exerciseComplete

  if (!course || !lesson) {
    return (
      <div className='flex h-screen items-center justify-center bg-[#1C1C1C]'>
        <p className='text-[#666] text-[14px]'>Lesson not found.</p>
      </div>
    )
  }

  const hasVideo = Boolean(lesson.videoUrl)
  const hasExercise = Boolean(lesson.exerciseConfig)
  const hasQuiz = Boolean(lesson.quizConfig)
  const isExercise = lesson.lessonType === 'exercise'
  const isQuiz = lesson.lessonType === 'quiz'
  const isMixed = lesson.lessonType === 'mixed'
  const isVideo = lesson.lessonType === 'video'

  return (
    <div className='flex h-screen flex-col overflow-hidden bg-[#1C1C1C]'>
      {/* Top nav */}
      <header className='flex h-[52px] flex-shrink-0 items-center justify-between border-[#2A2A2A] border-b bg-[#1C1C1C] px-5'>
        <div className='flex items-center gap-3 text-[13px]'>
          <Link href='/' aria-label='Sim home'>
            <Image
              src='/logo/b&w/text/b&w.svg'
              alt='Sim'
              width={40}
              height={14}
              className='opacity-70 invert transition-opacity hover:opacity-100'
            />
          </Link>
          <span className='text-[#333]'>/</span>
          <Link href='/academy' className='text-[#666] transition-colors hover:text-[#999]'>
            Academy
          </Link>
          <span className='text-[#333]'>/</span>
          <Link
            href={`/academy/${courseSlug}`}
            className='max-w-[160px] truncate text-[#666] transition-colors hover:text-[#999]'
          >
            {course.title}
          </Link>
          <span className='text-[#333]'>/</span>
          <span className='max-w-[200px] truncate text-[#ECECEC]'>{lesson.title}</span>
        </div>

        <div className='flex items-center gap-2'>
          {prevLesson && (
            <Link
              href={`/academy/${courseSlug}/${prevLesson.slug}`}
              className='flex items-center gap-1 rounded-[5px] border border-[#2A2A2A] px-3 py-1.5 text-[#999] text-[12px] transition-colors hover:border-[#3A3A3A] hover:text-[#ECECEC]'
            >
              <ChevronLeft className='h-3.5 w-3.5' />
              Previous
            </Link>
          )}
          {nextLesson && (
            <Link
              href={`/academy/${courseSlug}/${nextLesson.slug}`}
              onClick={(e) => {
                if (!canAdvance) e.preventDefault()
              }}
              className={`flex items-center gap-1 rounded-[5px] px-3 py-1.5 text-[12px] transition-colors ${
                canAdvance
                  ? 'bg-[#ECECEC] text-[#1C1C1C] hover:bg-white'
                  : 'cursor-not-allowed border border-[#2A2A2A] text-[#444]'
              }`}
            >
              Next
              <ChevronRight className='h-3.5 w-3.5' />
            </Link>
          )}
        </div>
      </header>

      {/* Lesson body */}
      <div className='flex min-h-0 flex-1 overflow-hidden'>
        {isVideo && hasVideo && (
          <div className='flex flex-1 items-center justify-center overflow-y-auto p-10'>
            <div className='w-full max-w-3xl'>
              <LessonVideo url={lesson.videoUrl!} title={lesson.title} />
              {lesson.description && (
                <p className='mt-5 text-[#999] text-[15px] leading-[160%]'>{lesson.description}</p>
              )}
            </div>
          </div>
        )}

        {isExercise && hasExercise && (
          <ExerciseView
            lessonId={lesson.id}
            exerciseConfig={lesson.exerciseConfig!}
            onComplete={handleComplete}
          />
        )}

        {isQuiz && hasQuiz && (
          <div className='flex flex-1 items-start justify-center overflow-y-auto p-10'>
            <div className='w-full max-w-2xl'>
              <LessonQuiz
                lessonId={lesson.id}
                quizConfig={lesson.quizConfig!}
                onPass={handleComplete}
              />
            </div>
          </div>
        )}

        {isMixed && (
          <>
            {hasExercise && (
              <ExerciseView
                lessonId={lesson.id}
                exerciseConfig={lesson.exerciseConfig!}
                onComplete={handleComplete}
                videoUrl={lesson.videoUrl}
                description={lesson.description}
              />
            )}
            {!hasExercise && hasQuiz && (
              <div className='flex flex-1 items-start justify-center overflow-y-auto p-8'>
                <div className='w-full max-w-xl'>
                  <LessonQuiz
                    lessonId={lesson.id}
                    quizConfig={lesson.quizConfig!}
                    onPass={handleComplete}
                  />
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
