import type { Metadata } from "next";
import { FormsOverview } from "./FormsOverview";

export const metadata: Metadata = { title: "신청 서식" };
export default function FormsPage() { return <FormsOverview />; }
