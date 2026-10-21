/** HWPX는 ZIP 꾸러미다. 브라우저에서 꾸러미를 풀고 다시 묶는 부분만 모아 둔다. */
import { unzipSync, zipSync, strFromU8, strToU8, type Zippable } from "fflate";

/** 패키지 규격상 mimetype이 첫 항목이고 압축하지 않아야 한다. version.xml도 원본과 같게 둔다. */
const STORED = ["mimetype", "version.xml"];
export const HWPX_MIMETYPE = "application/hwp+zip";
const ZIP_TIME = "1980-01-01T00:00:00Z";

export interface HwpxPackage {
  /** 원본 꾸러미의 항목 차례 */
  order: string[];
  files: Record<string, Uint8Array>;
}

export function readHwpx(bytes: Uint8Array): HwpxPackage {
  const files = unzipSync(bytes);
  const order = Object.keys(files);
  if (order[0] !== "mimetype") throw new Error("원본 서식의 꾸러미 구성이 예상과 다릅니다.");
  if (strFromU8(files["mimetype"]).trim() !== HWPX_MIMETYPE) throw new Error("원본 서식이 한글 문서 꾸러미가 아닙니다.");
  for (const required of ["Contents/section0.xml", "Contents/header.xml", "META-INF/manifest.xml"]) {
    if (!files[required]) throw new Error("원본 서식에 필요한 내용이 없습니다.");
  }
  return { order, files };
}

export function writeHwpx(pkg: HwpxPackage): Uint8Array {
  const zippable: Zippable = {};
  const names = ["mimetype", ...pkg.order.filter(name => name !== "mimetype")];
  for (const name of names) {
    const data = pkg.files[name];
    if (!data) throw new Error("원본 서식의 항목이 사라졌습니다.");
    zippable[name] = STORED.includes(name) ? [data, { level: 0 }] : [data, { level: 6 }];
  }
  // 같은 입력이면 같은 파일이 나오도록 시각을 고정한다 (쓰는 사람의 시계도 파일에 남지 않는다).
  return zipSync(zippable, { mtime: ZIP_TIME });
}

export const decodeUtf8 = (bytes: Uint8Array) => strFromU8(bytes);
export const encodeUtf8 = (text: string) => strToU8(text);
