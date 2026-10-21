/** 화면 작성이 가능한 서식 목록. 여기 없는 서식에는 작성 버튼을 내보내지 않는다. */
import type { WritingTemplate } from "./formWriting";
import { SOCIAL_SECURITY_TEMPLATE } from "./formWritingSocialSecurity";
import { VOUCHER_TEMPLATE } from "./formWritingVoucher";

export const WRITING_TEMPLATES: WritingTemplate[] = [SOCIAL_SECURITY_TEMPLATE, VOUCHER_TEMPLATE];

export const writingTemplate = (formId: string | undefined | null): WritingTemplate | null =>
  WRITING_TEMPLATES.find(template => template.formId === formId) ?? null;

export const canWriteForm = (formId: string) => WRITING_TEMPLATES.some(template => template.formId === formId);
