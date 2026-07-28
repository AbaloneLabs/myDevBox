import { describe, expect, it } from "vitest"
import { decrypt, encrypt } from "../src/db/crypto.js"

describe("crypto (AES-256-GCM)", () => {
  it("round-trips a plaintext string", () => {
    const original = "super-secret-api-key-12345"
    const encrypted = encrypt(original)

    // Shape contract: base64(iv):base64(authTag):base64(ciphertext)
    expect(encrypted.split(":")).toHaveLength(3)
    expect(encrypted).not.toBe(original)

    expect(decrypt(encrypted)).toBe(original)
  })

  it("uses a fresh random IV per call (same plaintext -> different ciphertext)", () => {
    const a = encrypt("same-input")
    const b = encrypt("same-input")
    expect(a).not.toBe(b)
    expect(decrypt(a)).toBe("same-input")
    expect(decrypt(b)).toBe("same-input")
  })

  it("round-trips unicode / multi-byte text", () => {
    const original = "한글 🚀 unicode — café"
    expect(decrypt(encrypt(original))).toBe(original)
  })

  it("rejects malformed input with the wrong number of segments", () => {
    expect(() => decrypt("not-a-valid-token")).toThrow()
    expect(() => decrypt("only:two-parts")).toThrow()
    expect(() => decrypt("a:b:c:d")).toThrow()
  })

  it("rejects tampered ciphertext (auth-tag verification fails)", () => {
    const [ivB64, authTagB64, ciphertext] = encrypt("secret").split(":")
    // Flip the last base64 char to another valid char (same length, different value).
    const last = ciphertext.at(-1)!
    const swap = last === "A" ? "B" : "A"
    const tampered = `${ivB64}:${authTagB64}:${ciphertext.slice(0, -1)}${swap}`
    expect(() => decrypt(tampered)).toThrow()
  })

  it("rejects garbage that happens to have three segments", () => {
    expect(() => decrypt("AAAA:BBBB:CCCC")).toThrow()
  })
})
