import { env } from "cloudflare:workers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_SDP_BYTES = 64 * 1024;
const ENDPOINT = "https://api.openai.com/v1/realtime/calls";
let inFlight = 0;

function error(message: string, status: number) {
  return Response.json({ error: message }, { status, headers: { "Cache-Control": "no-store" } });
}

class BodyError extends Error {
  constructor(readonly status: number) { super("Invalid signaling body"); }
}

async function readSdp(body: ReadableStream<Uint8Array> | null, signal: AbortSignal) {
  if (!body) throw new BodyError(422);
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  const abort = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abort, { once: true });
  if (signal.aborted) abort();
  try {
    while (true) {
      if (signal.aborted) throw new BodyError(408);
      const { done, value } = await reader.read();
      if (signal.aborted) throw new BodyError(408);
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SDP_BYTES) {
        void reader.cancel().catch(() => {});
        throw new BodyError(413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
    let sdp: string;
    try { sdp = new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
    catch { throw new BodyError(422); }
    if (!/^v=0\r?\n/.test(sdp) || !/^m=audio /m.test(sdp)) throw new BodyError(422);
    return sdp;
  } finally {
    signal.removeEventListener("abort", abort);
    reader.releaseLock();
  }
}

// Configuration availability only; this does not call OpenAI or validate the key.
export async function GET() {
  const available = Boolean(env.OPENAI_API_KEY?.trim());
  return Response.json({ available }, { status: available ? 200 : 503, headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const url = new URL(request.url);
  const origin = `${url.protocol}//${request.headers.get("host") ?? url.host}`;
  if (request.headers.get("origin") !== origin || request.headers.get("sec-fetch-site") === "cross-site") {
    return error("이 화면에서 다시 음성 입력을 시작해 주세요.", 403);
  }
  const key = env.OPENAI_API_KEY?.trim();
  if (!key) return error("음성 입력 연결이 아직 준비되지 않았어요.", 503);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/sdp") {
    return error("음성 연결 요청 형식이 올바르지 않아요.", 415);
  }
  const declared = request.headers.get("content-length");
  if (declared !== null && (!/^\d+$/.test(declared) || Number(declared) > MAX_SDP_BYTES)) {
    return error("음성 연결 요청 크기가 올바르지 않아요.", /^\d+$/.test(declared) ? 413 : 400);
  }
  if (inFlight >= 2) return error("음성 연결이 몰리고 있어요. 잠시 뒤 다시 시도해 주세요.", 429);

  inFlight += 1;
  const deadline = new AbortController();
  const timeout = setTimeout(() => deadline.abort(), 20_000);
  const signal = AbortSignal.any([request.signal, deadline.signal]);
  let upstreamStarted = false;
  try {
    const sdp = await readSdp(request.body, signal);
    const form = new FormData();
    form.set("sdp", sdp);
    // Unified WebRTC signaling keeps the permanent key entirely on the server.
    // https://developers.openai.com/api/docs/guides/realtime-transcription
    form.set("session", JSON.stringify({
      type: "transcription",
      audio: { input: {
        transcription: { model: "gpt-live-transcribe", languages: ["ko"], delay: "low" },
        turn_detection: null,
      } },
    }));
    upstreamStarted = true;
    const upstream = await fetch(ENDPOINT, {
      method: "POST", headers: { Authorization: `Bearer ${key}` }, body: form,
      signal, cache: "no-store", redirect: "error",
    });
    if (!upstream.ok) {
      void upstream.body?.cancel().catch(() => {});
      return error("음성 연결을 시작하지 못했어요. 잠시 뒤 다시 시도해 주세요.", upstream.status === 429 ? 429 : 503);
    }
    const answer = await readSdp(upstream.body, signal);
    if (answer.includes(key)) return error("음성 연결 응답을 확인하지 못했어요.", 502);
    return new Response(answer, { headers: { "Content-Type": "application/sdp", "Cache-Control": "no-store" } });
  } catch (cause) {
    if (signal.aborted) return error("음성 연결 시간이 초과되었어요. 다시 시도해 주세요.", upstreamStarted ? 504 : 408);
    if (cause instanceof BodyError) {
      return error("음성 연결 정보를 확인하지 못했어요.", upstreamStarted ? 502 : cause.status);
    }
    return error("음성 연결을 시작하지 못했어요. 다시 시도해 주세요.", 503);
  } finally {
    clearTimeout(timeout);
    inFlight -= 1;
  }
}
