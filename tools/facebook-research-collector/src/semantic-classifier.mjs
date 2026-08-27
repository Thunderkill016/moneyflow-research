const DEFAULT_ENDPOINT = 'https://api.openai.com/v1/responses';
const DEFAULT_MODEL = 'gpt-5.6-luna';

function normalizeWhitespace(value = '') {
  return String(value).replace(/\u00a0/g, ' ').replace(/\s+/g, ' ').trim();
}

function extractOutputText(response) {
  if (typeof response?.output_text === 'string' && response.output_text.trim()) {
    return response.output_text.trim();
  }
  for (const item of response?.output ?? []) {
    if (item?.type !== 'message') continue;
    for (const content of item.content ?? []) {
      if (content?.type === 'output_text' && typeof content.text === 'string') return content.text.trim();
    }
  }
  return '';
}

export function semanticClassifierConfig(config = {}) {
  const semantic = config.semanticClassifier ?? {};
  return {
    enabled: semantic.enabled !== false,
    provider: semantic.provider ?? 'openai',
    endpoint: semantic.endpoint ?? process.env.OPENAI_RESPONSES_ENDPOINT ?? DEFAULT_ENDPOINT,
    model: semantic.model ?? process.env.OPENAI_CLASSIFIER_MODEL ?? DEFAULT_MODEL,
    apiKeyEnv: semantic.apiKeyEnv ?? 'OPENAI_API_KEY',
    timeoutMs: Number(semantic.timeoutMs ?? 30_000),
    maxBodyChars: Number(semantic.maxBodyChars ?? 24_000),
  };
}

export async function classifyPostSemantically({ body, query = '', config = {}, fetchImpl = fetch }) {
  const settings = semanticClassifierConfig(config);
  const text = normalizeWhitespace(body);

  if (!settings.enabled) {
    return {
      relevant: true,
      confidence: 1,
      reason: 'semantic-classifier-disabled',
      model: null,
      provider: null,
    };
  }
  if (settings.provider !== 'openai') throw new Error(`Unsupported semantic classifier provider: ${settings.provider}`);
  if (!text) {
    return {
      relevant: false,
      confidence: 1,
      reason: 'empty-post-body',
      model: settings.model,
      provider: settings.provider,
    };
  }

  const apiKey = process.env[settings.apiKeyEnv];
  if (!apiKey) {
    throw new Error(`Semantic classifier requires ${settings.apiKeyEnv}. Refusing to fall back to keyword scoring.`);
  }

  const topicDefinition = [
    'Decide whether the MAIN SUBJECT of this Facebook post is relevant to personal expense management / personal finance management research.',
    'Relevant includes: personal expense tracking, income/expense logging, bank or wallet transaction capture, bank statements, personal accounts/wallets, transfers between personal accounts, budgeting, saving goals, recurring/subscription spending, personal-finance automation, and privacy/trust/reliability issues of personal-finance tools.',
    'Irrelevant includes: business sales/POS/inventory/CRM, generic AI/software, gaming, jobs/CV, marketing, unrelated apps, and other topics where personal money management is not the main subject.',
    'Judge the post by its meaning, not by keyword presence. A passing mention of money, bank, AI, app, wallet, or budget does not make an unrelated post relevant.',
    'Return relevant=true only when the post itself is substantively about the target topic. Otherwise return relevant=false.',
  ].join(' ');

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), settings.timeoutMs);
  try {
    const response = await fetchImpl(settings.endpoint, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      signal: controller.signal,
      body: JSON.stringify({
        model: settings.model,
        input: [
          { role: 'system', content: topicDefinition },
          {
            role: 'user',
            content: JSON.stringify({
              searchQuery: query || null,
              postBody: text.slice(0, settings.maxBodyChars),
            }),
          },
        ],
        text: {
          format: {
            type: 'json_schema',
            name: 'facebook_pfm_relevance',
            strict: true,
            schema: {
              type: 'object',
              additionalProperties: false,
              properties: {
                relevant: { type: 'boolean' },
                confidence: { type: 'number' },
                reason: { type: 'string' },
              },
              required: ['relevant', 'confidence', 'reason'],
            },
          },
        },
      }),
    });

    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const message = payload?.error?.message ?? `${response.status} ${response.statusText}`;
      throw new Error(`Semantic classifier API failed: ${message}`);
    }
    const outputText = extractOutputText(payload);
    if (!outputText) throw new Error('Semantic classifier returned no output text');
    const parsed = JSON.parse(outputText);
    if (typeof parsed.relevant !== 'boolean' || typeof parsed.confidence !== 'number' || typeof parsed.reason !== 'string') {
      throw new Error('Semantic classifier returned invalid structured output');
    }
    return {
      relevant: parsed.relevant,
      confidence: Math.max(0, Math.min(1, parsed.confidence)),
      reason: parsed.reason.trim(),
      model: settings.model,
      provider: settings.provider,
    };
  } finally {
    clearTimeout(timer);
  }
}
