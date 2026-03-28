'use client'

import type React from 'react'
import { use } from 'react'
import { CheckCircle2, GraduationCap } from 'lucide-react'
import { useAcademyCertificate } from '@/hooks/queries/academy'

const DATE_FORMAT: Intl.DateTimeFormatOptions = { year: 'numeric', month: 'long', day: 'numeric' }
function formatDate(date: string | Date) {
  return new Date(date).toLocaleDateString('en-US', DATE_FORMAT)
}

function MetaRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className='flex items-center justify-between px-5 py-3.5'>
      <span className='text-[#666] text-[13px]'>{label}</span>
      {children}
    </div>
  )
}

interface CertificatePageProps {
  params: Promise<{ certificateNumber: string }>
}

export default function CertificatePage({ params }: CertificatePageProps) {
  const { certificateNumber } = use(params)
  const { data: certificate, isLoading, error } = useAcademyCertificate(certificateNumber)

  return (
    <main className='flex flex-1 items-center justify-center px-6 py-20'>
      {isLoading ? (
        <div className='h-5 w-5 animate-spin rounded-full border-2 border-[#ECECEC] border-t-transparent' />
      ) : error || !certificate ? (
        <div className='text-center'>
          <p className='mb-3 text-[#999] text-[16px]'>Certificate not found.</p>
          <p className='text-[#555] text-[14px]'>
            Certificate number{' '}
            <span className='font-[430] text-[#ECECEC]'>{certificateNumber}</span> is invalid or has
            been revoked.
          </p>
        </div>
      ) : (
        <div className='w-full max-w-2xl'>
          <div className='rounded-[12px] border border-[#3A4A3A] bg-[#1C2A1C] p-10 text-center'>
            <div className='mb-6 flex justify-center'>
              <div className='flex h-16 w-16 items-center justify-center rounded-full border-2 border-[#4CAF50]/40 bg-[#4CAF50]/10'>
                <GraduationCap className='h-8 w-8 text-[#4CAF50]' />
              </div>
            </div>

            <div className='mb-2 text-[#4CAF50]/70 text-[13px] uppercase tracking-[0.12em]'>
              Certificate of Completion
            </div>

            <h1 className='mb-1 font-[430] text-[#ECECEC] text-[28px] leading-[120%]'>
              {certificate.metadata?.courseTitle}
            </h1>

            {certificate.metadata?.recipientName && (
              <p className='mb-6 text-[#999] text-[16px]'>
                Awarded to{' '}
                <span className='text-[#ECECEC]'>{certificate.metadata.recipientName}</span>
              </p>
            )}

            <div className='flex items-center justify-center gap-2 text-[#4CAF50]'>
              <CheckCircle2 className='h-4 w-4' />
              <span className='font-[430] text-[14px]'>Verified</span>
            </div>
          </div>

          <div className='mt-6 divide-y divide-[#2A2A2A] rounded-[8px] border border-[#2A2A2A] bg-[#222]'>
            <MetaRow label='Certificate number'>
              <span className='font-mono text-[#ECECEC] text-[13px]'>
                {certificate.certificateNumber}
              </span>
            </MetaRow>
            <MetaRow label='Issued'>
              <span className='text-[#ECECEC] text-[13px]'>{formatDate(certificate.issuedAt)}</span>
            </MetaRow>
            <MetaRow label='Status'>
              <span
                className={`text-[13px] capitalize ${
                  certificate.status === 'active' ? 'text-[#4CAF50]' : 'text-[#f44336]'
                }`}
              >
                {certificate.status}
              </span>
            </MetaRow>
            {certificate.expiresAt && (
              <MetaRow label='Expires'>
                <span className='text-[#ECECEC] text-[13px]'>
                  {formatDate(certificate.expiresAt)}
                </span>
              </MetaRow>
            )}
          </div>

          <p className='mt-5 text-center text-[#555] text-[13px]'>
            This certificate was issued by Sim AI, Inc. and verifies the holder has completed the{' '}
            {certificate.metadata?.courseTitle} program.
          </p>
        </div>
      )}
    </main>
  )
}
