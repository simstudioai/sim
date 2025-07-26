/**
 * @vitest-environment jsdom
 */

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { useRouter, useSearchParams } from 'next/navigation'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { client } from '@/lib/auth-client'
import SignupPage from '@/app/(auth)/signup/signup-form'

vi.mock('next/navigation', () => ({
  useRouter: vi.fn(),
  useSearchParams: vi.fn(),
}))

vi.mock('@/lib/auth-client', () => ({
  client: {
    signUp: {
      email: vi.fn(),
    },
    emailOtp: {
      sendVerificationOtp: vi.fn(),
    },
  },
}))

vi.mock('@/app/(auth)/components/social-login-buttons', () => ({
  SocialLoginButtons: () => <div data-testid='social-login-buttons'>Social Login Buttons</div>,
}))

const mockRouter = {
  push: vi.fn(),
  replace: vi.fn(),
  back: vi.fn(),
}

const mockSearchParams = {
  get: vi.fn(),
}

describe('SignupPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    ;(useRouter as any).mockReturnValue(mockRouter)
    ;(useSearchParams as any).mockReturnValue(mockSearchParams)
    mockSearchParams.get.mockReturnValue(null)
  })

  const defaultProps = {
    githubAvailable: true,
    googleAvailable: true,
    isProduction: false,
  }

  describe('Basic Rendering', () => {
    it('should render signup form with all required elements', () => {
      render(<SignupPage {...defaultProps} />)

      expect(screen.getByPlaceholderText(/enter your name/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/enter your email/i)).toBeInTheDocument()
      expect(screen.getByPlaceholderText(/enter your password/i)).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /create account/i })).toBeInTheDocument()
      expect(screen.getByText(/sign in/i)).toBeInTheDocument()
    })

    it('should render social login buttons', () => {
      render(<SignupPage {...defaultProps} />)

      expect(screen.getByTestId('social-login-buttons')).toBeInTheDocument()
    })
  })

  describe('Password Visibility Toggle', () => {
    it('should toggle password visibility when button is clicked', () => {
      render(<SignupPage {...defaultProps} />)

      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const toggleButton = screen.getByLabelText(/show password/i)

      expect(passwordInput).toHaveAttribute('type', 'password')

      fireEvent.click(toggleButton)
      expect(passwordInput).toHaveAttribute('type', 'text')

      fireEvent.click(toggleButton)
      expect(passwordInput).toHaveAttribute('type', 'password')
    })
  })

  describe('Form Interaction', () => {
    it('should allow users to type in form fields', () => {
      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)

      fireEvent.change(nameInput, { target: { value: 'John Doe' } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
      fireEvent.change(passwordInput, { target: { value: 'Password123!' } })

      expect(nameInput).toHaveValue('John Doe')
      expect(emailInput).toHaveValue('test@example.com')
      expect(passwordInput).toHaveValue('Password123!')
    })

    it('should show loading state during form submission', async () => {
      const mockSignUp = vi.mocked(client.signUp.email)
      mockSignUp.mockImplementation(
        () => new Promise((resolve) => resolve({ data: { user: { id: '1' } }, error: null }))
      )

      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      fireEvent.change(nameInput, { target: { value: 'John Doe' } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
      fireEvent.change(passwordInput, { target: { value: 'Password123!' } })
      fireEvent.click(submitButton)

      expect(screen.getByText('Creating account...')).toBeInTheDocument()
      expect(submitButton).toBeDisabled()
    })
  })

  describe('Form Submission', () => {
    it('should call signUp with correct credentials and trimmed name', async () => {
      const mockSignUp = vi.mocked(client.signUp.email)
      const mockSendOtp = vi.mocked(client.emailOtp.sendVerificationOtp)

      mockSignUp.mockResolvedValue({ data: { user: { id: '1' } }, error: null })
      mockSendOtp.mockResolvedValue({ data: null, error: null })

      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      // Use valid input that passes all validation rules
      fireEvent.change(nameInput, { target: { value: 'John Doe' } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
      fireEvent.change(passwordInput, { target: { value: 'Password123!' } })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith(
          {
            email: 'test@example.com',
            password: 'Password123!',
            name: 'John Doe',
          },
          expect.objectContaining({
            onError: expect.any(Function),
          })
        )
      })
    })

    it('should prevent submission with invalid name validation', async () => {
      const mockSignUp = vi.mocked(client.signUp.email)

      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      // Use name with leading/trailing spaces which should fail validation
      fireEvent.change(nameInput, { target: { value: '  John Doe  ' } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
      fireEvent.change(passwordInput, { target: { value: 'Password123!' } })
      fireEvent.click(submitButton)

      // Should not call signUp because validation failed
      expect(mockSignUp).not.toHaveBeenCalled()

      // Should show validation error
      await waitFor(() => {
        expect(
          screen.getByText(
            /Name cannot contain consecutive spaces|Name cannot start or end with spaces/
          )
        ).toBeInTheDocument()
      })
    })

    it('should redirect to verification page after successful signup', async () => {
      const mockSignUp = vi.mocked(client.signUp.email)
      const mockSendOtp = vi.mocked(client.emailOtp.sendVerificationOtp)

      mockSignUp.mockResolvedValue({ data: { user: { id: '1' } }, error: null })
      mockSendOtp.mockResolvedValue({ data: null, error: null })

      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      fireEvent.change(nameInput, { target: { value: 'John Doe' } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
      fireEvent.change(passwordInput, { target: { value: 'Password123!' } })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockSendOtp).toHaveBeenCalledWith({
          email: 'test@example.com',
          type: 'email-verification',
        })
        expect(mockRouter.push).toHaveBeenCalledWith('/verify?fromSignup=true')
      })
    })

    it('should handle signup errors', async () => {
      const mockSignUp = vi.mocked(client.signUp.email)

      mockSignUp.mockImplementation((credentials, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              code: 'USER_ALREADY_EXISTS',
              message: 'User already exists',
            } as any,
            response: {} as any,
            request: {} as any,
          } as any)
        }
        return Promise.resolve({ data: null, error: 'User already exists' })
      })

      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'John Doe' } })
        fireEvent.change(emailInput, { target: { value: 'existing@example.com' } })
        fireEvent.change(passwordInput, { target: { value: 'Password123!' } })
        fireEvent.click(submitButton)
      })

      await waitFor(() => {
        expect(screen.getByText('Failed to create account')).toBeInTheDocument()
      })
    })

    it('should show warning for names that would be truncated (over 100 characters)', async () => {
      const mockSignUp = vi.mocked(client.signUp.email)
      const longName = 'a'.repeat(101) // 101 characters

      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      fireEvent.change(nameInput, { target: { value: longName } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
      fireEvent.change(passwordInput, { target: { value: 'ValidPass123!' } })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(screen.getByText(/name will be truncated to 100 characters/i)).toBeInTheDocument()
      })

      // Ensure signUp was not called
      expect(mockSignUp).not.toHaveBeenCalled()
    })

    it('should handle names exactly at 100 characters without warning', async () => {
      const mockSignUp = vi.mocked(client.signUp.email)
      mockSignUp.mockImplementation(
        () => new Promise((resolve) => resolve({ data: { user: { id: '1' } }, error: null }))
      )

      const exactLengthName = 'a'.repeat(100) // Exactly 100 characters

      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      fireEvent.change(nameInput, { target: { value: exactLengthName } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
      fireEvent.change(passwordInput, { target: { value: 'ValidPass123!' } })
      fireEvent.click(submitButton)

      // Should not show truncation warning
      await waitFor(() => {
        expect(screen.queryByText(/name will be truncated/i)).not.toBeInTheDocument()
      })

      // Should proceed with form submission
      await waitFor(() => {
        expect(mockSignUp).toHaveBeenCalledWith(
          {
            email: 'test@example.com',
            password: 'ValidPass123!',
            name: exactLengthName,
          },
          expect.any(Object)
        )
      })
    })

    it('should handle names exactly at validation errors', async () => {
      const mockSignUp = vi.mocked(client.signUp.email)

      mockSignUp.mockImplementation((credentials, options) => {
        if (options?.onError) {
          options.onError({
            error: {
              code: 'NAME_VALIDATION_ERROR',
              message: 'Name validation error',
            } as any,
            response: {} as any,
            request: {} as any,
          } as any)
        }
        return Promise.resolve({ data: null, error: 'Name validation error' })
      })

      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      await act(async () => {
        fireEvent.change(nameInput, { target: { value: 'John Doe' } })
        fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
        fireEvent.change(passwordInput, { target: { value: 'Password123!' } })
        fireEvent.click(submitButton)
      })

      await waitFor(() => {
        expect(screen.getByText('Failed to create account')).toBeInTheDocument()
      })
    })
  })

  describe('URL Parameters', () => {
    it('should prefill email from URL parameter', () => {
      mockSearchParams.get.mockImplementation((param) => {
        if (param === 'email') return 'prefilled@example.com'
        return null
      })

      render(<SignupPage {...defaultProps} />)

      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      expect(emailInput).toHaveValue('prefilled@example.com')
    })

    it('should handle invite flow redirect', async () => {
      mockSearchParams.get.mockImplementation((param) => {
        if (param === 'redirect') return '/invite/123'
        if (param === 'invite_flow') return 'true'
        return null
      })

      const mockSignUp = vi.mocked(client.signUp.email)
      mockSignUp.mockResolvedValue({ data: { user: { id: '1' } }, error: null })

      render(<SignupPage {...defaultProps} />)

      const nameInput = screen.getByPlaceholderText(/enter your name/i)
      const emailInput = screen.getByPlaceholderText(/enter your email/i)
      const passwordInput = screen.getByPlaceholderText(/enter your password/i)
      const submitButton = screen.getByRole('button', { name: /create account/i })

      fireEvent.change(nameInput, { target: { value: 'John Doe' } })
      fireEvent.change(emailInput, { target: { value: 'test@example.com' } })
      fireEvent.change(passwordInput, { target: { value: 'Password123!' } })
      fireEvent.click(submitButton)

      await waitFor(() => {
        expect(mockRouter.push).toHaveBeenCalledWith('/invite/123')
      })
    })

    it('should link to login with invite flow parameters', () => {
      mockSearchParams.get.mockImplementation((param) => {
        if (param === 'invite_flow') return 'true'
        if (param === 'redirect') return '/invite/123'
        return null
      })

      render(<SignupPage {...defaultProps} />)

      const loginLink = screen.getByText(/sign in/i)
      expect(loginLink).toHaveAttribute('href', '/login?invite_flow=true&callbackUrl=/invite/123')
    })

    it('should default to regular login link when no invite flow', () => {
      render(<SignupPage {...defaultProps} />)

      const loginLink = screen.getByText(/sign in/i)
      expect(loginLink).toHaveAttribute('href', '/login')
    })
  })
})
