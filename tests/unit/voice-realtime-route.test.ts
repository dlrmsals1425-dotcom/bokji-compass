import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/voice/realtime/route";

const token = "test-only-realtime-token-32-characters";
const sdp = "v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n";
const fetchMock = vi.fn();
function request(body: BodyInit | null = sdp, headers: Record<string, string> = {}, signal?: AbortSignal) {
  return new Request("http://localhost:3221/api/voice/realtime", {
    method: "POST", body, signal,
    headers: { origin: "http://localhost:3221", "content-type": "application/sdp", ...headers },
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve(); };
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", token);
  fetchMock.mockReset().mockImplementation(async () => new Response(sdp, { headers: { "Content-Type": "application/sdp" } }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("realtime WebRTC signaling gateway", () => {
  it("creates a transcription-only call with the server key and returns only SDP", async () => {
    fetchMock.mockResolvedValue(new Response(sdp, { headers: { "OpenAI-Secret": token, Location: "/private/call-id" } }));
    const response = await POST(request());
    expect(response.status).toBe(200); expect(await response.text()).toBe(sdp);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("content-type")).toBe("application/sdp");
    expect(response.headers.get("openai-secret")).toBeNull(); expect(response.headers.get("location")).toBeNull();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://api.openai.com/v1/realtime/calls");
    expect(init).toEqual(expect.objectContaining({ method: "POST", cache: "no-store", redirect: "error", headers: { Authorization: `Bearer ${token}` } }));
    const form = init.body as FormData;
    expect(form.get("sdp")).toBe(sdp);
    expect(JSON.parse(form.get("session") as string)).toEqual({
      type: "transcription", audio: { input: {
        transcription: { model: "gpt-live-transcribe", languages: ["ko"], delay: "low" }, turn_detection: null,
      } },
    });
  });
  it.each(["https://foreign.example", "null", ""])("rejects missing or foreign Origin %s", async (origin) => {
    expect((await POST(request(sdp, { origin }))).status).toBe(403); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("supports local Host normalization without trusting forwarded-host", async () => {
    expect((await POST(request(sdp, { host: "127.0.0.1:3221", origin: "http://127.0.0.1:3221" }))).status).toBe(200);
    expect((await POST(request(sdp, { host: "127.0.0.1:3221", "x-forwarded-host": "localhost:3221" }))).status).toBe(403);
    expect((await POST(request(sdp, { "sec-fetch-site": "cross-site" }))).status).toBe(403);
  });
  it.each(["", "   "])("requires the existing server key %j", async (key) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    expect((await POST(request())).status).toBe(503); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("checks availability without a paid API request or key disclosure", async () => {
    for (const ready of [false, true]) {
      vi.stubEnv("OPENAI_API_KEY", ready ? token : "");
      const response = await GET();
      expect(response.status).toBe(ready ? 200 : 503);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual({ available: ready });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects invalid MIME, empty SDP, non-SDP, and video-only offers", async () => {
    expect((await POST(request(sdp, { "content-type": "application/json" }))).status).toBe(415);
    expect((await POST(request(null))).status).toBe(422);
    expect((await POST(request(""))).status).toBe(422);
    expect((await POST(request("private"))).status).toBe(422);
    expect((await POST(request("v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 111\r\n"))).status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects declared oversized and malformed lengths before consuming the request", async () => {
    expect((await POST(request(sdp, { "content-length": "65537" }))).status).toBe(413);
    expect((await POST(request(sdp, { "content-length": "-1" }))).status).toBe(400);
    expect((await POST(request(sdp, { "content-length": "invalid" }))).status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("bounds chunked request bodies independent of Content-Length", async () => {
    const cancel = vi.fn();
    const body = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(65536)); controller.enqueue(new Uint8Array(1));
    }, cancel });
    expect((await POST(request(body))).status).toBe(413);
    expect(cancel).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("bounds concurrent handshakes and frees slots after completion", async () => {
    const resolves: ((value: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise<Response>((resolve) => { resolves.push(resolve); }));
    const first = POST(request()); const second = POST(request());
    expect((await POST(request())).status).toBe(429);
    await flush(); resolves.forEach((resolve) => resolve(new Response(sdp)));
    expect((await Promise.all([first, second])).map((response) => response.status)).toEqual([200, 200]);
    fetchMock.mockResolvedValue(new Response(sdp));
    expect((await POST(request())).status).toBe(200);
  });
  it("times out and cancels a stalled incoming body", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    const pending = POST(request(new ReadableStream({ cancel })));
    await vi.advanceTimersByTimeAsync(20_000);
    expect((await pending).status).toBe(408); expect(cancel).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
  it("cancels a stalled incoming body on browser abort", async () => {
    const controller = new AbortController(); const cancel = vi.fn();
    const pending = POST(request(new ReadableStream({ cancel }), {}, controller.signal));
    controller.abort(); expect((await pending).status).toBe(408);
    expect(cancel).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("cancels a request body that was already aborted", async () => {
    const controller = new AbortController(); const cancel = vi.fn(); controller.abort();
    expect((await POST(request(new ReadableStream({ cancel }), {}, controller.signal))).status).toBe(408);
    expect(cancel).toHaveBeenCalledOnce(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("rejects invalid UTF-8 instead of forwarding it", async () => {
    expect((await POST(request(new Uint8Array([0xff, 0xfe])))).status).toBe(422);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("aborts an upstream handshake at the deadline without exposing error text", async () => {
    vi.useFakeTimers();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error(token)), { once: true });
    }));
    const pending = POST(request()); await flush(); await vi.advanceTimersByTimeAsync(20_000);
    const response = await pending;
    expect(response.status).toBe(504); expect(await response.text()).not.toContain(token);
    expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
  });
  it("propagates browser abort to an in-flight upstream request", async () => {
    const controller = new AbortController();
    fetchMock.mockImplementation((_url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new Error(token)), { once: true });
    }));
    const pending = POST(request(sdp, {}, controller.signal)); await flush(); controller.abort();
    expect((await pending).status).toBe(504); expect(fetchMock.mock.calls[0][1].signal.aborted).toBe(true);
  });
  it("times out a stalled upstream response body", async () => {
    vi.useFakeTimers(); const cancel = vi.fn();
    fetchMock.mockResolvedValue(new Response(new ReadableStream({ cancel })));
    const pending = POST(request()); await vi.advanceTimersByTimeAsync(20_000);
    expect((await pending).status).toBe(504); expect(cancel).toHaveBeenCalledOnce();
  });
  it.each([400, 401, 403, 404, 429, 500, 503])("sanitizes upstream status %i without forwarding a secret or retrying", async (status) => {
    fetchMock.mockResolvedValue(new Response(token, { status }));
    const response = await POST(request());
    expect(response.status).toBe(status === 429 ? 429 : 503); expect(await response.text()).not.toContain(token);
    expect(response.headers.get("cache-control")).toBe("no-store"); expect(fetchMock).toHaveBeenCalledOnce();
  });
  it.each(["", "not SDP", sdp + "x".repeat(65536), sdp + `a=secret:${token}\r\n`])("rejects malformed, excessive or secret-bearing upstream content", async (body) => {
    fetchMock.mockResolvedValue(new Response(body));
    const response = await POST(request());
    expect(response.status).toBe(502); expect(await response.text()).not.toContain(token);
  });
  it("does not expose upstream network exceptions", async () => {
    fetchMock.mockRejectedValue(new Error(token));
    const response = await POST(request());
    expect(response.status).toBe(503); expect(await response.text()).not.toContain(token);
  });
});
