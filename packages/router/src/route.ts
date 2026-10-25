import { normalize, profileTokens, tokenize, type ProjectProfile } from "./profile.ts";

export interface RouterThresholds {
  readonly autoThreshold: number;
  readonly confirmThreshold: number;
  readonly directAccept: number;
  readonly directMargin: number;
  readonly autoStart: boolean;
}

export const DEFAULT_THRESHOLDS: RouterThresholds = {
  autoThreshold: 0.85,
  confirmThreshold: 0.5,
  directAccept: 0.8,
  directMargin: 0.25,
  autoStart: false,
};

export interface RouteCandidate {
  readonly profile: ProjectProfile;
  readonly score: number;
}

export interface RouteDecision {
  readonly mode: "auto" | "confirm" | "ask";
  readonly via: "mention" | "lexical";
  readonly confidence: number;
  readonly candidates: ReadonlyArray<RouteCandidate>;
}

const K1 = 1.5;
const B = 0.75;
const MAX_CANDIDATES = 5;

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function detectMention(
  prompt: string,
  profiles: ReadonlyArray<ProjectProfile>,
): ProjectProfile | undefined {
  const text = normalize(prompt);
  for (const profile of profiles) {
    const slug = escapeRegExp(normalize(profile.slug));
    if (new RegExp(`(^|\\s)@${slug}(?![a-z0-9-])`).test(text)) return profile;
  }
  for (const profile of profiles) {
    for (const name of [profile.slug, profile.name, ...profile.aliases]) {
      const escaped = escapeRegExp(normalize(name));
      if (escaped.length === 0) continue;
      const explicit = new RegExp(`(no projeto|in project|em)\\s+${escaped}(?![a-z0-9])\\s*[:,]?`);
      const prefix = new RegExp(`^\\s*${escaped}\\s*:`);
      if (explicit.test(text) || prefix.test(text)) return profile;
    }
  }
  return undefined;
}

export function scoreProfiles(
  prompt: string,
  profiles: ReadonlyArray<ProjectProfile>,
): ReadonlyArray<RouteCandidate> {
  const queryTokens = Array.from(new Set(tokenize(prompt)));
  const docs = profiles.map((profile) => profileTokens(profile));
  const average = docs.reduce((sum, doc) => sum + doc.length, 0) / Math.max(docs.length, 1);
  const documentFrequency = new Map<string, number>();
  for (const doc of docs) {
    for (const token of new Set(doc)) {
      documentFrequency.set(token, (documentFrequency.get(token) ?? 0) + 1);
    }
  }
  const idf = (token: string) => {
    const df = documentFrequency.get(token) ?? 0;
    return Math.log(1 + (profiles.length - df + 0.5) / (df + 0.5));
  };
  const known = queryTokens.filter((token) => documentFrequency.has(token));
  const ceiling = known.reduce((sum, token) => sum + idf(token) * (K1 + 1), 0);
  return profiles
    .map((profile, index) => {
      const doc = docs[index] ?? [];
      const lengthNorm = 1 - B + B * (doc.length / Math.max(average, 1));
      const raw = known.reduce((sum, token) => {
        const tf = doc.filter((candidate) => candidate === token).length;
        return tf === 0 ? sum : sum + (idf(token) * tf * (K1 + 1)) / (tf + K1 * lengthNorm);
      }, 0);
      return { profile, score: ceiling === 0 ? 0 : Math.min(1, raw / ceiling) };
    })
    .toSorted((left, right) => right.score - left.score)
    .slice(0, MAX_CANDIDATES);
}

export function route(
  prompt: string,
  profiles: ReadonlyArray<ProjectProfile>,
  thresholds: RouterThresholds = DEFAULT_THRESHOLDS,
): RouteDecision {
  const mentioned = detectMention(prompt, profiles);
  const ranked = scoreProfiles(prompt, profiles);
  const candidates = mentioned
    ? [
        { profile: mentioned, score: 1 },
        ...ranked.filter((candidate) => candidate.profile.id !== mentioned.id),
      ].slice(0, MAX_CANDIDATES)
    : ranked;
  const top = candidates[0]?.score ?? 0;
  const margin = top - (candidates[1]?.score ?? 0);
  const confidence = mentioned
    ? 1
    : margin >= thresholds.directMargin
      ? top
      : Math.min(top, thresholds.autoThreshold - 0.01);
  const mode =
    confidence >= thresholds.autoThreshold
      ? thresholds.autoStart
        ? "auto"
        : "confirm"
      : confidence >= thresholds.confirmThreshold
        ? "confirm"
        : "ask";
  return { mode, via: mentioned ? "mention" : "lexical", confidence, candidates };
}
