export const MAX_VOICE_TEXT_LENGTH = 500;

/** Append confirmed speech without changing existing text or truncating either input. */
export function appendVoiceTranscript(
  existing: string,
  transcript: string,
): { ok: true; text: string } | { ok: false; message: string } {
  const spoken = transcript.trim();
  if (!spoken) return { ok: false, message: "인식된 내용이 없어요. 다시 말해 주세요." };
  if (spoken.length > MAX_VOICE_TEXT_LENGTH) {
    return { ok: false, message: "음성 입력은 500자 이하로 말해 주세요." };
  }

  const text = existing.trim()
    ? `${existing}${/\s$/u.test(existing) ? "" : " "}${spoken}`
    : spoken;
  if (text.length > MAX_VOICE_TEXT_LENGTH) {
    return { ok: false, message: "기존 내용과 음성 입력을 합쳐 500자 이내로 입력해 주세요." };
  }
  return { ok: true, text };
}
