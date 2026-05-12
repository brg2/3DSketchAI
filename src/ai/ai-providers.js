export const AI_PROVIDERS = Object.freeze({
  openai: {
    id: "openai",
    label: "OpenAI",
    endpoint: "https://api.openai.com/v1/responses",
    defaultModel: "gpt-5.4-mini",
  },
  claude: {
    id: "claude",
    label: "Claude",
    endpoint: "https://api.anthropic.com/v1/messages",
    defaultModel: "claude-sonnet-4-5",
  },
  gemini: {
    id: "gemini",
    label: "Gemini",
    endpoint: "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    defaultModel: "gemini-2.5-flash",
  },
  grok: {
    id: "grok",
    label: "Grok",
    endpoint: "https://api.x.ai/v1/chat/completions",
    defaultModel: "grok-4",
  },
});

export async function requestAiFeatureGraphPatch({ provider, apiKey, context, systemPrompt, fetchImpl = globalThis.fetch } = {}) {
  const config = AI_PROVIDERS[provider];
  if (!config) {
    throw new Error(`Unsupported AI provider: ${provider}`);
  }
  if (!apiKey || typeof apiKey !== "string") {
    throw new Error("AI provider API key is required");
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("AI provider requests require fetch");
  }

  const response = await fetchImpl(config.endpoint, requestForProvider({ config, provider, apiKey, context, systemPrompt }));
  if (!response.ok) {
    throw new Error(`AI provider request failed: ${response.status}`);
  }
  const json = await response.json();
  return parseProviderPatch(json);
}

function requestForProvider({ config, provider, apiKey, context, systemPrompt }) {
  if (provider === "openai") {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: config.defaultModel,
        input: [
          { role: "system", content: systemPrompt },
          { role: "user", content: JSON.stringify(context) },
        ],
        text: { format: { type: "json_object" } },
      }),
    };
  }
  if (provider === "claude") {
    return {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: config.defaultModel,
        max_tokens: 2048,
        system: systemPrompt,
        messages: [{ role: "user", content: JSON.stringify(context) }],
      }),
    };
  }
  if (provider === "gemini") {
    return {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: systemPrompt }] },
        contents: [{ role: "user", parts: [{ text: JSON.stringify(context) }] }],
      }),
    };
  }
  return {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: config.defaultModel,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: JSON.stringify(context) },
      ],
      response_format: { type: "json_object" },
    }),
  };
}

export function parseProviderPatch(json) {
  const text = providerText(json);
  if (typeof text === "object") {
    return text;
  }
  try {
    return JSON.parse(text);
  } catch {
    throw new Error("AI provider did not return valid JSON patch");
  }
}

function providerText(json) {
  if (typeof json?.output_text === "string") {
    return json.output_text;
  }
  const responseText = json?.output
    ?.flatMap?.((entry) => entry?.content ?? [])
    ?.map?.((content) => content?.text)
    ?.find?.((text) => typeof text === "string" && text.trim().length > 0);
  if (responseText) {
    return responseText;
  }
  return (
    json?.choices?.[0]?.message?.content ??
    json?.content?.[0]?.text ??
    json?.candidates?.[0]?.content?.parts?.[0]?.text ??
    JSON.stringify(json)
  );
}
