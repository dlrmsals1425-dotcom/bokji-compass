import type { Metadata } from "next";
import meta from "../../../public/bundles/v1/meta.json";
import { DataStatus } from "./DataStatus";

export const metadata: Metadata = { title: "데이터 현황" };

export default function DataPage() {
  return <DataStatus siteGeneratedAt={meta.generatedAt} sitePrograms={meta.counts.placements} />;
}
