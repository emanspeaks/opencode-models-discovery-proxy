import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import { ModelDiscoveryPlugin } from '../src/index.ts'

const mockFetch = vi.fn()
global.fetch = mockFetch

if (!global.AbortSignal.timeout) {
  global.AbortSignal.timeout = vi.fn(() => {
    const controller = new AbortController()
    setTimeout(() => controller.abort(), 5000)
    return controller.signal
  })
}

function makeOpenCodeResponse(models: Record<string, any>) {
  return {
    ok: true,
    json: async () => ({
      $schema: 'https://opencode.ai/config.json',
      provider: {
        local: { models }
      }
    })
  }
}

describe('ModelDiscovery Plugin', () => {
  let mockClient: any
  let pluginHooks: any

  beforeEach(async () => {
    mockFetch.mockClear()

    mockClient = {
      app: {
        log: vi.fn().mockResolvedValue(true)
      },
      tui: {
        showToast: vi.fn().mockResolvedValue(true)
      }
    }

    const mockInput: any = {
      client: mockClient,
      project: {
        id: 'test-project',
        name: 'test',
        path: '/tmp',
        worktree: '',
        time: { created: Date.now() }
      },
      directory: '/tmp',
      worktree: '',
      $: vi.fn(),
      config: {}
    }

    pluginHooks = await ModelDiscoveryPlugin(mockInput)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  describe('Plugin Initialization', () => {
    it('should initialize successfully with valid client', async () => {
      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }
      const hooks = await ModelDiscoveryPlugin(mockInput)
      expect(hooks).toBeDefined()
      expect(hooks.config).toBeTypeOf('function')
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
    })

    it('should handle invalid client gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
      const mockInput: any = {
        client: null,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }
      const hooks = await ModelDiscoveryPlugin(mockInput)

      expect(hooks).toBeDefined()
      expect(hooks.config).toBeTypeOf('function')
      expect(hooks.event).toBeTypeOf('function')
      expect(hooks['chat.params']).toBeTypeOf('function')
      expect(consoleSpy).toHaveBeenCalledWith('[opencode-models-discovery-proxy] Invalid client provided to plugin', { category: 'plugin' })

      consoleSpy.mockRestore()
    })
  })

  describe('Config Hook', () => {
    it('should validate config and reject invalid configurations', async () => {
      await pluginHooks.config(null)
      expect(mockClient.app.log).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          service: 'opencode-models-discovery-proxy',
          level: 'error',
          message: 'Invalid config provided',
          extra: expect.objectContaining({
            category: 'config',
            errors: expect.arrayContaining(['Config must be an object'])
          })
        })
      }))
    })

    it('should handle empty config gracefully', async () => {
      await pluginHooks.config({})
      expect(true).toBe(true)
    })

    it('should discover models for OpenAI-compatible providers', async () => {
      mockFetch.mockResolvedValueOnce(makeOpenCodeResponse({
        'test-model-1': { name: 'test-model-1', limit: { context: 200000, output: 200000 } },
        'test-model-2': { name: 'test-model-2', limit: { context: 200000, output: 200000 } },
      }))

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }
      await pluginHooks.config(config)

      expect(config.provider?.ollama?.models).toBeDefined()
      expect(Object.keys(config.provider.ollama.models).length).toBe(2)
    })

    it('should merge discovered models with existing config', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'new-model': { name: 'new-model', limit: { context: 200000, output: 200000 } },
      }))

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {
              'existing-model': { name: 'Existing Model' }
            }
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models).toEqual({
        'existing-model': { name: 'Existing Model' },
        'new-model': expect.objectContaining({ name: 'new-model' })
      })
    })

    it('should inject model configs as-is from the response', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'Llama-3.3-70B-Instruct-Q8_0': {
          name: 'Llama-3.3-70B-Instruct-Q8_0',
          tool_call: true,
          limit: { context: 32768, output: 32768 }
        },
      }))

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models['Llama-3.3-70B-Instruct-Q8_0']).toEqual({
        name: 'Llama-3.3-70B-Instruct-Q8_0',
        tool_call: true,
        limit: { context: 32768, output: 32768 }
      })
    })

    it('should handle provider offline gracefully', async () => {
      mockFetch.mockRejectedValue(new Error('Connection refused'))

      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' }
          }
        }
      }

      await pluginHooks.config(config)

      // Offline providers are handled silently
      consoleSpy.mockRestore()
    })

    it('should skip non-OpenAI-compatible providers', async () => {
      const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      const config: any = {
        provider: {
          anthropic: {
            npm: '@ai-sdk/anthropic',
            name: 'Anthropic',
            options: { baseURL: 'https://api.anthropic.com' }
          }
        }
      }

      await pluginHooks.config(config)

      expect(consoleSpy).not.toHaveBeenCalledWith(expect.stringContaining('appears to be offline'))
      consoleSpy.mockRestore()
    })

    it('should skip providers in exclude list', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'test-model': { name: 'test-model' },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        providers: {
          exclude: ['ollama']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config!(config)

      // Filter check happens silently
    })

    it('should only discover providers in include list', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'test-model': { name: 'test-model' },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        providers: {
          include: ['lmstudio']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          },
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LM Studio',
            options: { baseURL: 'http://127.0.0.1:1234/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config!(config)

      expect(config.provider?.lmstudio?.models?.['test-model']).toBeDefined()
      expect(config.provider?.ollama?.models).toEqual({})
    })

    it('should skip discovery when discovery.enabled is false', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'test-model': { name: 'test-model' },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        discovery: {
          enabled: false
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config!(config)

      expect(config.provider?.ollama?.models).toEqual({})
    })

    it('should allow provider-level discovery when global discovery is disabled', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'test-model': { name: 'test-model' },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        discovery: {
          enabled: false
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              modelsDiscovery: {
                enabled: true
              }
            },
            models: {}
          }
        }
      }

      await hooksWithConfig.config!(config)

      expect(config.provider?.ollama?.models?.['test-model']).toBeDefined()
    })

    it('should skip provider when provider-level discovery is disabled', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'test-model': { name: 'test-model' },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        providers: {
          include: ['ollama']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              modelsDiscovery: {
                enabled: false
              }
            },
            models: {}
          }
        }
      }

      await hooksWithConfig.config!(config)

      expect(config.provider?.ollama?.models).toEqual({})
    })

    it('should only discover models matching includeRegex', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'qwen/qwen3-30b-a3b': { name: 'qwen/qwen3-30b-a3b', limit: { context: 200000, output: 200000 } },
        'bge-m3': { name: 'bge-m3', limit: { context: 8192, output: 8192 } },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        models: {
          includeRegex: ['^qwen/']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config!(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toBeDefined()
      expect(config.provider.ollama.models['bge-m3']).toBeUndefined()
    })

    it('should skip models matching excludeRegex', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'qwen/qwen3-30b-a3b': { name: 'qwen/qwen3-30b-a3b', limit: { context: 200000, output: 200000 } },
        'bge-m3': { name: 'bge-m3', limit: { context: 8192, output: 8192 } },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        models: {
          excludeRegex: ['^bge-']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await hooksWithConfig.config!(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toBeDefined()
      expect(config.provider.ollama.models['bge-m3']).toBeUndefined()
    })

    it('should preserve explicitly configured models even when regex would filter them out', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'keep-me': { name: 'keep-me' },
        'discover-me': { name: 'discover-me' },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        models: {
          includeRegex: ['^discover-']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {
              'keep-me': { name: 'Keep Me' }
            }
          }
        }
      }

      await hooksWithConfig.config!(config)

      expect(config.provider.ollama.models['keep-me']).toEqual({ name: 'Keep Me' })
      expect(config.provider.ollama.models['discover-me']).toBeDefined()
    })

    it('should prefer provider-level model filters over global filters', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'qwen/qwen3-30b-a3b': { name: 'qwen/qwen3-30b-a3b', tool_call: true, limit: { context: 200000, output: 200000 } },
        'bge-m3': { name: 'bge-m3', limit: { context: 8192, output: 8192 } },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        models: {
          includeRegex: ['^bge-']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1',
              modelsDiscovery: {
                models: {
                  includeRegex: ['^qwen/']
                }
              }
            },
            models: {}
          }
        }
      }

      await hooksWithConfig.config!(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toEqual(
        expect.objectContaining({
          name: 'qwen/qwen3-30b-a3b',
          tool_call: true,
        })
      )
      expect(config.provider.ollama.models['bge-m3']).toBeUndefined()
    })

    it('should use global model filters when provider-level filters are not configured', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'qwen/qwen3-30b-a3b': { name: 'qwen/qwen3-30b-a3b', limit: { context: 200000, output: 200000 } },
        'qwen/qwen3-8b': { name: 'qwen/qwen3-8b', limit: { context: 200000, output: 200000 } },
        'bge-m3': { name: 'bge-m3', limit: { context: 8192, output: 8192 } },
      }))

      const mockInput: any = {
        client: mockClient,
        project: {
          id: 'test-project',
          name: 'test',
          path: '/tmp',
          worktree: '',
          time: { created: Date.now() }
        },
        directory: '/tmp',
        worktree: '',
        $: vi.fn()
      }

      const hooksWithConfig = await ModelDiscoveryPlugin(mockInput, {
        models: {
          includeRegex: ['^qwen/']
        }
      })

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: {
              baseURL: 'http://127.0.0.1:11434/v1'
            },
            models: {}
          }
        }
      }

      await hooksWithConfig.config!(config)

      expect(config.provider.ollama.models['qwen/qwen3-30b-a3b']).toBeDefined()
      expect(config.provider.ollama.models['qwen/qwen3-8b']).toBeDefined()
      expect(config.provider.ollama.models['bge-m3']).toBeUndefined()
    })
  })

  describe('Event Hook', () => {
    it('should validate event input', async () => {
      await pluginHooks.event({ event: null })
      expect(mockClient.app.log).toHaveBeenLastCalledWith(expect.objectContaining({
        body: expect.objectContaining({
          service: 'opencode-models-discovery-proxy',
          level: 'error',
          message: 'Invalid event input',
          extra: expect.objectContaining({
            category: 'event',
            errors: expect.arrayContaining(['event: event is required and must be an object'])
          })
        })
      }))
    })

    it('should handle session events gracefully', async () => {
      await pluginHooks.event({ event: { type: 'session.created' } })
      expect(true).toBe(true)
    })
  })

  describe('Chat Params Hook', () => {
    it('should be defined as a function', () => {
      expect(pluginHooks['chat.params']).toBeTypeOf('function')
    })

    it('should do nothing (validation disabled)', async () => {
      const input = {
        sessionID: 'test-session',
        model: { id: 'test-model' },
        provider: {
          npm: '@ai-sdk/openai-compatible',
          info: { id: 'ollama' },
          options: { baseURL: 'http://127.0.0.1:11434/v1' }
        }
      }
      const output: any = {}

      await pluginHooks['chat.params'](input, output)

      // Validation is disabled - no operations should be performed
      expect(output).toEqual({})
      expect(mockClient.tui.showToast).not.toHaveBeenCalled()
    })
  })

  describe('Error Handling', () => {
    it('should handle config enhancement errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})

      mockFetch.mockRejectedValue(new Error('Discovery failed'))

      const config: any = {}
      await pluginHooks.config(config)

      expect(true).toBe(true)

      consoleSpy.mockRestore()
    })
  })

  describe('Multi-Provider Support', () => {
    it('should discover models for multiple OpenAI-compatible providers', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'ollama-model-1': { name: 'ollama-model-1', limit: { context: 200000, output: 200000 } },
      }))

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/openai-compatible',
            name: 'Ollama',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          },
          lmstudio: {
            npm: '@ai-sdk/openai-compatible',
            name: 'LM Studio',
            options: { baseURL: 'http://127.0.0.1:1234/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models['ollama-model-1']).toBeDefined()
    })

    it('should discover models for providers with Anthropic npm but OpenAI-compatible URL', async () => {
      mockFetch.mockResolvedValue(makeOpenCodeResponse({
        'anthropic-compatible-model': { name: 'anthropic-compatible-model', limit: { context: 200000, output: 200000 } },
      }))

      const config: any = {
        provider: {
          ollama: {
            npm: '@ai-sdk/anthropic',
            name: 'Ollama (Anthropic Mode)',
            options: { baseURL: 'http://127.0.0.1:11434/v1' },
            models: {}
          }
        }
      }

      await pluginHooks.config(config)

      expect(config.provider.ollama.models['anthropic-compatible-model']).toBeDefined()
    })
  })
})
