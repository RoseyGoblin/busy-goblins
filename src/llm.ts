// ══════════════════════════════════════════════════
// llm.ts
// Sends a prompt to Ollama and returns the response.
//
// Uses streaming mode so we can show real token count
// progress in the UI as the model generates.
//
// WHY fetch INSTEAD OF requestUrl?
// requestUrl is Obsidian's HTTP client but doesn't
// support streaming responses — it waits for the full
// response before returning anything.
// Native fetch (available in Electron/Obsidian) supports
// ReadableStream, which lets us read tokens as they arrive.
//
// WHY STREAMING?
// Two benefits:
//   1. Real token count for the progress display
//   2. Cancel actually works mid-generation — we stop
//      reading the stream and close the connection,
//      which signals Ollama to stop generating.
// ══════════════════════════════════════════════════

import { CancelToken } from './types';

// Options passed to callOllama()
export interface LlmOptions {
  baseUrl:      string;       // e.g. "http://localhost:11434"
  model:        string;       // e.g. "llama3:70b"
  system:       string;       // the agent's system prompt
  user:         string;       // the vault content to analyze
  numCtx:       number;       // context window size in tokens (model-specific)
  cancelToken?: CancelToken;  // checked each chunk — stops reading if cancelled
  onToken?:     (count: number) => void;  // called with running token count
}

// Calls Ollama's /api/chat endpoint in streaming mode.
// Returns the full generated response as a string.
// Throws a descriptive Error on network failure or HTTP error.
// Returns empty string if cancelled mid-stream.
export async function callOllama(opts: LlmOptions): Promise<string> {

  // ── Validate the base URL ─────────────────────
  // Reject anything that isn't http:// or https:// so a crafted
  // settings file can't redirect requests to internal services
  // (file://, ftp://, custom schemes, etc.).
  if (!opts.baseUrl.startsWith('http://') && !opts.baseUrl.startsWith('https://')) {
    throw new Error(
      `Invalid Ollama URL "${opts.baseUrl}" — must start with http:// or https://`
    );
  }

  const url = `${opts.baseUrl}/api/chat`;

  // ── Make the streaming HTTP request ──────────
  let response: Response;
  try {
    response = await fetch(url, {
      method:  'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model:  opts.model,
        stream: true,          // receive tokens as they're generated
        options: {
          temperature: 0.4,      // lower = more focused, higher = more creative
          num_ctx:     opts.numCtx,  // set explicitly per model — Ollama's default
                                     // is sometimes as low as 2048 if not specified
        },
        messages: [
          { role: 'system', content: opts.system },
          { role: 'user',   content: opts.user   },
        ],
      }),
    });
  } catch (err) {
    // fetch() throws on network failure — Ollama probably isn't running
    throw new Error(
      `Cannot reach Ollama at ${opts.baseUrl}. ` +
      `Make sure Ollama is running — open a terminal and run: ollama serve`
    );
  }

  // ── Handle HTTP errors ────────────────────────
  if (response.status === 404) {
    throw new Error(
      `Model "${opts.model}" not found in Ollama. ` +
      `Pull it first — open a terminal and run: ollama pull ${opts.model}`
    );
  }

  if (response.status >= 400) {
    const errText = await response.text().catch(() => '');
    throw new Error(
      `Ollama returned an error (HTTP ${response.status}). ` +
      `Response: ${errText}`
    );
  }

  if (!response.body) {
    throw new Error('Ollama returned no response body.');
  }

  // ── Read the streaming NDJSON response ───────
  // Ollama streams newline-delimited JSON (NDJSON).
  // Each line looks like:
  //   {"model":"llama3:70b","message":{"role":"assistant","content":"Hello"},"done":false}
  // The final line has "done":true.
  //
  // We read chunks from the stream, split on newlines,
  // parse each complete line, and accumulate the content.
  const reader  = response.body.getReader();
  const decoder = new TextDecoder();
  let content    = '';
  let tokenCount = 0;
  let buffer     = '';  // holds incomplete lines between chunks

  try {
    while (true) {

      // ── Check cancel before each read ──────
      // With streaming we can actually stop mid-generation.
      // Releasing the reader closes the connection,
      // which signals Ollama to stop generating on its end.
      if (opts.cancelToken?.cancelled) {
        await reader.cancel();
        return '';  // signal to runner.ts that we stopped early
      }

      const { done, value } = await reader.read();
      if (done) break;

      // Decode this chunk and add it to our buffer
      buffer += decoder.decode(value, { stream: true });

      // Split on newlines — each complete line is one JSON object.
      // The last element may be an incomplete line, so we keep it
      // in the buffer for the next iteration.
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;

        try {
          const data = JSON.parse(trimmed);

          // Extract the new token content from this chunk
          if (data.message?.content) {
            content += data.message.content;
            tokenCount++;
            opts.onToken?.(tokenCount);  // update the UI token counter
          }
        } catch {
          // Malformed JSON chunk — skip it and continue
          // This occasionally happens with Ollama, not a fatal error
          continue;
        }
      }
    }
  } finally {
    // Always release the reader, even if an error occurred
    reader.releaseLock();
  }

  // ── Validate the response ─────────────────────
  if (!content.trim() && !opts.cancelToken?.cancelled) {
    throw new Error(
      `Ollama returned an empty response. ` +
      `The model may have run out of context or encountered an error.`
    );
  }

  return content;
}
