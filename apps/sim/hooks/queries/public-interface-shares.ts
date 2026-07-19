import { useMutation } from '@tanstack/react-query'
import { requestJson } from '@/lib/api/client/request'
import {
  type AuthenticatePublicInterfaceResponse,
  authenticatePublicInterfaceContract,
  requestPublicInterfaceOtpContract,
  type VerifyPublicInterfaceOtpResponse,
  verifyPublicInterfaceOtpContract,
} from '@/lib/api/contracts/public-shares'

/**
 * Auth-exchange mutations for the public interface page (`/i/[token]`).
 *
 * These mint the `interface_auth_{shareId}` cookie the server gate reads; there
 * is no cached server state behind them, so this module declares no query keys.
 * The interface's own data never flows through here — every module's payload is
 * derived server-side from the stored layout.
 */

/**
 * Exchanges a share password for an `interface_auth_{shareId}` cookie. On
 * success the page should `router.refresh()` to re-render the now-authorized
 * interface.
 */
export function usePublicInterfaceAuth(token: string) {
  return useMutation<AuthenticatePublicInterfaceResponse, Error, { password: string }>({
    mutationFn: ({ password }) =>
      requestJson(authenticatePublicInterfaceContract, {
        params: { token },
        body: { password },
      }),
  })
}

/** Requests a verification code for an email-gated interface share (initial send + resend). */
export function usePublicInterfaceOtpRequest(token: string) {
  return useMutation<{ message: string }, Error, { email: string }>({
    mutationFn: ({ email }) =>
      requestJson(requestPublicInterfaceOtpContract, {
        params: { token },
        body: { email },
      }),
  })
}

/**
 * Verifies the OTP for an email-gated interface share. On success the server
 * sets the `interface_auth_{shareId}` cookie; the page should then
 * `router.refresh()`.
 */
export function usePublicInterfaceOtpVerify(token: string) {
  return useMutation<VerifyPublicInterfaceOtpResponse, Error, { email: string; otp: string }>({
    mutationFn: ({ email, otp }) =>
      requestJson(verifyPublicInterfaceOtpContract, {
        params: { token },
        body: { email, otp },
      }),
  })
}
