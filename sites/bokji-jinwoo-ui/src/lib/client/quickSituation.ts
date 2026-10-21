import type { RegionIndex } from "../data/types";
import { ageRange } from "../engine/profile";
import type { FindMode } from "./mode";
import { parseSituation, parsedExtras } from "./parse";
import { EMPTY_EXTRAS, type Extras, type Situation } from "./v2";
import { situationTarget, textForTarget } from "./situationTarget";

// Only keep the last utterance in this tab's memory, for correction and crisis guidance.
let lastText = "";
export const readQuickText = () => lastText;
export const rememberQuickText = (text: string) => { lastText = text; };

/** Start with this utterance alone: never silently mix another person's saved answers. */
export function quickSituation(text: string, regions: RegionIndex | null, hint: FindMode = "self", chosen?: FindMode): Situation {
  const target = chosen ?? situationTarget(text, hint);
  if (!target) throw new Error("target_required");
  const parsed = parseSituation(textForTarget(text, target), regions, undefined, { hint, target });
  const profile = { ...parsed.profile };
  const x: Extras = { ...EMPTY_EXTRAS, ...parsedExtras(parsed), benefits: {}, traits: {}, facts: {} };
  profile.benefits?.forEach((key) => { x.benefits[key] = true; });
  parsed.benefitsNo?.forEach((key) => { x.benefits[key] = false; });
  profile.traits?.forEach((key) => { x.traits[key] = true; });
  parsed.traitsNo?.forEach((key) => { x.traits[key] = false; });
  // The old confirmation form asked which household interpretation was intended.
  // With immediate results, leave that ambiguity open for optional follow-up.
  if (parsed.householdAlt) profile.householdSize = "unknown";
  if (parsed.ageAssumed) {
    profile.age = "unknown";
    x.ageSpan = null;
  } else if (parsed.ageRange && profile.age !== "unknown") {
    const [lo, hi] = ageRange(profile.age);
    if (parsed.ageRange[0] < lo || parsed.ageRange[1] > hi) {
      profile.age = "unknown";
      x.ageSpan = parsed.ageRange;
    }
  }
  if (parsed.otherAge) {
    const [lo, hi] = ageRange(parsed.otherAge.band);
    if (parsed.otherAge.range[0] < lo || parsed.otherAge.range[1] > hi) x.otherAge = null;
  }
  return { profile, x, mode: target };
}
