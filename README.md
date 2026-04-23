# opencode-models-discovery-proxy

[![npm version](https://img.shields.io/npm/v/opencode-models-discovery-proxy.svg?color=blue)](https://www.npmjs.com/package/opencode-models-discovery-proxy)
[![npm downloads](https://img.shields.io/npm/dt/opencode-models-discovery-proxy.svg)](https://www.npmjs.com/package/opencode-models-discovery-proxy)
[![release](https://github.com/emanspeaks/opencode-models-discovery-proxy/actions/workflows/release.yml/badge.svg)](https://github.com/emanspeaks/opencode-models-discovery-proxy/actions/workflows/release.yml)
[![license](https://img.shields.io/github/license/emanspeaks/opencode-models-discovery-proxy)](https://github.com/emanspeaks/opencode-models-discovery-proxy/blob/main/LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-%3E%3D1.4.0-blueviolet)](https://opencode.ai)

An [OpenCode](https://opencode.ai) plugin that bridges **[llama-swap-proxy](https://github.com/emanspeaks/llama-swap-proxy)** and OpenCode by automatically injecting your available models and their capabilities into the OpenCode provider configuration at startup.

## Who is this for?

If you are running [llama-swap-proxy](https://github.com/emanspeaks/llama-swap-proxy), it exposes a `/v1/opencode` endpoint that returns a fully-formed OpenCode provider config describing every model it serves — including context limits, tool-calling support, reasoning mode, vision capabilities, and multimodal modalities. This plugin reads that endpoint and injects those model definitions directly into OpenCode without any transformation, so you never have to manually keep your OpenCode config in sync with your model lineup.

## How it works

1. OpenCode calls the plugin's `config` hook at startup
2. For each configured provider with an OpenAI-compatible `baseURL`, the plugin fetches `<baseURL>/v1/opencode`
3. Every model returned is merged into that provider's `models` config as-is — capabilities, limits, and modalities are passed through exactly as the server reports them
4. OpenCode sees a fully-populated model list for the session

## Installation

```bash
npm install opencode-models-discovery-proxy
# or
bun add opencode-models-discovery-proxy
```

## Usage

Add the plugin and your llama-swap-proxy provider to `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    "opencode-models-discovery-proxy@latest"
  ],
  "provider": {
    "my-server": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "my-server",
      "options": {
        "baseURL": "http://192.168.2.44:5900/v1"
      }
    }
  }
}
```

That's the minimal setup. On next startup, OpenCode will have all models from your llama-swap-proxy instance available automatically.

## `/v1/opencode` response format

The plugin expects the endpoint to return a JSON document that conforms to the [OpenCode config schema](https://opencode.ai/config.json). Specifically, the `provider` section is what gets merged:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "provider": {
    "my-server": {
      "npm": "@ai-sdk/openai-compatible",
      "name": "my-server",
      "options": {
        "baseURL": "http://192.168.2.44:5900/v1"
      },
      "models": {
        "Llama-3.3-70B-Instruct-Q8_0": {
          "name": "Llama-3.3-70B-Instruct-Q8_0",
          "tool_call": true,
          "limit": {
            "context": 32768,
            "output": 32768
          }
        },
        "Qwen3-8B-Q8_0": {
          "name": "Qwen3-8B-Q8_0",
          "reasoning": true,
          "tool_call": true,
          "limit": {
            "context": 200000,
            "output": 200000
          }
        },
        "MiniCPM-V-4_5-Q8_0": {
          "name": "MiniCPM-V-4_5-Q8_0",
          "reasoning": true,
          "tool_call": true,
          "attachment": true,
          "limit": {
            "context": 200000,
            "output": 200000
          },
          "modalities": {
            "input": ["text", "image"],
            "output": ["text"]
          }
        }
      }
    }
  }
}
```

All model fields are optional except `name`. The server derives these from chat templates and your `config.yaml` overrides — see the [llama-swap-proxy README](https://github.com/emanspeaks/llama-swap-proxy) for details.

| Field | Type | Description |
| ----- | ---- | ----------- |
| `name` | `string` | Display name for the model |
| `tool_call` | `boolean` | Model supports tool/function calling |
| `reasoning` | `boolean` | Model has a reasoning/thinking mode |
| `attachment` | `boolean` | Model accepts file attachments |
| `limit.context` | `number` | Context window size in tokens |
| `limit.output` | `number` | Maximum output tokens |
| `modalities.input` | `string[]` | Accepted input types, e.g. `["text", "image"]` |
| `modalities.output` | `string[]` | Produced output types, e.g. `["text"]` |

## Plugin configuration

The plugin works with zero configuration, but you can fine-tune discovery behavior:

```json
{
  "plugin": [
    ["opencode-models-discovery-proxy", {
      "discovery": { "enabled": true },
      "providers": {
        "include": ["my-server"],
        "exclude": []
      },
      "models": {
        "includeRegex": [],
        "excludeRegex": []
      }
    }]
  ]
}
```

| Option | Default | Description |
| ------ | ------- | ----------- |
| `discovery.enabled` | `true` | Master switch for all discovery |
| `providers.include` | `[]` | If non-empty, only discover these providers |
| `providers.exclude` | `[]` | Skip these providers (ignored when `include` is set) |
| `models.includeRegex` | `[]` | If non-empty, only inject models whose ID matches one of these patterns |
| `models.excludeRegex` | `[]` | Skip models whose ID matches any of these patterns (ignored when `includeRegex` is set) |

You can also override discovery per-provider via `options.modelsDiscovery`:

```json
{
  "provider": {
    "my-server": {
      "npm": "@ai-sdk/openai-compatible",
      "options": {
        "baseURL": "http://192.168.2.44:5900/v1",
        "modelsDiscovery": {
          "enabled": true,
          "models": {
            "excludeRegex": ["^Codestral-"]
          }
        }
      }
    }
  }
}
```

`modelsDiscovery.enabled` on a provider overrides both `discovery.enabled` and the `providers.include/exclude` list for that specific provider. Provider-level model regex filters replace (not merge with) the global `models` filters.

## Logging

Logs are emitted under the service name `opencode-models-discovery-proxy` via OpenCode's structured log API (`client.app.log`), visible with `opencode --print-logs`.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This project is not built by the OpenCode team and is not affiliated with OpenCode in any way.
