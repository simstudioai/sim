import { describe, expect, it } from 'vitest'
import { twilioVoiceHandler } from '@/lib/webhooks/providers/twilio-voice'

describe('twilioVoiceHandler', () => {
  describe('extractIdempotencyId', () => {
    it('distinguishes each CallStatus transition for the same CallSid', () => {
      const ringing = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'ringing',
      })
      const inProgress = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'in-progress',
      })
      const completed = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'completed',
      })
      expect(ringing).not.toBeNull()
      expect(ringing).not.toBe(inProgress)
      expect(inProgress).not.toBe(completed)
    })

    it('distinguishes recording and transcription status callbacks from CallStatus callbacks on the same CallSid', () => {
      const callCompleted = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'completed',
      })
      const recordingCompleted = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        RecordingStatus: 'completed',
      })
      const transcriptionCompleted = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        TranscriptionStatus: 'completed',
      })
      expect(callCompleted).not.toBeNull()
      expect(recordingCompleted).not.toBeNull()
      expect(transcriptionCompleted).not.toBeNull()
      expect(callCompleted).not.toBe(recordingCompleted)
      expect(recordingCompleted).not.toBe(transcriptionCompleted)
    })

    it('distinguishes multiple Gather turns that share the same CallSid and CallStatus', () => {
      const firstDigits = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'in-progress',
        Digits: '1',
      })
      const secondDigits = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'in-progress',
        Digits: '2',
      })
      const speech = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'in-progress',
        SpeechResult: 'sales',
      })
      expect(firstDigits).not.toBe(secondDigits)
      expect(firstDigits).not.toBe(speech)
      expect(secondDigits).not.toBe(speech)
    })

    it('dedupes a retried delivery of the same Gather turn', () => {
      const first = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'in-progress',
        Digits: '1',
      })
      const retry = twilioVoiceHandler.extractIdempotencyId!({
        CallSid: 'CA1',
        CallStatus: 'in-progress',
        Digits: '1',
      })
      expect(first).toBe(retry)
    })
  })
})
