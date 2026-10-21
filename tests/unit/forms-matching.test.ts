import { describe, expect, it } from "vitest";
import { classifyFormRole, findFormCandidates } from "@/lib/data/formMatching";
import type { ApplicationForm, FormRole } from "@/lib/data/forms";
import type { Program, RegionRef } from "@/lib/data/types";

const goyang: RegionRef = { sido: "41000", sigungu: "41280", label: "경기 고양시" };
const suwon: RegionRef = { sido: "41000", sigungu: "41110", label: "경기 수원시" };

const prog = (p: Partial<Program>): Program => ({
  id: "p", name: "테스트", summary: "", category: "생활지원", orgType: "local", scope: "sigungu",
  region: goyang, sources: [], trust: "A", rule: { all: [] }, ...p,
}) as unknown as Program;

function form(p: Partial<ApplicationForm> & { id: string; title: string }): ApplicationForm {
  return {
    role: "application", lawTitle: "", lawId: "", annexId: "", annexNumber: "",
    regionCode: "41280", regionLabel: "경기도 고양시", effectiveDate: "", sourceUrl: "", lawUrl: "", fetchedAt: "",
    ...p,
  };
}

const ids = (program: Program, forms: ApplicationForm[]) => findFormCandidates(program, forms).map((c) => c.formId);

describe("classifyFormRole", () => {
  it("삭제 표시와 삭제 구분을 먼저 본다", () => {
    expect(classifyFormRole("[별지 제1호서식] <삭제 2017.11.14.>", "삭제")).toBe("deleted");
    expect(classifyFormRole("[별지 제1호서식] <삭제 2017.11.14.>", "서식")).toBe("deleted");
    expect(classifyFormRole("교복구입비 지원신청서", "deleted")).toBe("deleted");
  });

  it("별표는 시민 신청서가 아니다", () => {
    expect(classifyFormRole("[별표 1] 고양시 장기요양기관 지정 심사기준", "별표")).toBe("reference");
    expect(classifyFormRole("[별표] 가구소득에 따른 지원액", "reference")).toBe("reference");
  });

  it("기관·업체 신청서는 제목에 신청서가 있어도 신청서가 아니다", () => {
    const samples = [
      "[별지 제1호서식] 노인복지시설 수탁운영 신청서",
      "[별지 제1호서식] 장애인 이동용 보장구 수리업체 지정 신청서",
      "[별지 제4호서식] 우수농산물 학교급식 지원신청서(학교용)",
      "[별지 제5호서식] 우수농산물 학교급식 지원신청서(교육지원청용)",
      "[별지 제1호서식] 학교급식 지원금 교부신청서",
      "[별지 제2호서식] 장애인 이동용 보장구 수리업체 지정서",
    ];
    for (const title of samples) expect(classifyFormRole(title, "서식"), title).toBe("administrative");
  });

  it("대장·출납·명부는 시민 신청서가 아니다", () => {
    expect(classifyFormRole("[별지 제10호서식]현금출납부", "서식")).toBe("administrative");
    expect(classifyFormRole("[별지 제2호서식] 고양시 장수축하금 지급대장", "서식")).toBe("administrative");
    expect(classifyFormRole("[별지 제2호서식] 효도수당 지급대상자 명부", "서식")).toBe("administrative");
    expect(classifyFormRole("[별지 제3호서식] 자활기금 지원 결정 통지서", "서식")).toBe("administrative");
  });

  it("위임장·동의서·서약서·시민 신청서·확인서", () => {
    expect(classifyFormRole("[별지 제2호서식] 고양시 노동취약계층 유급병가지원 신청 위임장", "서식")).toBe("delegation");
    expect(classifyFormRole("[별지 제2호서식] 고양시 한시적 양육비 지원을 위한 개인정보 수집ㆍ이용 및 제3자 제공 동의서", "서식")).toBe("consent");
    expect(classifyFormRole("[별지 제2호서식] 출산가구 전월세자금 대출이자 지원 신청 서약서 및 동의서", "서식")).toBe("consent");
    expect(classifyFormRole("[별지 제4호서식] 서약서", "서식")).toBe("consent");
    expect(classifyFormRole("[별지 서식] 교복구입비 지원신청서", "서식")).toBe("application");
    expect(classifyFormRole("[별지 제1호서식] 아동ㆍ청소년 법률지원 신청서", "서식")).toBe("application");
    expect(classifyFormRole("[별지 제2호서식] 등록금 지급(미지급) 확인서", "서식")).toBe("supporting");
    expect(classifyFormRole("사업계획서", "서식")).toBe("reference");
  });
});

