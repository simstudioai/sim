// On-device i18n translator using Apple Foundation Models (Apple Intelligence).
//
// Long-lived process: loads the model once, then reads one English string per
// stdin line and prints one translated line to stdout (1:1 mapping). The driver
// (run.ts) handles JSON structure, placeholders are preserved by instruction.
//
// Usage:  swift translate.swift "Russian"   (or "German")
// Prereq: Apple Intelligence enabled (System Settings → Apple Intelligence & Siri).
// Exit 2 = model unavailable.
import Foundation
import FoundationModels

setvbuf(stdout, nil, _IONBF, 0) // unbuffered: flush each translated line immediately

let lang = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : "Russian"

let model = SystemLanguageModel.default
if case .unavailable(let reason) = model.availability {
    FileHandle.standardError.write("UNAVAILABLE: \(reason)\n".data(using: .utf8)!)
    exit(2)
}

let instructions = """
You are a professional UI localization engine for a software product named "Sim" (an AI workspace).
Translate each input from English to \(lang).
Rules:
- Output ONLY the translation, nothing else — no quotes, no notes, no original text.
- Preserve EXACTLY, untranslated: placeholder tokens like {name}, {count}, {{x}}, %s, $1; HTML tags; markdown; URLs; code; and the product name "Sim".
- Keep it concise and natural for a UI label/button/message.
- Keep the same capitalization style and trailing punctuation as the source.
"""

while let raw = readLine(strippingNewline: true) {
    let input = raw.replacingOccurrences(of: "\\n", with: "\n")
    if input.trimmingCharacters(in: .whitespaces).isEmpty {
        print("")
        continue
    }
    let sem = DispatchSemaphore(value: 0)
    var out = "__ERROR__"
    Task {
        do {
            // Fresh session per line avoids cross-string context bleed.
            let session = LanguageModelSession(instructions: instructions)
            let resp = try await session.respond(to: input)
            out = resp.content.trimmingCharacters(in: .whitespacesAndNewlines)
        } catch {
            FileHandle.standardError.write("ERR: \(error)\n".data(using: .utf8)!)
            out = "__ERROR__"
        }
        sem.signal()
    }
    sem.wait()
    // Collapse any internal newlines so the 1-line-in / 1-line-out contract holds.
    print(out.replacingOccurrences(of: "\n", with: " "))
}
