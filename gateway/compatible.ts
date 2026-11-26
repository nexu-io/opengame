import type { ProviderAdapter } from './providers.ts';
import { apiJson, publicProviderFetch, ProviderError, readCappedText } from './network.ts';

/** Explicit OpenAI-compatible image/speech operations; never guesses a video protocol. */
export const compatibleProvider: ProviderAdapter = {
  async generate(job, context) {
    if (!context.baseUrl) throw new Error('Provider API URL is required');
    const fetcher = context.fetcher === fetch ? publicProviderFetch : context.fetcher;
    const headers = { Authorization: `Bearer ${context.key}`, 'Content-Type': 'application/json' };
    const parameters = { ...job.model.defaults, ...job.parameters };
    await context.progress('submitting');
    if (job.modality === 'audio') {
      if (typeof parameters.voice !== 'string' || !parameters.voice.trim()) throw new Error('Choose a voice in parameters.voice');
      const response = await fetcher(context.baseUrl + '/audio/speech', { method: 'POST', headers, redirect: 'error', signal: context.signal,
        body: JSON.stringify({ ...parameters, model: job.model.modelId, input: job.prompt }) });
      if (!response.ok) {
        let upstreamCode: string | undefined;
        try {
          const errBody = JSON.parse(await readCappedText(response, 65_536)) as { error?: { code?: unknown }; code?: unknown };
          const rawCode = typeof errBody?.error?.code === 'string' ? errBody.error.code
            : typeof errBody?.code === 'string' ? errBody.code : undefined;
          if (rawCode && /^[A-Za-z0-9_-]{1,64}$/.test(rawCode)) upstreamCode = rawCode;
        } catch { /* Non-JSON error bodies simply omit upstreamCode. */ }
        throw new ProviderError(`Provider HTTP ${response.status}`, response.status, upstreamCode, 'api');
      }
      return [Buffer.from(await response.arrayBuffer())];
    }
    if (job.modality !== 'image') throw new Error('This compatible provider supports image generation and speech only');
    const result = await apiJson(fetcher, context.baseUrl + '/images/generations', { method: 'POST', headers, signal: context.signal,
      body: JSON.stringify({ ...parameters, model: job.model.modelId, prompt: job.prompt }) });
    if (!Array.isArray(result.data) || !result.data.length) throw new Error('Provider returned no images');
    return result.data.slice(0, 8).map((image: { b64_json?: string; url?: string }) => {
      if (typeof image.b64_json === 'string') return Buffer.from(image.b64_json, 'base64');
      if (typeof image.url === 'string') return image.url;
      throw new Error('Provider returned an unsupported image response');
    });
  },
};
