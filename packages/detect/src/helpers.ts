import type { HttpSnapshot, Observations } from "./types.js";

export function pathOf(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

/** Matches responses whose path ends with the given suffix (use "/bare/" or "scramjet.js"). */
export function pathEndsWith(suffix: string) {
  return (r: HttpSnapshot): boolean => pathOf(r.url).endsWith(suffix);
}

export function findResponse(obs: Observations, pred: (r: HttpSnapshot) => boolean): HttpSnapshot | undefined {
  return obs.responses.find(pred);
}

/** Which of the given tokens occur literally in the body. Tokens are source-derived and exact. */
export function tokensPresent(body: string, tokens: readonly string[]): string[] {
  return tokens.filter((t) => body.includes(t));
}
