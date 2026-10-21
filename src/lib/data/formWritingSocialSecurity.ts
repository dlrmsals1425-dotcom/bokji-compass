/**
 * [별지 제1호서식] 사회보장급여 신청(변경)서 (4쪽) — 화면 작성 매핑.
 *
 * 모든 항목 이름·선택지 문구는 원본 서식에 인쇄된 문장을 그대로 옮긴 것이다.
 * 자리(표/행/열/줄 번호)는 원본 section0.xml을 직접 읽어 정한 것이고,
 * 그 자리에 지금 있어야 하는 원문은 formWritingSource.ts에 원본에서 그대로 떠 두었다.
 */
import { at, check, inline, text, type WriteGroup, type WriteRow, type WritingTemplate } from "./formWriting";
import { sourceText } from "./formWritingSource";

const ID = "rule-3211495";
const E = (key: string) => sourceText(ID, key);

/* 1쪽 가족 사항 — 네 줄 (행 11~14) */
const familyRows: WriteRow[] = [11, 12, 13, 14].map((row, index) => ({
  label: `가족 ${index + 1}`,
  fields: [
    text(`fam${index}.rel`, "세대주와의 관계", at(0, row, 1)),
    text(`fam${index}.name`, "성명", at(0, row, 3)),
    text(`fam${index}.rrn`, "주민등록번호 (외국인등록번호 전산관리번호)", at(0, row, 4)),
    text(`fam${index}.live`, "동거여부 (미동거 사유)", at(0, row, 6)),
    text(`fam${index}.school`, "학력·재학여부 (학교명/학년반)", at(0, row, 7)),
    text(`fam${index}.health`, "건강상태 (장애/질병)", at(0, row, 8)),
    text(`fam${index}.job`, "취업상태 — 직업", at(0, row, 9)),
    text(`fam${index}.company`, "취업상태 — 직장명", at(0, row, 10)),
    text(`fam${index}.tel`, "전화번호 (집/직장)", at(0, row, 12), { input: "tel" }),
  ],
}));

/* 1쪽 부양의무자 — 네 줄 (행 18~21). 관계 칸의 접속문자를 완성된 관계명으로 채운다. */
const supporterRows: WriteRow[] = [18, 19, 20, 21].map((row, index) => ({
  label: `부양의무자 ${index + 1}`,
  fields: [
    text(`sup${index}.rel`, "수급권자와의 관계", at(0, row, 1),
      { expect: E(`T0r${row}c1p0`), hint: "수급권자를 기준으로 적어 주세요. 예: 아들, 부" }),
    text(`sup${index}.name`, "성명", at(0, row, 3)),
    text(`sup${index}.rrn`, "주민등록번호 (외국인등록번호 전산관리번호)", at(0, row, 4)),
    text(`sup${index}.addr`, "주소", at(0, row, 6)),
    text(`sup${index}.members`, "가구원 수", at(0, row, 9)),
    text(`sup${index}.tel`, "전화번호", at(0, row, 10), { input: "tel" }),
  ],
}));

/* 1쪽 급여 계좌 — 두 줄 (행 24~25) */
const accountRows: WriteRow[] = [24, 25].map((row, index) => ({
  label: `급여 계좌 ${index + 1}`,
  fields: [
    text(`acc${index}.rel`, "신청인과의 관계", at(0, row, 1)),
    text(`acc${index}.name`, "성명", at(0, row, 3)),
    text(`acc${index}.bank`, "금융기관명", at(0, row, 4)),
    text(`acc${index}.number`, "계좌번호", at(0, row, 6)),
    text(`acc${index}.note`, "비고(사유)", at(0, row, 9)),
  ],
}));

/* 2쪽 가구원 추가 기재(휴대전화 요금할인 신청 시) — 세 줄 (행 21~23) */
const discountRows: WriteRow[] = [21, 22, 23].map((row, index) => ({
  label: `가구원 ${index + 1}`,
  fields: [
    text(`disc${index}.rel`, "신청인과의 관계", at(1, row, 1)),
    text(`disc${index}.name`, "성 명", at(1, row, 2)),
    text(`disc${index}.rrn`, "주민등록번호 (외국인등록번호)", at(1, row, 3)),
    text(`disc${index}.mobile`, "휴대전화 번호", at(1, row, 5), { input: "tel" }),
  ],
}));

