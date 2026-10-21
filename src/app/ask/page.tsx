import type { Metadata } from "next";
import { GuidedFlow } from "./GuidedFlow";

export const metadata: Metadata = { title: "골라서 찾기" };

export default function AskPage() {
  return <GuidedFlow />;
}
