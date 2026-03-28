import { BookOpen, Clock } from 'lucide-react'
import Link from 'next/link'
import { COURSES } from '@/lib/academy/content'

export default function AcademyCatalogPage() {
  return (
    <main>
      <section className='border-[#2A2A2A] border-b px-4 py-20 sm:px-8 md:px-[80px]'>
        <div className='mx-auto max-w-3xl'>
          <div className='mb-3 text-[#999] text-[13px] uppercase tracking-[0.12em]'>
            Sim Academy
          </div>
          <h1 className='mb-4 font-[430] text-[#ECECEC] text-[48px] leading-[110%] tracking-[-0.02em]'>
            Become a certified
            <br />
            Sim partner
          </h1>
          <p className='text-[#F6F6F0]/60 text-[18px] leading-[160%] tracking-[0.01em]'>
            Master AI workflow automation with hands-on interactive exercises on the real Sim
            canvas. Complete the program to earn your partner certification.
          </p>
        </div>
      </section>

      <section className='px-4 py-16 sm:px-8 md:px-[80px]'>
        <div className='mx-auto max-w-6xl'>
          <h2 className='mb-8 text-[#999] text-[13px] uppercase tracking-[0.12em]'>Courses</h2>
          <div className='grid gap-5 sm:grid-cols-2 lg:grid-cols-3'>
            {COURSES.map((course) => {
              const totalLessons = course.modules.reduce((n, m) => n + m.lessons.length, 0)
              return (
                <Link
                  key={course.id}
                  href={`/academy/${course.slug}`}
                  className='group flex flex-col rounded-[8px] border border-[#2A2A2A] bg-[#232323] p-5 transition-colors hover:border-[#3A3A3A] hover:bg-[#282828]'
                >
                  {course.imageUrl && (
                    <div className='mb-4 aspect-video w-full overflow-hidden rounded-[6px] bg-[#1A1A1A]'>
                      <img
                        src={course.imageUrl}
                        alt={course.title}
                        className='h-full w-full object-cover opacity-80'
                      />
                    </div>
                  )}
                  <div className='flex-1'>
                    <h3 className='mb-2 font-[430] text-[#ECECEC] text-[16px] leading-[130%] group-hover:text-white'>
                      {course.title}
                    </h3>
                    {course.description && (
                      <p className='mb-4 line-clamp-2 text-[#999] text-[14px] leading-[150%]'>
                        {course.description}
                      </p>
                    )}
                  </div>
                  <div className='mt-auto flex items-center gap-4 text-[#666] text-[12px]'>
                    {course.estimatedMinutes && (
                      <span className='flex items-center gap-1.5'>
                        <Clock className='h-3 w-3' />
                        {course.estimatedMinutes} min
                      </span>
                    )}
                    <span className='flex items-center gap-1.5'>
                      <BookOpen className='h-3 w-3' />
                      {totalLessons} lessons
                    </span>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>
    </main>
  )
}
