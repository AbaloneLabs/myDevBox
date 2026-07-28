import crypto from "node:crypto"
import { describe, expect, it } from "vitest"
import { generatePKCE } from "../src/agent/oauth.js"

const BASE64URL = /^[A-Za-z0-9_-]+$/

describe("generatePKCE (S256)", () => {
  it("returns non-empty base64url verifier and challenge", async () => {
    const { verifier, challenge } = await generatePKCE()

    expect(verifier.length).toBeGreaterThan(0)
    expect(challenge.length).toBeGreaterThan(0)
    expect(verifier).toMatch(BASE64URL)
    expect(challenge).toMatch(BASE64URL)
  })

  it("satisfies the S256 contract: challenge === base64url(SHA256(verifier))", async () => {
    const { verifier, challenge } = await generatePKCE()

    const expected = crypto
      .createHash("sha256")
      .update(verifier)
      .digest()
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=$/, "")

    expect(challenge).toBe(expected)
  })

  it("generates a fresh verifier/challenge pair on each call", async () => {
    const a = await generatePKCE()
    const b = await generatePKCE()
    expect(a.verifier).not.toBe(b.verifier)
    expect(a.challenge).not.toBe(b.challenge)
  })
})
