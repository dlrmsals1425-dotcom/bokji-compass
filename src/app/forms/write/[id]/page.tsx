import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { FormWriter } from "@/components/FormWriter";
import { writingTemplate } from "@/lib/data/formWritingRegistry";

export async function generateMetadata({ params }: PageProps<"/forms/write/[id]">): Promise<Metadata> {
  const { id } = await params;
  const template = writingTemplate(id);
  if (!template) return { title: "찾을 수 없는 페이지" };
  // 작성 화면은 입력 내용이 담기는 화면이라 검색엔진에 올리지 않는다.
  return { title: `${template.title} 화면에서 작성하기`, robots: { index: false, follow: false } };
}

export default async function FormWritePage({ params, searchParams }: PageProps<"/forms/write/[id]">) {
  const { id } = await params;
  const template = writingTemplate(id);
  if (!template) notFound();
  const program = (await searchParams).program;
  return <FormWriter key={`${template.formId}:${typeof program === "string" ? program : ""}`} template={template} programId={typeof program === "string" ? program : undefined} />;
}
