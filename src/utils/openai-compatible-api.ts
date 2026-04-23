const OPENCODE_ENDPOINT = "/v1/opencode"

export function normalizeBaseURL(baseURL: string): string {
  let normalized = baseURL.replace(/\/+$/, '')
  if (normalized.endsWith('/v1')) {
    normalized = normalized.slice(0, -3)
  }
  return normalized
}

export function buildAPIURL(baseURL: string, endpoint: string = OPENCODE_ENDPOINT): string {
  const normalized = normalizeBaseURL(baseURL)
  return `${normalized}${endpoint}`
}

export async function fetchOpenCodeConfig(baseURL: string, apiKey?: string): Promise<any | null> {
  try {
    const url = buildAPIURL(baseURL)
    const headers: Record<string, string> = {}
    if (apiKey) {
      headers["Authorization"] = `Bearer ${apiKey}`
    }
    const response = await fetch(url, {
      method: "GET",
      headers: Object.keys(headers).length > 0 ? headers : undefined,
      signal: AbortSignal.timeout(5000),
    })
    if (!response.ok) {
      return null
    }
    return await response.json()
  } catch {
    return null
  }
}

export function isOpenAICompatibleProvider(provider: any): boolean {
  return provider &&
         typeof provider === 'object' &&
         provider.npm === "@ai-sdk/openai-compatible"
}

export function hasOpenAICompatibleURL(provider: any): boolean {
  if (!provider || typeof provider !== 'object') return false
  const baseURL = provider.options?.baseURL || ""
  return /\/v1(\/|$)/.test(baseURL)
}

export function canDiscoverModels(provider: any): boolean {
  return isOpenAICompatibleProvider(provider) || hasOpenAICompatibleURL(provider)
}
