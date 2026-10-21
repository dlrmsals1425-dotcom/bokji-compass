import type { Metadata } from "next";
import { GuidedFlow } from "../ask/GuidedFlow";

export const metadata: Metadata = { title: "쉬운 찾기" };

export default function EasyPage() {
  return <GuidedFlow easy />;
}
