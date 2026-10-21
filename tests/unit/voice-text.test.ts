import { describe, expect, it } from "vitest";
import { appendVoiceTranscript, MAX_VOICE_TEXT_LENGTH } from "@/lib/voice/text";

describe("확인한 음성 전사문 덧붙이기", () => {
  it("입력 한도는 500자다", () => {
    expect(MAX_VOICE_TEXT_LENGTH).toBe(500);
  });

  it.each(["", " ", "\t\r\n", "\u3000"])("빈 기존 입력 %j에는 전사문을 넣는다", (existing) => {
    expect(appendVoiceTranscript(existing, "  부모님 돌봄이 필요해요. \n")).toEqual({
      ok: true, text: "부모님 돌봄이 필요해요.",
    });
  });

  it.each(["", " ", "\n\t", "\u3000"])("빈 전사문 %j는 오류이고 기존 입력은 보존한다", (transcript) => {
    const existing = "서울에 살아요.";
    const result = appendVoiceTranscript(existing, transcript);
    expect(result).toEqual({ ok: false, message: expect.any(String) });
    expect(result).not.toHaveProperty("text");
    expect(existing).toBe("서울에 살아요.");
  });

  it("기존 문장 뒤에 공백 하나와 전사문을 덧붙인다", () => {
    expect(appendVoiceTranscript("서울에 살아요.", "월세 지원이 필요해요.")).toEqual({
      ok: true, text: "서울에 살아요. 월세 지원이 필요해요.",
    });
  });

  it.each([" ", "  ", "\n", "\r\n", "\t", "\u3000"])("기존 끝의 공백 %j는 그대로 유지한다", (whitespace) => {
    const existing = `  서울에  살아요.${whitespace}`;
    expect(appendVoiceTranscript(existing, "  부모님과 살아요.  ")).toEqual({
      ok: true, text: `${existing}부모님과 살아요.`,
    });
  });

  it("기존 앞·중간 공백과 전사문 내부 줄바꿈·숫자·문구를 바꾸지 않는다", () => {
    expect(appendVoiceTranscript("  부모님은  부산에 계세요.", " \n만 65세예요.\n소득은 1,200만원이에요. \n")).toEqual({
      ok: true, text: "  부모님은  부산에 계세요. 만 65세예요.\n소득은 1,200만원이에요.",
    });
  });

  it("삭제 지시처럼 들리는 전사문도 기존 내용을 지우지 않고 텍스트로 넣는다", () => {
    expect(appendVoiceTranscript("기존 상황", "기존 내용을 지워줘")).toEqual({
      ok: true, text: "기존 상황 기존 내용을 지워줘",
    });
  });

  it("전사문 바깥 공백을 제외하고 정확히 500자는 허용한다", () => {
    const transcript = "가".repeat(500);
    expect(appendVoiceTranscript("", ` \n${transcript}\t `)).toEqual({ ok: true, text: transcript });
  });

  it("전사문 501자는 잘라 넣지 않고 거절한다", () => {
    const result = appendVoiceTranscript("", "가".repeat(501));
    expect(result).toEqual({ ok: false, message: expect.stringContaining("500") });
    expect(result).not.toHaveProperty("text");
  });

  it("추가 구분 공백을 포함해 전체 500자는 허용한다", () => {
    const existing = "가".repeat(498);
    expect(appendVoiceTranscript(existing, "나")).toEqual({ ok: true, text: `${existing} 나` });
  });

  it("추가 구분 공백까지 합쳐 501자이면 오류이며 기존 내용과 전사문은 그대로다", () => {
    const existing = "가".repeat(499), transcript = "나";
    const result = appendVoiceTranscript(existing, transcript);
    expect(result).toEqual({ ok: false, message: expect.stringContaining("500") });
    expect(result).not.toHaveProperty("text");
    expect(existing).toBe("가".repeat(499));
    expect(transcript).toBe("나");
  });

  it("기존 끝에 공백이 있으면 불필요한 추가 공백으로 한도를 넘기지 않는다", () => {
    const existing = `${"가".repeat(498)} `;
    expect(appendVoiceTranscript(existing, "나")).toEqual({ ok: true, text: `${existing}나` });
  });

  it.each([500, 501, 1000])("기존 내용이 이미 %i자이면 자르거나 덮어쓰지 않는다", (length) => {
    const existing = "가".repeat(length);
    expect(appendVoiceTranscript(existing, "나")).toEqual({ ok: false, message: expect.stringContaining("500") });
    expect(existing.length).toBe(length);
  });

  it("문자열 길이 기준을 사용하며 이모지의 일부를 잘라 반환하지 않는다", () => {
    expect(appendVoiceTranscript("", "😀".repeat(250))).toEqual({ ok: true, text: "😀".repeat(250) });
    expect(appendVoiceTranscript("", "😀".repeat(251))).toEqual({ ok: false, message: expect.stringContaining("500") });
  });
});
