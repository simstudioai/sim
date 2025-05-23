'use client'

import { KeyboardEvent, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { OTPInputForm } from '@/components/ui/input-otp-form'

interface EmailAuthProps {
  subdomain: string
  onAuthSuccess: () => void
  title?: string
  primaryColor?: string
}

export default function EmailAuth({
  subdomain,
  onAuthSuccess,
  title = 'chat',
  primaryColor = '#802FFF',
}: EmailAuthProps) {
  // Email auth state
  const [email, setEmail] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [isSendingOtp, setIsSendingOtp] = useState(false)
  const [isVerifyingOtp, setIsVerifyingOtp] = useState(false)

  // OTP verification state
  const [showOtpVerification, setShowOtpVerification] = useState(false)
  const [otpValue, setOtpValue] = useState('')

  // Handle email input key down
  const handleEmailKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault()
      handleSendOtp()
    }
  }

  // Handle sending OTP
  const handleSendOtp = async () => {
    setAuthError(null)
    setIsSendingOtp(true)

    try {
      const response = await fetch(`/api/chat/${subdomain}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setAuthError(errorData.error || 'Failed to send verification code')
        return
      }

      setShowOtpVerification(true)
    } catch (error) {
      console.error('Error sending OTP:', error)
      setAuthError('An error occurred while sending the verification code')
    } finally {
      setIsSendingOtp(false)
    }
  }

  const handleVerifyOtp = async (otp?: string) => {
    const codeToVerify = otp || otpValue

    if (!codeToVerify || codeToVerify.length !== 6) {
      return
    }

    setAuthError(null)
    setIsVerifyingOtp(true)

    try {
      const response = await fetch(`/api/chat/${subdomain}/otp`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email, otp: codeToVerify }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setAuthError(errorData.error || 'Invalid verification code')
        return
      }

      onAuthSuccess()
    } catch (error) {
      console.error('Error verifying OTP:', error)
      setAuthError('An error occurred during verification')
    } finally {
      setIsVerifyingOtp(false)
    }
  }

  const handleResendOtp = async () => {
    setAuthError(null)
    setIsSendingOtp(true)

    try {
      const response = await fetch(`/api/chat/${subdomain}/otp`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Requested-With': 'XMLHttpRequest',
        },
        body: JSON.stringify({ email }),
      })

      if (!response.ok) {
        const errorData = await response.json()
        setAuthError(errorData.error || 'Failed to resend verification code')
        return
      }

      setAuthError('Verification code sent. Please check your email.')
    } catch (error) {
      console.error('Error resending OTP:', error)
      setAuthError('An error occurred while resending the verification code')
    } finally {
      setIsSendingOtp(false)
    }
  }

  return (
    <Dialog open={true} onOpenChange={() => {}}>
      <DialogContent
        className="sm:max-w-[450px] flex flex-col p-0 gap-0 overflow-hidden"
        hideCloseButton
      >
        <DialogHeader className="px-6 py-4 border-b">
          <div className="flex items-center justify-center">
            <a
              href="https://simstudio.ai"
              target="_blank"
              rel="noopener noreferrer"
              className="mb-2"
            >
              <svg
                width="40"
                height="40"
                viewBox="0 0 50 50"
                fill="none"
                xmlns="http://www.w3.org/2000/svg"
                className="rounded-[6px]"
              >
                <rect width="50" height="50" fill="#701FFC" />
                <path
                  d="M34.1455 20.0728H16.0364C12.7026 20.0728 10 22.7753 10 26.1091V35.1637C10 38.4975 12.7026 41.2 16.0364 41.2H34.1455C37.4792 41.2 40.1818 38.4975 40.1818 35.1637V26.1091C40.1818 22.7753 37.4792 20.0728 34.1455 20.0728Z"
                  fill="#701FFC"
                  stroke="white"
                  strokeWidth="3.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M25.0919 14.0364C26.7588 14.0364 28.1101 12.6851 28.1101 11.0182C28.1101 9.35129 26.7588 8 25.0919 8C23.425 8 22.0737 9.35129 22.0737 11.0182C22.0737 12.6851 23.425 14.0364 25.0919 14.0364Z"
                  fill="#701FFC"
                  stroke="white"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <path
                  d="M25.0915 14.856V19.0277V14.856ZM20.5645 32.1398V29.1216V32.1398ZM29.619 29.1216V32.1398V29.1216Z"
                  fill="#701FFC"
                />
                <path
                  d="M25.0915 14.856V19.0277M20.5645 32.1398V29.1216M29.619 29.1216V32.1398"
                  stroke="white"
                  strokeWidth="4"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="25" cy="11" r="2" fill="#701FFC" />
              </svg>
            </a>
          </div>
          <DialogTitle className="text-lg font-medium text-center">{title}</DialogTitle>
        </DialogHeader>

        <div className="p-6">
          {!showOtpVerification ? (
            <>
              <div className="mb-4 text-center">
                <p className="text-muted-foreground">
                  This chat requires email verification. Please enter your email to continue.
                </p>
              </div>

              {authError && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
                  {authError}
                </div>
              )}

              <form
                onSubmit={(e) => {
                  e.preventDefault()
                  handleSendOtp()
                }}
                className="space-y-4"
              >
                <div className="space-y-2">
                  <Input
                    id="email"
                    type="email"
                    placeholder="Email address"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    onKeyDown={handleEmailKeyDown}
                    disabled={isSendingOtp}
                    className="w-full"
                    autoFocus
                    autoComplete="off"
                  />
                </div>

                <Button
                  type="submit"
                  onClick={handleSendOtp}
                  disabled={!email || isSendingOtp}
                  className="w-full"
                  style={{ backgroundColor: primaryColor }}
                >
                  {isSendingOtp ? (
                    <div className="flex items-center justify-center">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Sending Code...
                    </div>
                  ) : (
                    'Continue'
                  )}
                </Button>
              </form>
            </>
          ) : (
            <div className="space-y-4">
              <div className="text-center">
                <p className="text-muted-foreground text-sm mb-1">
                  Enter the verification code sent to
                </p>
                <p className="font-medium text-sm break-all">{email}</p>
              </div>

              {authError && (
                <div className="p-3 bg-red-50 border border-red-200 text-red-600 rounded-md text-sm">
                  {authError}
                </div>
              )}

              <OTPInputForm
                onSubmit={(value) => {
                  setOtpValue(value)
                  handleVerifyOtp(value)
                }}
                isLoading={isVerifyingOtp}
                error={null}
              />

              <div className="flex items-center justify-center pt-2">
                <button
                  type="button"
                  onClick={handleResendOtp}
                  disabled={isSendingOtp}
                  className="text-sm text-primary hover:underline disabled:opacity-50"
                >
                  {isSendingOtp ? 'Sending...' : 'Resend code'}
                </button>
                <span className="mx-2 text-neutral-300 dark:text-neutral-600">•</span>
                <button
                  type="button"
                  onClick={() => {
                    setShowOtpVerification(false)
                    setOtpValue('')
                    setAuthError(null)
                  }}
                  className="text-sm text-primary hover:underline"
                >
                  Change email
                </button>
              </div>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