const discountCarrierGroups: WriteGroup[] = [21, 22, 23].map((row, index) => ({
  id: `disc-carrier-${index}`,
  title: `가구원 ${index + 1} 이동통신사`,
  checks: ["KT", "SK 텔레콤", "LG 유플러스"].map((label, box) =>
    check(`disc${index}.carrier${box}`, label, at(1, row, 7), E(`T1r${row}c7p0`), box)),
}));

const BOX = (key: string, label: string, table: number, row: number, col: number, p: number, box: number) =>
  check(key, label, at(table, row, col, p), E(`T${table}r${row}c${col}p${p}`), box);

export const SOCIAL_SECURITY_TEMPLATE: WritingTemplate = {
  formId: ID,
  title: "사회보장급여 신청(변경)서",
  lawTitle: "사회보장급여 관련 공통서식에 관한 고시",
  asset: {
    path: "/forms/files/rule-3211495-05a5fb88ab31.hwpx",
    bytes: 43486,
    sha256: "05a5fb88ab3199783d66d5fc77af32f425c07ba34552203d9ca4a2546e3bc1be",
  },
  pageCount: 4,
  tableCount: 4,
  paragraphCount: 402,
  previewTextLimit: 1022,
  manual: [
    "신청인(대리 신청인) 서명 또는 인 — 인쇄한 뒤 직접 서명하거나 도장을 찍어야 해요.",
    "배우자 동시 신청 시 배우자 서명 또는 인",
    "4쪽 '안내사항'의 추가 제출서류(신분증 사본, 임대차 계약서 등 해당하는 서류)",
    "주거급여 임차가구·복수국적자 등 해당자만 내는 증빙서류",
  ],
  steps: [
    {
      id: "applicant",
      title: "신청인",
      description: "서식 1쪽 '신청인' 칸이에요. 급여를 받을 본인(또는 서식에 적는 신청인) 기준으로 적어 주세요.",
      groups: [{
        id: "applicant-basic",
        title: "신 청 인",
        fields: [
          text("a.name", "성명", at(0, 5, 2)),
          text("a.rrn", "주민등록번호 (외국인등록번호 전산관리번호)", at(0, 5, 5)),
          text("a.house", "세대주와의 관계", at(0, 5, 8)),
          text("a.tel", "전화번호", at(0, 5, 10), { input: "tel" }),
          text("a.addr", "주소", at(0, 6, 2)),
          inline("a.addr2", "(실거주지 주소)", at(0, 6, 2, 2), E("T0r6c2p2"), 11, 58,
            { hint: "주민등록상 주소와 실제 거주지가 다를 때만 적어요." }),
          text("a.mobile", "휴대전화", at(0, 6, 10), { input: "tel", hint: "결과 통지를 위해 정확하게 적어 주세요." }),
          text("a.email", "전자우편", at(0, 7, 10), { input: "email" }),
        ],
      }],
    },
    {
      id: "family",
      title: "가족 사항",
      description: "서식 1쪽 '가족 사항' 칸이에요. 해당되지 않는 줄은 비워 두어도 됩니다.",
      groups: [
        { id: "family-rows", title: "가 족 사 항", rows: familyRows },
        {
          id: "family-spouse",
          title: "1. 배우자 관계",
          checks: [
            BOX("sp.legal", "법률혼", 0, 15, 1, 0, 0),
            BOX("sp.de-facto", "사실혼", 0, 15, 1, 0, 1),
            BOX("sp.separated", "사실상 이혼", 0, 15, 1, 0, 2),
          ],
        },
        {
          id: "family-nationality",
          title: "2~4. 외국 여권 소지자명 · 국외 출생자명 · 복수국적자명",
          note: "3), 4) 해당자에 한함 / 5), 6) 아동수당, 부모급여(현금), 양육수당 신청대상에 한함",
          fields: [
            inline("nat.passport1", "2. 외국 여권 소지자명 ①", at(0, 15, 1, 0), E("T0r15c1p0"), 64, 73, { pad: "_" }),
            inline("nat.passport2", "2. 외국 여권 소지자명 ②", at(0, 15, 1, 0), E("T0r15c1p0"), 75, 84, { pad: "_" }),
            inline("nat.born1", "3. 국외 출생자명 ①", at(0, 15, 1, 1), E("T0r15c1p1"), 15, 26, { pad: "_" }),
            inline("nat.born2", "3. 국외 출생자명 ②", at(0, 15, 1, 1), E("T0r15c1p1"), 28, 39, { pad: "_" }),
            inline("nat.multi1", "4. 복수국적자명 ①", at(0, 15, 1, 1), E("T0r15c1p1"), 66, 77, { pad: "_" }),
            inline("nat.multi2", "4. 복수국적자명 ②", at(0, 15, 1, 1), E("T0r15c1p1"), 79, 90, { pad: "_" }),
          ],
        },
      ],
    },
    {
      id: "supporter",
      title: "부양의무자",
      description: "7) 부양의무자 조사 사업 해당자에 한함(부양의무자: ① 수급권자의 1촌의 직계혈족, ② 수급권자의 1촌의 직계혈족의 배우자, 다만 사망한 1촌의 직계혈족의 배우자는 제외)",
      groups: [{ id: "supporter-rows", title: "부 양 의 무 자", rows: supporterRows }],
    },
    {
      id: "account",
      title: "급여 계좌와 통지방법",
      groups: [
        {
          id: "account-rows",
          title: "급여 계좌",
          note: "8) 동일 보장가구원의 계좌가 아닐 경우 사유를 반드시 기재하고, 디딤씨앗계좌(CDA) 또는 압류방지통장이 있는 경우에도 반드시 기재",
          rows: accountRows,
        },
        {
          id: "notify",
          title: "통지방법",
          checks: [
            BOX("nt.paper", "서면", 0, 26, 3, 0, 0),
            BOX("nt.email", "전자우편(E-mail)", 0, 26, 3, 0, 1),
            BOX("nt.sms", "문자메시지서비스(SMS)", 0, 26, 3, 0, 2),
            BOX("nt.other", "기타", 0, 26, 3, 0, 3),
          ],
          fields: [inline("nt.otherText", "기타 (내용)", at(0, 26, 3), E("T0r26c3p0"), 61, 74)],
        },
      ],
    },
    {
      id: "benefits",
      title: "신청할 사회보장급여",
      description: "서식 2쪽 '사회보장급여 내용'이에요. 해당하는 곳만 골라 주세요.",
      groups: [
        {
          id: "b-basic",
          title: "기초생활보장",
          checks: [
            BOX("b.living", "생계급여", 1, 2, 2, 0, 0),
            BOX("b.medical", "의료급여", 1, 2, 2, 0, 1),
            BOX("b.housing", "주거급여", 1, 2, 2, 0, 2),
            BOX("b.housing.own", "주거급여 — 자가", 1, 2, 2, 0, 3),
            BOX("b.housing.rent", "주거급여 — 임차9) (민간·공공임차, 사용대차, 공동생활가정 거주자)", 1, 2, 2, 0, 4),
            BOX("b.housing.etc", "주거급여 — 기타10) (가정위탁(입양대상), 보장시설, 타 법령 우선지원 주거시설, 공공운영 공동생활가정 등)", 1, 2, 2, 0, 5),
            BOX("b.education", "교육급여 (바우처 제공)", 1, 3, 2, 0, 0),
          ],
        },
        {
          id: "b-infant",
          title: "영유아",
          checks: [
            BOX("b.parentCash", "부모급여(현금)", 1, 4, 2, 0, 0),
            BOX("b.childcare", "양육수당", 1, 4, 2, 1, 0),
            BOX("b.childcare.home", "가정양육수당", 1, 4, 2, 1, 1),
            BOX("b.childcare.disabled", "장애아동양육수당", 1, 4, 2, 1, 2),
            BOX("b.childcare.rural", "농어촌양육수당", 1, 4, 2, 1, 3),
            BOX("b.sitterFull", "종일제 아이돌봄서비스", 1, 4, 2, 2, 0),
            BOX("b.sitterPart", "시간제 아이돌봄서비스", 1, 4, 2, 2, 1),
          ],
          fields: [
            inline("b.parentCash.name", "부모급여(현금) 대상자 이름", at(1, 4, 2, 0), E("T1r4c2p0"), 22, 32),
            inline("b.childcare.name", "양육수당 대상자 이름", at(1, 4, 2, 1), E("T1r4c2p1"), 17, 25),
            inline("b.sitterFull.name", "종일제 아이돌봄서비스 대상자 이름", at(1, 4, 2, 2), E("T1r4c2p2"), 24, 33),
            inline("b.sitterPart.name", "시간제 아이돌봄서비스 대상자 이름", at(1, 4, 2, 2), E("T1r4c2p2"), 60, 69),
          ],
        },
        {
          id: "b-childAllowance",
          title: "아동수당",
          checks: [BOX("b.childAllowance", "아동수당 신청", 1, 5, 2, 0, 0)],
          fields: [
            inline("b.childAllowance.1", "지급대상아동이름 ①", at(1, 5, 2), E("T1r5c2p0"), 16, 33),
            inline("b.childAllowance.2", "지급대상아동이름 ②", at(1, 5, 2), E("T1r5c2p0"), 34, 51),
            inline("b.childAllowance.3", "지급대상아동이름 ③", at(1, 5, 2), E("T1r5c2p0"), 52, 66),
          ],
        },
        {
          id: "b-youth",
          title: "아동 · 청소년",
          checks: [
            BOX("b.schoolCost", "초·중·고 학생 교육비 지원 (① 방과후학교 자유수강권 ② 급식(중식)비 ③ 고교 학비지원 ④ 교육정보화 지원)", 1, 6, 2, 0, 0),
            BOX("b.orphan", "소년·소녀가정 보호비", 1, 7, 2, 0, 0),
            BOX("b.youthSupport", "청소년특별지원", 1, 7, 2, 0, 1),
            BOX("b.youthSupport.ext", "청소년특별지원 — 연장신청", 1, 7, 2, 0, 2),
          ],
          groups: [{
            id: "b-schoolCost-pc",
            title: "④ 교육정보화 지원(PC, 인터넷통신비+유해차단서비스)",
            note: "초·중·고 학생 교육비 지원에서 교육정보화 지원을 받을 때만 적어요.",
            // 원본이 'PC 신청 여부'를 신청/미신청 둘 중 하나로 적어 두었다.
            exclusive: [["b.pc.apply", "b.pc.none"]],
            checks: [
              BOX("b.pc.apply", "PC 신청 여부 — 신청", 1, 6, 4, 2, 0),
              BOX("b.pc.none", "PC 신청 여부 — 미신청", 1, 6, 4, 2, 1),
              BOX("b.isp.kt", "인터넷통신사 — KT", 1, 6, 4, 3, 0),
              BOX("b.isp.skb", "인터넷통신사 — SK브로드밴드", 1, 6, 4, 3, 1),
              BOX("b.isp.lg", "인터넷통신사 — LG U+", 1, 6, 4, 3, 2),
              BOX("b.isp.skt", "인터넷통신사 — SK텔레콤", 1, 6, 4, 3, 3),
              BOX("b.isp.etc", "인터넷통신사 — 기타", 1, 6, 4, 3, 4),
              BOX("b.pc.consent", "* (필수) 본인 관련 정보를 정부, 지방자치단체 및 지정 기관(PC 설치업체, 인터넷통신회사)에 제공 동의", 1, 6, 4, 5, 0),
            ],
            fields: [
              inline("b.isp.etcName", "인터넷통신사 기타(회사명)", at(1, 6, 4, 3), E("T1r6c4p3"), 60, 65),
              inline("b.isp.name", "인터넷 가입(예정)자 성명", at(1, 6, 4, 4), E("T1r6c4p4"), 16, 25),
              inline("b.isp.rrn1", "인터넷 가입(예정)자 주민번호 앞자리", at(1, 6, 4, 4), E("T1r6c4p4"), 32, 43),
              inline("b.isp.rrn2", "인터넷 가입(예정)자 주민번호 뒷자리", at(1, 6, 4, 4), E("T1r6c4p4"), 44, 55),
            ],
          }],
        },
        {
          id: "b-senior",
          title: "노 인",
          checks: [
            BOX("b.pension", "기초연금", 1, 8, 2, 0, 0),
            BOX("b.pension.spouse", "기초연금 — 배우자 동시 신청", 1, 8, 2, 0, 1),
          ],
        },
        {
          id: "b-disability",
          title: "장 애 인",
          checks: [
            BOX("b.dPension", "장애인연금", 1, 9, 2, 0, 0),
            BOX("b.dPension.spouse", "장애인연금 — 배우자 동시 신청", 1, 9, 2, 0, 1),
            BOX("b.dPension.extra", "장애인연금 — 차상위 부가급여", 1, 9, 2, 0, 2),
            BOX("b.dAllowance", "장애수당", 1, 9, 2, 0, 3),
            BOX("b.dFamily", "장애아가족양육지원", 1, 9, 2, 0, 4),
            BOX("b.dChild", "장애아동수당", 1, 9, 2, 0, 5),
            BOX("b.dLoan", "장애인자립자금 대여", 1, 9, 2, 0, 6),
          ],
        },
        {
          id: "b-single",
          title: "한부모 가족",
          checks: [
            BOX("b.single", "한부모 가족지원", 1, 10, 2, 0, 0),
            BOX("b.singleYouth", "청소년 한부모 자립지원(급여지급, 증명서 발급)", 1, 10, 2, 0, 1),
          ],
        },
        {
          id: "b-etc",
          title: "기  타",
          checks: [
            BOX("b.near", "차상위계층 확인", 1, 11, 2, 0, 0),
            BOX("b.nearMedical", "차상위 본인부담경감", 1, 11, 2, 0, 1),
            BOX("b.nearSelf", "차상위 자활급여", 1, 11, 2, 0, 2),
            BOX("b.facility", "시설이용·입소", 1, 11, 2, 0, 3),
            BOX("b.asset", "자산형성", 1, 11, 2, 0, 4),
            BOX("b.otherMedical", "타법 의료급여11) (「의료급여법」 제3조제1항제2호부터 제10호에 해당하여 의료급여를 받고자 하는 수급권자)", 1, 11, 2, 0, 5),
            BOX("b.greenbelt", "개발제한구역 거주민 생활비용보조", 1, 11, 2, 1, 0),
            BOX("b.chest", "사회복지공동모금회 등 서비스 의뢰 및 연계", 1, 11, 2, 1, 1),
            BOX("b.multiVisit", "다문화가족 방문교육서비스", 1, 11, 2, 2, 0),
            BOX("b.familyCenter", "가족센터·건강가정지원센터·다문화가족지원센터 서비스 의뢰 및 연계", 1, 11, 2, 2, 1),
          ],
          fields: [inline("b.otherMedical.text", "타법 의료급여 (해당 내용)", at(1, 11, 2), E("T1r11c2p0"), 94, 107)],
        },
      ],
    },
    {
      id: "discount",
      title: "복지대상자 요금 감면 (대행)신청",
      description: "서식 2쪽 아래쪽이에요. 요금 감면을 함께 신청할 때만 적어요.",
      groups: [
        {
          id: "d-status",
          title: "자격구분",
          checks: [
            BOX("d.basic", "기초생활보장수급자", 1, 14, 2, 0, 0),
            BOX("d.basic.living", "기초생활보장수급자 — 생계", 1, 14, 2, 0, 1),
            BOX("d.basic.medical", "기초생활보장수급자 — 의료", 1, 14, 2, 0, 2),
            BOX("d.basic.housing", "기초생활보장수급자 — 주거", 1, 14, 2, 0, 3),
            BOX("d.basic.education", "기초생활보장수급자 — 교육", 1, 14, 2, 0, 4),
            BOX("d.near", "차상위계층", 1, 14, 2, 0, 5),
            BOX("d.disabled", "장애인", 1, 14, 2, 0, 6),
            BOX("d.single", "한부모가족", 1, 14, 2, 0, 7),
            BOX("d.pension", "기초연금", 1, 14, 2, 0, 8),
          ],
        },
        {
          id: "d-services",
          title: "감면 서비스",
          checks: [
            BOX("d.all", "※ 전체 서비스 (대행)신청 시 체크", 1, 15, 3, 0, 0),
            BOX("d.power", "전기요금", 1, 16, 3, 0, 0),
            BOX("d.tv", "TV수신료 면제", 1, 16, 6, 0, 0),
            BOX("d.mobile", "휴대전화요금", 1, 16, 8, 0, 0),
            BOX("d.heating", "지역난방요금", 1, 17, 3, 0, 0),
            BOX("d.gas", "도시가스요금", 1, 17, 6, 0, 0),
            BOX("d.phone", "시내·외유선전화요금", 1, 17, 8, 0, 0),
          ],
        },
        {
          id: "d-detail",
          title: "요금감면 대상 확인 정보",
          note: "※ 아래 항목 작성 시 신속·정확하게 요금감면대상 확인이 가능하며, 미작성 및 부정확한 정보를 작성 시 감면서비스 (대행)신청이 제한될 수 있습니다.",
          fields: [
            inline("d.powerNo", "전기 고객번호", at(1, 18, 0, 2), E("T1r18c0p2"), 11, 24),
            inline("d.heatNo", "지역난방 열사용자번호", at(1, 18, 0, 2), E("T1r18c0p2"), 38, 51),
            inline("d.gasUser", "도시가스 사용계약자명", at(1, 18, 0, 3), E("T1r18c0p3"), 15, 34),
            inline("d.gasCompany", "도시가스 사업자명", at(1, 18, 0, 3), E("T1r18c0p3"), 39, 60),
            inline("d.gasNo", "도시가스 고객번호", at(1, 18, 0, 3), E("T1r18c0p3"), 65, 87),
            inline("d.phoneRrn", "시내·외유선전화 계약자 주민등록번호", at(1, 18, 0, 4), E("T1r18c0p4"), 23, 39),
            inline("d.phoneNo", "시내·외유선전화 전화번호", at(1, 18, 0, 4), E("T1r18c0p4"), 44, 56),
          ],
          checks: [
            BOX("d.carrier.kt", "이동통신사 — KT", 1, 18, 0, 2, 0),
            BOX("d.carrier.skt", "이동통신사 — SK 텔레콤", 1, 18, 0, 2, 1),
            BOX("d.carrier.lg", "이동통신사 — LG유플러스", 1, 18, 0, 2, 2),
            BOX("d.phoneCo.kt", "시내·외유선전화 사업자 — KT", 1, 18, 0, 4, 0),
            BOX("d.phoneCo.skb", "시내·외유선전화 사업자 — SK브로드밴드", 1, 18, 0, 4, 1),
            BOX("d.phoneCo.lg", "시내·외유선전화 사업자 — LG유플러스", 1, 18, 0, 4, 2),
          ],
        },
        {
          id: "d-household",
          title: "가구원 추가 기재(휴대전화 요금할인 신청 시)",
          whenAny: ["d.mobile", "d.all"],
          rows: discountRows,
          groups: discountCarrierGroups,
        },
      ],
    },
    {
      id: "consent",
      title: "동의와 유의사항 확인",
      description: "원본 서식의 동의·확인 칸이에요. 고르지 않으면 빈칸 그대로 둡니다. 내용을 직접 읽고 판단해 주세요.",
      groups: [
        {
          id: "c-required",
          title: "개인정보 수집 및 활용 동의 — 확인 (√ 체크)",
          note: "위 개인정보의 제공 동의를 거부할 권리가 있으며, 동의 거부 시 「사회보장급여의 이용·제공 및 수급권자 발굴에 관한 법률」제7조제6항에 따라 급여 신청을 각하할 수 있습니다.",
          checks: [BOX("c.privacy", "개인정보 수집 및 활용에 동의합니다 (1. 수집·이용에 관한 사항)", 1, 26, 9, 0, 0)],
        },
        {
          id: "c-third",
          title: "개인정보 제3자 제공 동의 — 동의 (√ 체크)",
          note: "제공받는 자: 한국방송공사, 한국전력공사, 이동통신사, 한국가스공사, 도시가스사업자, 지역난방공사, 시내·외유선전화사업자 / 동의를 거부시 요금감면 (대행)신청이 제한됩니다.",
          checks: [BOX("c.third", "2. 제3자 제공에 관한 사항에 동의합니다", 2, 2, 2, 0, 0)],
        },
        {
          id: "c-optional",
          title: "선택적 동의 — 동의 (√ 체크)",
          note: "아래 선택적 동의 항목은 각각 동의하지 않을 수 있으며, 각 항목 미동의 시 신청이 되지 않을 수 있습니다.",
          checks: [
            BOX("c.opt1", "1. 기초생활보장급여를 신청한 경우 차상위계층 지원사업(차상위계층 확인, 차상위 본인부담경감, 차상위 자활급여)을 신청한 것으로 처리하는 것에 동의합니다. 기초생활보장급여가 전부 중지된 경우 관련 개인정보를 활용하여 차상위계층 지원사업을 신청하는 것에 동의합니다.", 2, 5, 2, 0, 0),
            BOX("c.opt2", "2. 차상위계층 지원사업 수급 중 소득이나 재산 등이 변동된 경우 관련 개인정보를 활용하여「국민기초생활 보장법」제21조제2항에 따라 기초생활보장급여를 신청하는 것에 동의합니다.", 2, 6, 2, 0, 0),
            BOX("c.opt3", "3. 교육급여 또는 교육비 지원을 신청한 경우, 교육급여와 교육비 지원을 모두 신청한 것에 동의합니다.", 2, 7, 2, 0, 0),
            BOX("c.opt4", "4. 부모급여(현금)를 신청한 경우 만 2세 연령 도래 시 양육수당 급여를 신청한 것으로 처리하는 것에 동의합니다.", 2, 8, 2, 0, 0),
            BOX("c.opt5", "5. 장애인연금의 차상위 부가급여를 신청하여 차상위 자격이 확인되었으나, 위탁 심사결과「장애인연금법 시행령」제2조에 해당되지 않는 등록장애인일 경우, 장애인연금 신청일을 장애수당 신청일로 처리하는데 동의합니다.", 2, 9, 2, 0, 0),
            BOX("c.opt6", "6. 사회복지공동모금회 등 서비스연계를 신청하는 경우, 신청을 대행하고 필요한 경우 관련 정보(성명, 주소, 연락처, 자격정보 등)를 제공하는 것에 동의합니다.", 2, 10, 2, 0, 0),
            BOX("c.opt7", "7. 가족센터·건강가정지원센터, 다문화가족지원센터 서비스 의뢰 및 연계를 신청하는 경우, 필요한 서비스를 제공받기 위해 개인정보(성명, 주소, 생년월일, 성별, 휴대전화)를 제공하는 것에 동의합니다.", 2, 11, 2, 0, 0),
            BOX("c.opt8", "8. 맞춤형 급여 안내를 신청하고 사회보장급여의 수급 가능성 확인을 위하여 필요한 개인정보, 금융·신용·보험정보 등을 활용하는 것에 동의합니다.(단, 부모급여, 앙육수당, 아동수당 신청에 한함)", 2, 12, 2, 0, 0),
          ],
        },
        {
          id: "c-notice",
          title: "유 의 사 항 — 확인 (√ 체크)",
          note: "1~9번 유의사항(부정수급 환수·처벌, 조사 거부 시 각하, 변동신고 의무, 서류 미반환 등)을 모두 읽고 확인할 때만 체크해 주세요. 원본 서식에서 이 확인칸 하나가 유의사항 전체에 걸쳐 있어요.",
          checks: [BOX("c.notice", "유의사항을 안내받고 확인했습니다", 2, 15, 2, 0, 0)],
        },
      ],
    },
    {
      id: "sign",
      title: "작성일과 이름",
      description: "본인(대리신청인 포함)은 개인정보 활용 동의와 선택적 동의 및 유의사항에 대하여 담당 공무원으로부터 안내받았음을 확인하며, 위와 같이 사회보장급여를 신청합니다.",
      groups: [{
        id: "sign-date",
        title: "작성일과 성명",
        note: "서명 또는 인은 인쇄한 뒤 본인이 직접 해야 해요. 화면에서는 서명하지 않습니다.",
        fields: [
          inline("s.year", "년", at(2, 24, 0, 2), E("T2r24c0p2"), 0, 73, { align: "right", max: 4 }),
          inline("s.month", "월", at(2, 24, 0, 2), E("T2r24c0p2"), 74, 80, { align: "right", max: 2 }),
          inline("s.day", "일", at(2, 24, 0, 2), E("T2r24c0p2"), 81, 86, { align: "right", max: 2 }),
          inline("s.name", "신청인(대리 신청인)12) 성명", at(2, 24, 0, 4), E("T2r24c0p4"), 18, 33,
            { hint: "12) 가족, 친족(8촌이내의 혈족, 4촌이내의 인척), 사회복지담당공무원 및 기타 관계인(후견인) 등" }),
          inline("s.spouse", "(배우자 동시 신청 시) 배우자", at(2, 24, 0, 5), E("T2r24c0p5"), 18, 33),
        ],
      }],
    },
  ],
};
