import type { ProviderKind } from "@openkey/shared";
import type { ProviderAdapter } from "./types.js";
import { MockAdapter } from "./mock.js";
import { BedrockAdapter } from "./bedrock.js";
import { AnthropicAdapter } from "./anthropic.js";
import { OpenAICompatAdapter } from "./openaiCompat.js";

// Adapters are stateless (aside from warm connection pools), so one instance
// of each serves every request. Anything beyond these is a community PR
// implementing ProviderAdapter.

const adapters = new Map<ProviderKind, ProviderAdapter>();

function register(adapter: ProviderAdapter): void {
  adapters.set(adapter.kind, adapter);
}

register(new MockAdapter());
register(new BedrockAdapter());
register(new AnthropicAdapter());
register(new OpenAICompatAdapter("openai"));
register(new OpenAICompatAdapter("azure_openai"));
register(new OpenAICompatAdapter("ollama"));

export function getAdapter(kind: string): ProviderAdapter | undefined {
  return adapters.get(kind as ProviderKind);
}
