/**
 * Whether an account has been through the onboarding wizard.
 *
 * One small file per LernSax account (keyed by `user_id`, so it follows the
 * account across devices): the wizard shows once per account, not once per
 * browser. The record holds no settings — theme and navigation stay in the
 * browser — only when the wizard was finished or skipped.
 */
import { env } from "$env/dynamic/private";
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const STORE_DIR = env.LERNSAX_ONBOARDING_DIR
  ?? (process.env.NODE_ENV === "production" ? "/app/data/onboarding" : "./.session-store/onboarding");

export type OnboardingOutcome = "completed" | "skipped";

export interface OnboardingRecord {
  outcome: OnboardingOutcome;
  /** ms since epoch */
  at: number;
}

function pathFor(user_id: string): string {
  // user_id is a hex hash already; refuse anything else rather than build a path from it.
  if (!/^[a-f0-9]{8,64}$/.test(user_id)) throw new Error("invalid user_id");
  return join(STORE_DIR, `${user_id}.json`);
}

export function getOnboarding(user_id: string): OnboardingRecord | null {
  try {
    return JSON.parse(readFileSync(pathFor(user_id), "utf8")) as OnboardingRecord;
  } catch {
    return null;
  }
}

export function markOnboarding(user_id: string, outcome: OnboardingOutcome): OnboardingRecord {
  if (!existsSync(STORE_DIR)) mkdirSync(STORE_DIR, { recursive: true });
  const rec: OnboardingRecord = { outcome, at: Date.now() };
  writeFileSync(pathFor(user_id), JSON.stringify(rec), "utf8");
  return rec;
}

export function clearOnboarding(user_id: string): void {
  try { unlinkSync(pathFor(user_id)); } catch { /* nothing stored */ }
}
