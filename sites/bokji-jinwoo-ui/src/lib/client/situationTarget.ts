import type { FindMode } from "./mode";
import { parseSituation } from "./parse";

const PARENT = "(?:시어머님|시어머니|시아버님|시아버지|장인어른|장모님?|어머님|어머니|아버님|아버지|부모(?:님)?|조부모|할머니|할아버지|엄마|아빠|엄니|어무이|모친|부친|노모|노부|할매|할배)";
const PREFIX = "(?:(?:우리|저희|친정|울|제|내)\\s*)?";
const parentPattern = () => new RegExp(`(?<![가-힣])${PREFIX}${PARENT}(?!급여|교육|교실)`, "g");
const SELF_SUBJECT = /(?:^|\s)(?:저는|제가|나는|내가|난|본인은|본인이)(?=\s|\d|$)/;
const SELF_REQUEST = /(?:^|\s)(?:제|내|저의|나의|본인의?|저|나)(?:가|는|에게|한테|를)?\s*(?:받을|받는|받고\s*싶|위한|복지|지원|혜택|월세|장학금|취업|일자리|도움)/;
const REQUEST_AFTER = /^(?:의|께|에게|한테|을|를|이|가|은|는)?\s*(?:받을|받는\s*(?:복지|지원|혜택)|필요한|위한|위해|대신|복지|지원|혜택|돌봄\s*지원|요양\s*지원|도움|주거\s*지원|월세\s*지원|일자리\s*(?:지원|찾))/;
const EXCLUDED_AFTER = /^(?:의|은|는|이|가)?\s*(?:(?:복지|지원|혜택|것|꺼|거)\s*)?(?:말고|아니라|아니고|제외|빼고)/;
const BACKGROUND_AFTER = /^(?:(?:과|와|랑|이랑|하고)\s*(?:(?:함께|같이|따로|떨어져)\s*)?(?:살|사|지내|거주)|(?:을|를)?\s*(?:모시고|모셔)|(?:께|에게|한테|로부터)\s*(?:용돈|생활비|지원|도움)|(?:의)?\s*(?:소득|재산|집)|(?:이|가|은|는)?\s*(?:안\s*계|없|돌아가))/;
const PARENT_DESCRIPTION = /\d+\s*(?:세|살|대|년생)|사시|계시|계셔|혼자\s*살|혼자\s*사|거주|일흔|예순|여든|아흔|칠순|팔순|치매|장애|은퇴|수급|연금|전세|월세/;

function references(text: string) {
  // '아이 엄마', '한부모', '학부모' 같은 본인 역할·제도명은 부모님 대상 표현이 아니다.
  const cleaned = text
    .replace(/(?:(?:한|두|세|\d+)\s*)?(?:아이|애|아기|자녀|아들|딸)(?:들)?\s*(?:의\s*)?(?:엄마|아빠)/g, " ")
    .replace(/(?<!(?:우리|저희|제|내|친정|울)\s?)(?:엄마|아빠)(?:예요|에요|이에요|입니다|인데요?|이고|고요?|로서|랍니다)(?=\s|[,.!?]|$)/g, " ")
    .replace(/(?:아이|애|자녀|아들|딸)[^,.!?]{0,15}(?:키우는|기르는|둔)\s*(?:엄마|아빠)/g, " ");
  return [...cleaned.matchAll(parentPattern())].map(match => ({
    word: match[0], after: cleaned.slice(match.index! + match[0].length),
  }));
}

/** 호칭보다 명시적 요청을 우선하고, 둘의 상황이 섞이거나 호칭만 있으면 확인한다. */
export function situationTarget(raw: string, hint: FindMode = "self"): FindMode | null {
  const text = raw.normalize("NFC").replace(/\s+/g, " ").trim();
  const refs = references(text);
  const active = refs.filter(ref => !EXCLUDED_AFTER.test(ref.after));
  const selfRequest = SELF_REQUEST.test(text) && !/(?:제|내|저의|나의)\s*(?:복지|지원|혜택|것|꺼|거)\s*(?:말고|아니라)/.test(text);
  const parentRequest = active.some(ref => REQUEST_AFTER.test(ref.after));
  if (selfRequest && parentRequest) return null;
  if (selfRequest) return "self";
  if (parentRequest) return "parent";
  const legacy = parseSituation(text, null, undefined, { hint });
  if (!refs.length) return legacy.mode === "self" ? "self" : hint;
  if (legacy.mode === "self") return "self";
  if (!active.length || active.every(ref => BACKGROUND_AFTER.test(ref.after))) return "self";
  // '제가 부모님을 대신 찾아요'의 작성자와 '저는 25세, 어머니는 70세'의 두 대상을 구분한다.
  if (SELF_SUBJECT.test(text)) return null;
  if (PARENT_DESCRIPTION.test(text)) return "parent";
  return hint === "parent" ? "parent" : null;
}

/** 다른 사람의 명시적 문장은 제외한다. 귀속을 분리할 수 없는 문장은 미확인으로 남긴다. */
export function textForTarget(raw: string, target: FindMode): string {
  const parentSubject = `${PREFIX}(?:\\d{1,4}\\s*(?:세|살|년생)\\s*)?${PARENT}(?:께서|은|는|이|가|의|도)?`;
  const split = new RegExp(`[;!?\\n]+|(?<!\\d)[,.]|[,.](?!\\d)|(?<!\\d\\s*(?:세|살|년생))\\s+(?=(?:저는|제가|나는|내가|본인은|본인이)\\s*|(?:제|내|저의|나의)\\s*(?:복지|지원|혜택|월세|장학금|취업|일자리)|${parentSubject})`, "g");
  const pieces = raw.normalize("NFC").split(split).map(part => part.trim()).filter(Boolean);
  let owner: FindMode | null = null;
  return pieces.flatMap(part => {
    const refs = references(part);
    const parentRequest = refs.some(ref => REQUEST_AFTER.test(ref.after) && !EXCLUDED_AFTER.test(ref.after));
    const background = refs.length > 0 && refs.every(ref => BACKGROUND_AFTER.test(ref.after));
    const self = SELF_SUBJECT.test(part) || SELF_REQUEST.test(part);
    if (refs.some(ref => EXCLUDED_AFTER.test(ref.after))) return [];
    if (parentRequest) owner = "parent";
    else if (background && !refs.some(ref => /^(?:의)?\s*(?:소득|재산|집)/.test(ref.after))) owner = "self";
    else if (refs.length && self) return []; // 한 문장 안의 두 사람 수치를 합치지 않는다.
    else if (refs.length) owner = "parent";
    else if (self) owner = "self";
    if (owner && owner !== target) return [];
    // '75세 부모님과 살아요'에서 75세를 내 나이로 가져오지 않는다.
    const scoped = target === "self" && background
      ? part.replace(new RegExp(`\\d{1,4}\\s*(?:세|살|년생)\\s*(?=${PREFIX}${PARENT})`, "g"), "")
      : part;
    return [scoped];
  }).join(". ");
}
