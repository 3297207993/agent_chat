import { streamText } from "ai";
import { convertToAISDKMessages } from "./messages";
import { getProvider, getModel } from "./providers";
import type { ProviderConfig } from "@/types/provider";
import type { Message } from "@/types/chat";

interface StreamCallbacks {
  onToken: (text: string) => void;
  onReasoning: (text: string) => void;
  onError: (error: Error) => void;
  onFinish: () => void;
}

export function createChatStream(
  providerConfig: ProviderConfig,
  modelId: string,
  messages: Message[],
  callbacks: StreamCallbacks,
  abortSignal: AbortSignal
) {
  const provider = getProvider(providerConfig);
  const model = getModel(provider, modelId);

  const result = streamText({
    model,
    messages: convertToAISDKMessages(messages),
    abortSignal,
  });

  void (async () => {
    try {
      for await (const part of result.stream) {
        switch (part.type) {
          case "text-delta":
            callbacks.onToken(part.text);
            break;
          case "reasoning-delta":
            callbacks.onReasoning(part.text);
            break;
        }
      }
      callbacks.onFinish();
    } catch (error) {
      if ((error as Error).name === "AbortError") {
        callbacks.onFinish();
        return;
      }
      callbacks.onError(error as Error);
    }
  })();

  return result;
}