// Probe: is Apple's on-device Foundation Model available, and can it translate?
// Run: swift scripts/i18n-translate/probe.swift
import Foundation
import FoundationModels

func err(_ s: String) { FileHandle.standardError.write((s + "\n").data(using: .utf8)!) }

let sem = DispatchSemaphore(value: 0)
Task {
    let model = SystemLanguageModel.default
    switch model.availability {
    case .available:
        err("availability: available")
    case .unavailable(let reason):
        err("availability: UNAVAILABLE (\(reason))")
        print("UNAVAILABLE")
        sem.signal(); return
    @unknown default:
        err("availability: unknown")
    }
    do {
        let session = LanguageModelSession(
            instructions: "You are a precise UI string translator. Translate the user's text to Russian. Output ONLY the translation, no quotes, no notes."
        )
        let response = try await session.respond(to: "Create new workflow")
        print("RU: \(response.content)")
    } catch {
        print("ERROR: \(error)")
    }
    sem.signal()
}
sem.wait()
