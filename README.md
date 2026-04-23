# opencode-models-discovery-proxy

[![npm version](https://img.shields.io/npm/v/opencode-models-discovery-proxy.svg?color=blue)](https://www.npmjs.com/package/opencode-models-discovery-proxy)
[![npm downloads](https://img.shields.io/npm/dt/opencode-models-discovery-proxy.svg)](https://www.npmjs.com/package/opencode-models-discovery-proxy)
[![release](https://github.com/emanspeaks/opencode-models-discovery-proxy/actions/workflows/release.yml/badge.svg)](https://github.com/emanspeaks/opencode-models-discovery-proxy/actions/workflows/release.yml)
[![license](https://img.shields.io/github/license/emanspeaks/opencode-models-discovery-proxy)](https://github.com/emanspeaks/opencode-models-discovery-proxy/blob/main/LICENSE)
[![OpenCode](https://img.shields.io/badge/OpenCode-%3E%3D1.4.0-blueviolet)](https://opencode.ai)

An [OpenCode](https://opencode.ai) plugin that bridges **[llama-swap-proxy](https://github.com/emanspeaks/llama-swap-proxy)** and OpenCode by automatically populating your provider's model list from the `/v1/opencode` endpoint at startup.

A fork of [opencode-models-discovery](https://github.com/yuhp/opencode-models-discovery)

## Who is this for?

If you are running [llama-swap-proxy](https://github.com/emanspeaks/llama-swap-proxy), it exposes a `/v1/opencode` endpoint that returns a fully-formed OpenCode provider config describing every model it serves — including context limits, tool-calling support, reasoning mode, vision capabilities, and multimodal modalities. This plugin reads that endpoint and injects those model definitions directly into OpenCode without any manual configuration, so you never have to keep your OpenCode config in sync with your model lineup.

## How it works

1. OpenCode calls the plugin's `provider` hook at startup for the configured provider
2. The hook fetches `<baseURL>/v1/opencode` from that provider's configured endpoint
3. It looks up the entry in the response whose name **exactly matches** the configured provider name
4. Every model from that entry is returned as a fully-typed `ModelV2` object — capabilities, limits, and modalities are mapped from the server's response
5. OpenCode merges the returned models into the provider's model list for the session

The exact-name match means two providers sharing the same base URL but with different names will never bleed models into each other.

## Installation

```bash
npm install opencode-models-discovery-proxy
# or
bun add opencode-models-discovery-proxy
```

## Usage

Add the plugin with the `provider` option set to the **exact name of your provider** in `opencode.json`:

```json
{
  "$schema": "https://opencode.ai/config.json",
  "plugin": [
    ["opencode-models-discovery-proxy", {
      "provider": "my-server"
    }]
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

The `provider` option must match the key used in the `provider` map — that's the name the plugin will look up in the `/v1/opencode` response. On next startup, OpenCode will have all models from your llama-swap-proxy instance available automatically.

### Multiple servers

To use more than one server, add the plugin once per provider:

```json
{
  "plugin": [
    ["opencode-models-discovery-proxy", { "provider": "my-server" }],
    ["opencode-models-discovery-proxy", { "provider": "my-other-server" }]
  ],
  "provider": {
    "my-server": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://192.168.2.44:5900/v1" }
    },
    "my-other-server": {
      "npm": "@ai-sdk/openai-compatible",
      "options": { "baseURL": "http://192.168.2.44:5901/v1" }
    }
  }
}
```

## `/v1/opencode` response format

The plugin expects the endpoint to return a JSON document conforming to the [OpenCode config schema](https://opencode.ai/config.json). The `provider` section is what gets read:

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
          "limit": { "context": 32768, "output": 32768 }
        },
        "Qwen3-8B-Q8_0": {
          "name": "Qwen3-8B-Q8_0",
          "reasoning": true,
          "tool_call": true,
          "limit": { "context": 200000, "output": 200000 }
        },
        "MiniCPM-V-4_5-Q8_0": {
          "name": "MiniCPM-V-4_5-Q8_0",
          "reasoning": true,
          "tool_call": true,
          "attachment": true,
          "limit": { "context": 200000, "output": 200000 },
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

| Option | Required | Description |
| ------ | -------- | ----------- |
| `provider` | **yes** | Exact name of the provider to hook into. Must match the key in your `provider` map. |
| `models.includeRegex` | no | If non-empty, only inject models whose ID matches one of these patterns |
| `models.excludeRegex` | no | Skip models whose ID matches any of these patterns (ignored when `includeRegex` is set) |

Example with model filtering:

```json
["opencode-models-discovery-proxy", {
  "provider": "my-server",
  "models": {
    "includeRegex": ["^Llama-", "^Qwen3-"]
  }
}]
```

## Logging

Logs are emitted under the service name `opencode-models-discovery-proxy` via OpenCode's structured log API (`client.app.log`), visible with `opencode --print-logs`.

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## Disclaimer

This project is not built by the OpenCode team and is not affiliated with OpenCode in any way.
