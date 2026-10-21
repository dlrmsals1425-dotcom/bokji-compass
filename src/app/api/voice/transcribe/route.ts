export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 8 * 1024 * 1024;
const EXTENSIONS: Record<string, string> = {
  "audio/webm": "webm", "video/webm": "webm", "audio/mp4": "mp4",
  "audio/ogg": "ogg", "audio/wav": "wav", "audio/x-wav": "wav",
};
const MODEL = "gpt-transcribe";
const ENDPOINT = "https://api.openai.com/v1/audio/transcriptions";
// Bound buffered audio per web-server process. Do not retry billable requests.
let inFlight = 0;
const json = (body: object, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  // Configuration check only; no paid request before microphone consent/start.
  const configured = Boolean(process.env.OPENAI_API_KEY?.trim());
  return json({ available: configured }, configured ? 200 : 503);
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  // Next may normalize its internal URL to localhost. Host retains the authority
  // the browser actually addressed; never take an arbitrary forwarded host.
  const url = new URL(request.url);
  const expectedOrigin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (origin !== expectedOrigin) return json({ error: "invalid_origin" }, 403);
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) return json({ error: "unavailable" }, 503);
  const type = (request.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
  if (!Object.hasOwn(EXTENSIONS, type)) return json({ error: "unsupported_audio" }, 415);
  const length = Number(request.headers.get("content-length"));
  if (length > MAX_BYTES) return json({ error: "audio_too_large" }, 413);
  const reader = request.body?.getReader();
  if (!reader) return json({ error: "empty_audio" }, 422);
  if (inFlight >= 2) { await reader.cancel(); reader.releaseLock(); return json({ error: "busy" }, 429); }
  inFlight++;
  const chunks: Uint8Array[] = [];
  let size = 0;
  let bodyExpired = false;
  const bodyTimer = setTimeout(() => { bodyExpired = true; void reader.cancel().catch(() => {}); }, 15_000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) { await reader.cancel(); return json({ error: "audio_too_large" }, 413); }
      chunks.push(value);
    }
    if (bodyExpired) return json({ error: "upload_timeout" }, 408);
    clearTimeout(bodyTimer);
    if (!size) return json({ error: "empty_audio" }, 422);
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(Buffer.concat(chunks))], { type }), `recording.${EXTENSIONS[type]}`);
    form.append("model", MODEL);
    form.append("languages[]", "ko");
    form.append("response_format", "json");
    const response = await fetch(ENDPOINT, {
      method: "POST", body: form,
      // fetch supplies the multipart boundary. Never expose this key to clients.
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.any([request.signal, AbortSignal.timeout(115_000)]),
      cache: "no-store", redirect: "error",
    });
    if (!response.ok) {
      const status = [401, 403, 404].includes(response.status) ? 503
        : [400, 415, 422].includes(response.status) ? 422
          : [413, 429, 503].includes(response.status) ? response.status : 502;
      return json({ error: "transcription_failed" }, status);
    }
    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("text" in data) || typeof data.text !== "string" || data.text.length > 10_000) {
      return json({ error: "invalid_response" }, 502);
    }
    if (!data.text.trim()) return json({ error: "no_speech" }, 422);
    return json({ text: data.text.trim() });
  } catch { return json({ error: "unavailable" }, 503); }
  finally { clearTimeout(bodyTimer); reader.releaseLock(); inFlight--; }
}
