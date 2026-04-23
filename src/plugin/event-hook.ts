import type { PluginLogger } from './logger'

export function createEventHook(logger: PluginLogger) {
  return async ({ event }: { event: any }) => {
    if (!event || typeof event !== 'object') {
      logger.error('Invalid event input', { errors: ['event: event is required and must be an object'] })
    }
  }
}
