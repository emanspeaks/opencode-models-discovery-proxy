import type { PluginLogger } from '../plugin/logger'

export interface PluginConfig {
  provider: string
  models?: {
    includeRegex?: string[]
    excludeRegex?: string[]
  }
}

export interface ModelRegexFilter {
  includeRegex: RegExp[]
  excludeRegex: RegExp[]
}

function toRegExp(pattern: string, logger?: PluginLogger): RegExp | null {
  try {
    return new RegExp(pattern)
  } catch {
    if (logger) {
      logger.warn('Ignoring invalid model regex', { category: 'filtering', pattern })
    } else {
      console.warn(`[opencode-models-discovery-proxy] Ignoring invalid model regex: ${pattern}`)
    }
    return null
  }
}

export function getModelRegexFilter(config: PluginConfig, logger?: PluginLogger): ModelRegexFilter {
  return {
    includeRegex: (config.models?.includeRegex ?? [])
      .map((p) => toRegExp(p, logger))
      .filter((r): r is RegExp => r !== null),
    excludeRegex: (config.models?.excludeRegex ?? [])
      .map((p) => toRegExp(p, logger))
      .filter((r): r is RegExp => r !== null),
  }
}

export function shouldDiscoverModel(modelId: string, filter: ModelRegexFilter): boolean {
  if (filter.includeRegex.length > 0) {
    return filter.includeRegex.some((pattern) => pattern.test(modelId))
  }
  if (filter.excludeRegex.length > 0) {
    return !filter.excludeRegex.some((pattern) => pattern.test(modelId))
  }
  return true
}

export function parsePluginConfig(rawConfig: any): PluginConfig {
  if (!rawConfig || typeof rawConfig !== 'object' || Array.isArray(rawConfig)) {
    return { provider: '' }
  }
  return {
    provider: typeof rawConfig.provider === 'string' ? rawConfig.provider : '',
    models: rawConfig.models as PluginConfig['models'],
  }
}