describe("findFormCandidates", () => {
  const meal = form({ id: "meal", title: "[별지 서식] 아동급식 신청서", lawTitle: "고양시 아동급식지원에 관한 조례" });

  it("같은 이름이라도 다른 시와 전국 사업에는 고양시 서식을 붙이지 않는다", () => {
    const name = "아동급식 지원";
    const laws = ["고양시 아동급식지원에 관한 조례(제4조)"];
    expect(ids(prog({ name, laws }), [meal])).toEqual(["meal"]);
    expect(ids(prog({ name, laws, region: suwon }), [meal])).toEqual([]);
    expect(ids(prog({ name, laws, scope: "national", region: undefined }), [meal])).toEqual([]);
    expect(ids(prog({ name, laws, scope: "sido", region: { sido: "41000", label: "경기도" } }), [meal])).toEqual([]);
  });

  it("전국 서식은 전국 사업에만, 도 서식은 그 도 사업에만 붙인다", () => {
    const national = form({
      id: "nat", title: "아동급식 신청서", regionCode: "national", regionLabel: "전국", lawTitle: "아동복지법",
    });
    const province = form({
      id: "gg", title: "한시적 양육비 지원 신청서", regionCode: "41000", regionLabel: "경기도",
      lawTitle: "경기도 양육비 지원 조례",
    });
    const local = prog({ name: "아동급식 지원", laws: ["아동복지법"] });
    expect(ids(local, [national])).toEqual([]);
    expect(ids(prog({ name: "아동급식 지원", scope: "national", region: undefined, laws: ["아동복지법"] }), [national])).toEqual(["nat"]);
    expect(ids(prog({ name: "한시적 양육비 지원", laws: ["경기도 양육비 지원 조례"] }), [province])).toEqual([]);
    expect(ids(prog({
      name: "한시적 양육비 지원", scope: "sido", region: { sido: "41000", label: "경기도" }, laws: ["경기도 양육비 지원 조례"],
    }), [province])).toEqual(["gg"]);
    expect(ids(prog({
      name: "한시적 양육비 지원", scope: "sido", region: { sido: "11000", label: "서울특별시" }, laws: ["경기도 양육비 지원 조례"],
    }), [province])).toEqual([]);
  });

  it("삭제·별표·기관 신청서·대장류는 법령이 같아도 후보가 아니다", () => {
    const law = "고양시 노인복지 조례";
    const program = prog({ name: "노인복지시설 수탁", laws: [law] });
    const forms = [
      form({ id: "gone-role", title: "교복구입비 지원신청서", role: "deleted", lawTitle: law }),
      form({ id: "gone-title", title: "[별지 제1호서식] <삭제 2017.11.14.>", role: "application", lawTitle: law }),
      form({ id: "annex", title: "[별표 1] 심사기준", role: "application" as FormRole, lawTitle: law }),
      form({ id: "operator", title: "노인복지시설 수탁운영 신청서", role: "application", lawTitle: law }),
      form({ id: "ledger", title: "현금출납부", role: "application", lawTitle: law }),
      form({ id: "roll", title: "지급대상자 명부", role: "application", lawTitle: law }),
    ];
    expect(ids(program, forms)).toEqual([]);
  });

  it("같은 법령의 신청서·위임장·동의서·확인서는 후보지만 전부 필수라는 뜻은 아니다", () => {
    const law = "고양시 한시적 양육비 지원 조례";
    const program = prog({ name: "한시적 양육비 지원", laws: [`${law}(제5조, 제1항)`] });
    const forms = [
      form({ id: "app", title: "한시적 양육비 지원 신청서", role: "application", lawTitle: law }),
      form({ id: "proxy", title: "한시적 양육비 지원 신청 위임장", role: "delegation", lawTitle: `「${law}」` }),
      form({ id: "consent", title: "개인정보 수집ㆍ이용 동의서", role: "consent", lawTitle: law }),
      form({ id: "proof", title: "양육비 지급 확인서", role: "supporting", lawTitle: law }),
      form({ id: "book", title: "양육비 지원대장", role: "administrative", lawTitle: law }),
    ];
    const found = findFormCandidates(program, forms);
    expect(found.map((c) => c.formId)).toEqual(["app", "proxy", "consent", "proof"]);
    for (const c of found) {
      expect(c.reason).toContain("검토 후보");
      expect(c.reason).toContain(law);
      expect(c.reason).not.toMatch(/필수|모두|확정|게시|검증/);
    }
  });

  it("조문 표기를 뺀 법령명 전체만 맞추고, 시행규칙은 조례와 같지 않다", () => {
    const program = prog({
      name: "교복", laws: ["고양시 교복 지원 조례(제3조) || 다른 법", "국민기초생활 보장법(제11조)"],
    });
    const exact = form({ id: "uniform", title: "동의서", role: "consent", lawTitle: "고양시 교복 지원 조례" });
    const rule = form({ id: "rule", title: "동의서", role: "consent", lawTitle: "고양시 교복 지원 조례 시행규칙" });
    const other = form({ id: "other", title: "동의서", role: "consent", lawTitle: "고양시 학생 복지 조례" });
    expect(ids(program, [rule, other, exact])).toEqual(["uniform"]);
    expect(findFormCandidates(program, [exact])[0].reason).toContain("법령명이 같습니다");
  });

  it("사업명 고유어가 여럿 맞으면 후보로 내고, 지원·사업·신청·서비스·고양시만으로는 내지 않는다", () => {
    const titled = form({ id: "care", title: "[별지 제1호서식] 한시적 양육비 지원 신청서", lawTitle: "" });
    const split = form({ id: "longevity", title: "장수축하금 지급 신청서", lawTitle: "" });
    const compound = form({ id: "uniform", title: "교복구입비 지원신청서", lawTitle: "" });
    expect(ids(prog({ name: "한시적 양육비 지원", laws: undefined }), [titled])).toEqual(["care"]);
    expect(findFormCandidates(prog({ name: "한시적 양육비 지원" }), [titled])[0].reason).toContain("한시적, 양육비");
    expect(ids(prog({ name: "장수 축하금 지급" }), [split])).toEqual(["longevity"]);
    expect(ids(prog({ name: "교복구입비 지원", aliases: ["교복 지원"] }), [compound])).toEqual(["uniform"]);

    const generic = form({ id: "generic", title: "생활복지서비스 신청서" });
    expect(ids(prog({ name: "고양시 지원 서비스 사업" }), [generic, titled])).toEqual([]);
    expect(ids(prog({ name: "지원 신청" }), [compound])).toEqual([]);
    expect(ids(prog({ name: "양육비 지원" }), [titled])).toEqual([]);
  });

  it("입력을 바꾸지 않고, 같은 서식은 처음 순서를 유지한 채 한 번만 낸다", () => {
    const program = prog({ name: "한시적 양육비 지원", laws: ["고양시 한시적 양육비 지원 조례"] });
    const forms = [
      form({ id: "z", title: "한시적 양육비 지원 신청서", lawTitle: "고양시 한시적 양육비 지원 조례" }),
      form({ id: "z", title: "한시적 양육비 지원 신청서", lawTitle: "고양시 한시적 양육비 지원 조례" }),
      form({ id: "a", title: "한시적 양육비 신청 위임장", role: "delegation", lawTitle: "고양시 한시적 양육비 지원 조례" }),
    ];
    const beforeP = structuredClone(program);
    const beforeF = structuredClone(forms);
    expect(ids(program, forms)).toEqual(["z", "a"]);
    expect(program).toEqual(beforeP);
    expect(forms).toEqual(beforeF);
  });
});
