import { Clock, GraduationCap } from 'lucide-react'
import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { COURSES, getCourse } from '@/lib/academy/content'
import { CourseProgress } from './components/course-progress'

interface CourseDetailPageProps {
  params: Promise<{ courseSlug: string }>
}

export function generateStaticParams() {
  return COURSES.map((course) => ({ courseSlug: course.slug }))
}

export async function generateMetadata({ params }: CourseDetailPageProps): Promise<Metadata> {
  const { courseSlug } = await params
  const course = getCourse(courseSlug)
  if (!course) return { title: 'Course Not Found' }
  return {
    title: course.title,
    description: course.description,
  }
}

export default async function CourseDetailPage({ params }: CourseDetailPageProps) {
  const { courseSlug } = await params
  const course = getCourse(courseSlug)

  if (!course) notFound()

  return (
    <main>
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

      <CourseProgress course={course} courseSlug={courseSlug} />
    </main>
  )
}
