"use client";
/**
 * 준비물 한 장 → PNG (브라우저 캔버스에 직접 그림, 외부 라이브러리·서버 없음).
 * 들어가는 것: 지역 이름·날짜·신청하는 곳·혜택 이름·가져갈 것·문의 전화. 나이·소득 등 입력값은 넣지 않는다.
 * (2026-10-16) 신청하러 갈 곳마다 한 장 — 담당자께 칸(서비스 번호·무엇·대상·근거)을 함께.
 */
import type { SheetPlace } from "./visit";
import { SHEET_STATUS } from "./visit";

const W = 1080;
const PAD = 64;
const FONT = '"Pretendard Variable", Pretendard, "Apple SD Gothic Neo", "Noto Sans KR", "Malgun Gothic", sans-serif';
const C = { ink: "#14213D", ink2: "#464c53", muted: "#5d6670", blue: "#1D4ED8", line: "#cdd1d5", soft: "#ecf2fe" };

type Op = { kind: "text"; text: string; size: number; weight: number; color: string; x: number; lh: number } | { kind: "box"; x: number; size: number } | { kind: "rule" } | { kind: "gap"; h: number } | { kind: "place"; text: string };

function wrap(ctx: CanvasRenderingContext2D, text: string, max: number): string[] {
  const out: string[] = [];
  let cur = "";
  for (const ch of text) {
    const next = cur + ch;
    if (ctx.measureText(next).width > max && cur) {
      // 단어 중간이면 마지막 공백에서 끊는다
      const sp = cur.lastIndexOf(" ");
      if (sp > cur.length * 0.6) {
        out.push(cur.slice(0, sp));
        cur = cur.slice(sp + 1) + ch;
      } else {
        out.push(cur);
        cur = ch;
      }
    } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}

export interface SheetMeta {
  region: string;
  date: string;
  /** 몇 번째 곳 / 모두 몇 곳 */
  index: number;
  total: number;
}

/** 캔버스에 그리고 PNG Blob 으로 */
export async function renderSheetPng(pl: SheetPlace, meta: SheetMeta): Promise<Blob> {
  if (typeof document !== "undefined" && document.fonts?.ready) await document.fonts.ready.catch(() => undefined);
  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("canvas");
  const lines: { op: Op; y: number; h: number }[] = [];
  let y = PAD;
  const font = (size: number, weight: number) => `${weight} ${size}px ${FONT}`;
  const text = (t: string, size: number, weight: number, color: string, x = PAD, indentMax = W - PAD * 2 - (x - PAD)) => {
    ctx.font = font(size, weight);
    const lh = Math.round(size * 1.45);
    for (const l of wrap(ctx, t, indentMax)) {
      lines.push({ op: { kind: "text", text: l, size, weight, color, x, lh }, y, h: lh });
      y += lh;
    }
  };
  text(`복지나침반 · 방문처별 준비물${meta.total > 1 ? ` ${meta.index + 1}/${meta.total}` : ""}`, 30, 700, C.blue);
  text(`${meta.region} 기준 · ${meta.date}`, 26, 500, C.muted);
  y += 12;
  lines.push({ op: { kind: "rule" }, y, h: 2 });
  y += 28;
  const visit = pl.key !== "none" && pl.key !== "online";
  const title = pl.key === "none" ? "따로 신청하지 않아도 되는 것" : pl.key === "online" ? "온라인으로 신청할 것" : pl.key === "agency" ? "담당 기관에 먼저 문의할 것" : `${pl.label}에 가져갈 한 장`;
  {
    const ph = 64;
    lines.push({ op: { kind: "place", text: title }, y, h: ph });
    y += ph + 16;
    if (visit) {
      text(`담당자께 — 이 분은 아래 ${pl.programs.length > 1 ? `${pl.programs.length}가지를` : "사업을"} 신청(자격 확인 포함)하러 오셨어요. 사업명·서비스 번호로 정부24·복지로 원문을 찾아보실 수 있어요.`, 24, 600, C.ink2);
      y += 8;
    }
    text("신청할 것", 26, 700, C.blue);
    pl.programs.forEach((p, k) => {
      text(`${k + 1}. ${p.name}${p.staff.ref ? `  (${p.staff.ref})` : ""}`, 30, 700, C.ink, PAD + 8);
      if (p.staff.what) text(p.staff.what, 24, 500, C.ink2, PAD + 34);
      if (p.staff.target) text(`대상(원문) — ${p.staff.target}`, 24, 500, C.ink2, PAD + 34);
      if (p.staff.basis) text(p.staff.basis, 24, 500, C.ink2, PAD + 34);
      const sub = [SHEET_STATUS[p.bucket], ...p.also].filter(Boolean).join(" · ");
      if (sub) text(sub, 24, 500, C.muted, PAD + 34);
      y += 6;
    });
    y += 8;
    if (pl.key !== "none") {
      text(pl.key === "online" ? "준비할 서류" : "가져갈 것", 26, 700, C.blue);
      if (pl.bring.length) {
        for (const b of pl.bring) {
          lines.push({ op: { kind: "box", x: PAD + 8, size: 26 }, y: y + 8, h: 0 });
          text(b.item + (pl.programs.length > 1 ? ` (${b.for.length === pl.programs.length ? "모두" : b.for.join(", ")})` : ""), 28, 500, C.ink, PAD + 48);
        }
      }
      if (pl.cond.length) text(`해당하는 분만: ${pl.cond.map((c) => c.item).join(", ")}`, 24, 500, C.ink2, PAD + 8);
      if (pl.forms.length) text(`신청서 서식(원문 첨부, 창구에도 있어요): ${pl.forms.map((c) => c.item).join(", ")}`, 24, 500, C.ink2, PAD + 8);
      if (pl.proxy.length) text(`가족이 대신 신청할 때: ${pl.proxy.join(", ")}`, 24, 500, C.ink2, PAD + 8);
      const missing = pl.programs.filter((p) => p.docs === "missing").map((p) => p.name);
      const more = pl.programs.filter((p) => p.more > 0).map((p) => p.name);
      if (more.length || pl.trimmed) text(`서류가 더 있어요 — 상세 페이지·창구에서 확인${more.length ? `: ${more.join(", ")}` : ""}`, 24, 500, C.ink2, PAD + 8);
      if (missing.length) text(`구비서류가 원문에 없어요 — 창구에 문의: ${missing.join(", ")}`, 24, 500, C.ink2, PAD + 8);
    }
    if (pl.phones.length) text(`문의: ${pl.phones.map((x) => x.phone).join(" / ")}`, 24, 500, C.ink2, PAD + 8);
  }
  y += 24;
  lines.push({ op: { kind: "rule" }, y, h: 2 });
  y += 24;
  text("원문(정부24·복지로) 기준이에요. 서류는 바뀔 수 있으니 가기 전에 전화로 확인하세요. 궁금한 점은 보건복지상담센터(☎129)에 물어보세요. 최종 자격은 담당 기관이 정해요.", 22, 500, C.muted);
  y += PAD - 20;

  const scale = 1;
  canvas.width = W * scale;
  canvas.height = Math.ceil(y) * scale;
  ctx.scale(scale, scale);
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, W, y);
  ctx.textBaseline = "top";
  for (const { op, y: ly, h } of lines) {
    if (op.kind === "text") {
      ctx.font = font(op.size, op.weight);
      ctx.fillStyle = op.color;
      ctx.fillText(op.text, op.x, ly + (op.lh - op.size) / 2);
    } else if (op.kind === "box") {
      ctx.strokeStyle = C.ink;
      ctx.lineWidth = 2.5;
      ctx.strokeRect(op.x, ly, op.size, op.size);
    } else if (op.kind === "rule") {
      ctx.fillStyle = C.line;
      ctx.fillRect(PAD, ly, W - PAD * 2, 2);
    } else if (op.kind === "place") {
      ctx.fillStyle = C.soft;
      ctx.fillRect(PAD - 16, ly, W - PAD * 2 + 32, h);
      ctx.font = font(36, 800);
      ctx.fillStyle = C.ink;
      ctx.fillText(op.text, PAD, ly + (h - 36) / 2);
    }
  }
  return await new Promise<Blob>((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error("toBlob"))), "image/png"));
}
