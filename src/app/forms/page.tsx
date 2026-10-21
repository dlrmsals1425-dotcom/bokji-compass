import type { Metadata } from "next";
import { FormsOverview } from "./FormsOverview";

export const metadata: Metadata = { title: "신청서 연결 현황" };
export default function FormsPage() { return <FormsOverview />; }
