import { describe, expect, it } from "vitest"
import {
  PROVIDERS,
  PROVIDER_BY_ID,
  resolveBaseUrl,
  type ProviderDescriptor,
} from "../src/agent/llm/registry.js"

const EXPECTED_IDS = ["anthropic", "openai", "xai", "kimi", "copilot"] as const

describe("provider registry", () => {
  describe("PROVIDER_BY_ID", () => {
    it("contains every expected provider id", () => {
      for (const id of EXPECTED_IDS) {
        expect(PROVIDER_BY_ID[id], `missing provider "${id}"`).toBeDefined()
      }
    })

    it("exposes a populated descriptor for each expected id", () => {
      for (const id of EXPECTED_IDS) {
        const descriptor = PROVIDER_BY_ID[id]
        expect(descriptor.id).toBe(id)
        expect(typeof descriptor.displayName).toBe("string")
        expect(descriptor.displayName.length).toBeGreaterThan(0)
      }
    })

    it("is keyed by descriptor.id for every catalog entry", () => {
      for (const descriptor of PROVIDERS) {
        expect(PROVIDER_BY_ID[descriptor.id]).toBe(descriptor)
      }
    })
  })

  describe("resolveBaseUrl", () => {
    const withDefault: ProviderDescriptor = {
      id: "openai",
      displayName: "OpenAI",
      category: "api-key",
      apiShape: "openai-completions",
      defaultBaseUrl: "https://api.openai.com/v1",
    }
    const withoutDefault: ProviderDescriptor = {
      id: "custom",
      displayName: "Custom",
      category: "openai-compat",
      apiShape: "openai-completions",
    }

    it("returns descriptor.defaultBaseUrl when no user override is given", () => {
      expect(resolveBaseUrl(withDefault)).toBe("https://api.openai.com/v1")
      expect(resolveBaseUrl(withDefault, undefined)).toBe("https://api.openai.com/v1")
    })

    it("returns undefined when neither default nor override is present", () => {
      expect(resolveBaseUrl(withoutDefault)).toBeUndefined()
    })

    it("lets a user override win over descriptor.defaultBaseUrl", () => {
      expect(resolveBaseUrl(withDefault, "https://my-proxy.example.com/v1")).toBe(
        "https://my-proxy.example.com/v1",
      )
    })

    it("returns the override even when the descriptor has no default", () => {
      expect(resolveBaseUrl(withoutDefault, "https://custom.example/v1")).toBe(
        "https://custom.example/v1",
      )
    })

    it("treats a whitespace-only override as absent (falls back to default)", () => {
      expect(resolveBaseUrl(withDefault, "   ")).toBe("https://api.openai.com/v1")
    })

    it("trims a user override before using it", () => {
      expect(resolveBaseUrl(withDefault, "  https://trimmed.example/v1  ")).toBe(
        "https://trimmed.example/v1",
      )
    })
  })
})
