import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GET, POST } from "@/app/api/voice/transcribe/route";

const token = "test-only-service-token-32-characters";
const fetchMock = vi.fn();
function request(body: BodyInit | null = "audio", headers: Record<string, string> = {}) {
  return new Request("http://localhost:3220/api/voice/transcribe", {
    method: "POST", body, headers: { origin: "http://localhost:3220", "content-type": "audio/webm;codecs=opus", ...headers },
    ...(body instanceof ReadableStream ? { duplex: "half" } : {}),
  });
}
beforeEach(() => {
  vi.stubEnv("OPENAI_API_KEY", token);
  fetchMock.mockReset().mockResolvedValue(Response.json({ text: "수원시에 살아요." }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("same-origin STT gateway", () => {
  it("forwards audio and a server-only secret but returns only the transcript", async () => {
    fetchMock.mockResolvedValue(Response.json({ text: "수원시", token, extra: "private" }));
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(await response.json()).toEqual({ text: "수원시" });
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.openai.com/v1/audio/transcriptions");
    expect(init.headers).toEqual({ Authorization: `Bearer ${token}` });
    expect(init.redirect).toBe("error");
    const form = init.body as FormData;
    expect(form.get("model")).toBe("gpt-transcribe");
    expect(form.getAll("languages[]")).toEqual(["ko"]);
    expect(form.get("response_format")).toBe("json");
    const file = form.get("file") as File;
    expect(file.name).toBe("recording.webm");
    expect(file.type).toBe("audio/webm");
    expect(await file.text()).toBe("audio");
  });
  it.each(["https://attacker.example", "null", ""])("rejects a foreign/missing Origin %s before forwarding", async (origin) => {
    expect((await POST(request("audio", { origin }))).status).toBe(403);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("uses the actual Host when Next normalizes the internal URL to localhost", async () => {
    expect((await POST(request("audio", { host: "127.0.0.1:3220", origin: "http://127.0.0.1:3220" }))).status).toBe(200);
    expect((await POST(request("audio", { host: "127.0.0.1:3220" }))).status).toBe(403);
    expect((await POST(request("audio", { host: "127.0.0.1:3220", "x-forwarded-host": "localhost:3220" }))).status).toBe(403);
  });
  it.each(["", "   "])("rejects missing/blank OpenAI keys before sending audio", async (key) => {
    vi.stubEnv("OPENAI_API_KEY", key);
    expect((await POST(request())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("does not send OpenAI keys to the old worker URL", async () => {
    vi.stubEnv("STT_SERVICE_URL", "https://untrusted.example.com");
    expect((await POST(request())).status).toBe(200);
    expect(String(fetchMock.mock.calls[0][0])).toBe("https://api.openai.com/v1/audio/transcriptions");
  });
  it("never silently falls back to local Whisper if the OpenAI key is missing", async () => {
    vi.stubEnv("OPENAI_API_KEY", "");
    vi.stubEnv("STT_SERVICE_URL", "http://127.0.0.1:8767");
    vi.stubEnv("STT_SERVICE_TOKEN", token);
    expect((await POST(request())).status).toBe(503);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([["audio/mp4", "mp4"], ["audio/ogg", "ogg"], ["audio/wav", "wav"], ["audio/x-wav", "wav"], ["video/webm", "webm"]])("names %s uploads with a matching extension", async (type, extension) => {
    await POST(request("audio", { "content-type": type }));
    const file = (fetchMock.mock.calls[0][1].body as FormData).get("file") as File;
    expect(file.name).toBe(`recording.${extension}`);
    expect(file.type).toBe(type);
  });
  it("rejects a non-audio body, an empty body, and a declared oversized body", async () => {
    expect((await POST(request("text", { "content-type": "text/plain" }))).status).toBe(415);
    expect((await POST(request(null))).status).toBe(422);
    expect((await POST(request("", { "content-length": String(8 * 1024 * 1024 + 1) }))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("bounds streamed bodies even without Content-Length", async () => {
    const stream = new ReadableStream({ start(controller) {
      controller.enqueue(new Uint8Array(8 * 1024 * 1024));
      controller.enqueue(new Uint8Array(1));
      controller.close();
    } });
    expect((await POST(request(stream))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it("limits concurrent buffered requests and releases capacity after completion", async () => {
    const resolve: ((response: Response) => void)[] = [];
    fetchMock.mockImplementation(() => new Promise((done) => { resolve.push(done); }));
    const first = POST(request()); const second = POST(request());
    expect((await POST(request())).status).toBe(429);
    for (let i = 0; i < 10; i++) await Promise.resolve();
    resolve.forEach((done) => done(Response.json({ text: "ok" })));
    await Promise.all([first, second]);
    fetchMock.mockResolvedValue(Response.json({ text: "next" }));
    expect((await POST(request())).status).toBe(200);
  });
  it("releases a stalled upload after 15 seconds", async () => {
    vi.useFakeTimers();
    const pending = POST(request(new ReadableStream()));
    await vi.advanceTimersByTimeAsync(15_000);
    expect((await pending).status).toBe(408);
    expect(fetchMock).not.toHaveBeenCalled();
  });
  it.each([[413, 413], [422, 422], [429, 429], [503, 503], [401, 503], [403, 503], [404, 503], [400, 422], [415, 422], [500, 502]])("sanitizes upstream %i as %i without retrying", async (status, expected) => {
    fetchMock.mockResolvedValue(new Response("private details " + token, { status }));
    const response = await POST(request());
    expect(response.status).toBe(expected);
    expect(await response.text()).not.toContain(token);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it.each([{}, { text: 42 }, { text: "x".repeat(10_001) }])("rejects invalid upstream output", async (body) => {
    fetchMock.mockResolvedValue(Response.json(body));
    expect((await POST(request())).status).toBe(502);
  });
  it("handles empty transcription as no speech", async () => {
    fetchMock.mockResolvedValue(Response.json({ text: "  ", languages: [] }));
    expect((await POST(request())).status).toBe(422);
  });
  it("does not leak network errors", async () => {
    fetchMock.mockRejectedValue(new Error(token));
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(token);
  });
  it("availability checks configuration without paid requests or exposing a key", async () => {
    for (const ready of [false, true]) {
      vi.stubEnv("OPENAI_API_KEY", ready ? token : "");
      const response = await GET();
      expect(response.status).toBe(ready ? 200 : 503);
      expect(await response.json()).toEqual({ available: ready });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
