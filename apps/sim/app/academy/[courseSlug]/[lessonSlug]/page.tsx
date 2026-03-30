'use client'

import { use, useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { getCourse } from '@/lib/academy/content'
import { markLessonComplete } from '@/lib/academy/local-progress'
import type { Lesson } from '@/lib/academy/types'
import { LessonVideo } from '@/app/academy/components/lesson-video'
import { ExerciseView } from './components/exercise-view'
import { LessonQuiz } from './components/lesson-quiz'

const navBtnClass =
  'flex items-center gap-1 rounded-[5px] border border-[#2A2A2A] px-3 py-1.5 text-[#999] text-[12px] transition-colors hover:border-[#3A3A3A] hover:text-[#ECECEC]'

interface LessonPageProps {
  params: Promise<{ courseSlug: string; lessonSlug: string }>
}

export default function LessonPage({ params }: LessonPageProps) {
  const { courseSlug, lessonSlug } = use(params)
  const course = getCourse(courseSlug)
  const [exerciseComplete, setExerciseComplete] = useState(false)
  const [quizComplete, setQuizComplete] = useState(false)
  // Reset completion state when the lesson changes (Next.js reuses the component across navigations).
  const [prevLessonSlug, setPrevLessonSlug] = useState(lessonSlug)
  if (prevLessonSlug !== lessonSlug) {
    setPrevLessonSlug(lessonSlug)
    setExerciseComplete(false)
    setQuizComplete(false)
  }

  const allLessons = useMemo<Lesson[]>(
    () => course?.modules.flatMap((m) => m.lessons) ?? [],
    [course]
  )

  const currentIndex = allLessons.findIndex((l) => l.slug === lessonSlug)
  const lesson = allLessons[currentIndex]
  const prevLesson = currentIndex > 0 ? allLessons[currentIndex - 1] : null
  const nextLesson = currentIndex < allLessons.length - 1 ? allLessons[currentIndex + 1] : null

  const handleExerciseComplete = useCallback(() => setExerciseComplete(true), [])
  const handleQuizPass = useCallback(() => setQuizComplete(true), [])
  const canAdvance =
    (!lesson?.exerciseConfig && !lesson?.quizConfig) ||
    (Boolean(lesson?.exerciseConfig) && Boolean(lesson?.quizConfig)
      ? exerciseComplete && quizComplete
      : lesson?.exerciseConfig
        ? exerciseComplete
        : quizComplete)

  const isUngatedLesson =
    lesson?.lessonType === 'video' ||
    (lesson?.lessonType === 'mixed' && !lesson.exerciseConfig && !lesson.quizConfig)

  useEffect(() => {
    if (isUngatedLesson && lesson) {
      markLessonComplete(lesson.id)
    }
  }, [lesson?.id, isUngatedLesson])

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

  return (
    <div className='fixed inset-0 flex flex-col overflow-hidden bg-[#1C1C1C]'>
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
          {prevLesson ? (
            <Link href={`/academy/${courseSlug}/${prevLesson.slug}`} className={navBtnClass}>
              <ChevronLeft className='h-3.5 w-3.5' />
              Previous
            </Link>
          ) : (
            <Link href={`/academy/${courseSlug}`} className={navBtnClass}>
              <ChevronLeft className='h-3.5 w-3.5' />
              Course
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

      <div className='flex min-h-0 flex-1 overflow-hidden'>
        {lesson.lessonType === 'video' && hasVideo && (
          <div className='flex-1 overflow-y-auto p-10'>
            <div className='mx-auto w-full max-w-3xl'>
              <LessonVideo url={lesson.videoUrl!} title={lesson.title} />
              {lesson.description && (
                <p className='mt-5 text-[#999] text-[15px] leading-[160%]'>{lesson.description}</p>
              )}
            </div>
          </div>
        )}

        {lesson.lessonType === 'exercise' && hasExercise && (
          <ExerciseView
            lessonId={lesson.id}
            exerciseConfig={lesson.exerciseConfig!}
            onComplete={handleExerciseComplete}
          />
        )}

        {lesson.lessonType === 'quiz' && hasQuiz && (
          <div className='flex-1 overflow-y-auto p-10'>
            <div className='mx-auto w-full max-w-2xl'>
              <LessonQuiz
                lessonId={lesson.id}
                quizConfig={lesson.quizConfig!}
                onPass={handleQuizPass}
              />
            </div>
          </div>
        )}

        {lesson.lessonType === 'mixed' && (
          <>
            {hasExercise && (!exerciseComplete || !hasQuiz) && (
              <ExerciseView
                lessonId={lesson.id}
                exerciseConfig={lesson.exerciseConfig!}
                onComplete={handleExerciseComplete}
                videoUrl={!hasQuiz ? lesson.videoUrl : undefined}
                description={!hasQuiz ? lesson.description : undefined}
              />
            )}
            {hasExercise && exerciseComplete && hasQuiz && (
              <div className='flex-1 overflow-y-auto p-8'>
                <div className='mx-auto w-full max-w-xl space-y-8'>
                  {hasVideo && <LessonVideo url={lesson.videoUrl!} title={lesson.title} />}
                  <LessonQuiz
                    lessonId={lesson.id}
                    quizConfig={lesson.quizConfig!}
                    onPass={handleQuizPass}
                  />
                </div>
              </div>
            )}
            {!hasExercise && hasQuiz && (
              <div className='flex-1 overflow-y-auto p-8'>
                <div className='mx-auto w-full max-w-xl space-y-8'>
                  {hasVideo && <LessonVideo url={lesson.videoUrl!} title={lesson.title} />}
                  <LessonQuiz
                    lessonId={lesson.id}
                    quizConfig={lesson.quizConfig!}
                    onPass={handleQuizPass}
                  />
                </div>
              </div>
            )}
            {!hasExercise && !hasQuiz && hasVideo && (
              <div className='flex-1 overflow-y-auto p-10'>
                <div className='mx-auto w-full max-w-3xl'>
                  <LessonVideo url={lesson.videoUrl!} title={lesson.title} />
                  {lesson.description && (
                    <p className='mt-5 text-[#999] text-[15px] leading-[160%]'>
                      {lesson.description}
                    </p>
                  )}
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
