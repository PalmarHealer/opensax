/**
 * Shape of a feedback report — shared by the wizard (which renders these
 * steps) and `/api/feedback` (which validates against the same definitions
 * and turns them into a readable report). Adding a field here is all it takes
 * to ask for it.
 */
import { NAV_TABS } from "$lib/nav";

export type FeedbackType = "bug" | "feature" | "feedback" | "question";

export const FEEDBACK_TYPES: Record<FeedbackType, { label: string; short: string; icon: string; desc: string }> = {
  bug:      { label: "Fehler melden",      short: "Fehler",   icon: "bug",         desc: "Etwas funktioniert nicht so, wie es sollte." },
  feature:  { label: "Idee / Wunsch",      short: "Wunsch",   icon: "bulb",        desc: "Eine neue Funktion oder eine Verbesserung." },
  feedback: { label: "Feedback / Hinweis", short: "Feedback", icon: "message-2",   desc: "Lob, Kritik oder etwas, das uns aufgefallen sein sollte." },
  question: { label: "Frage",              short: "Frage",    icon: "help-circle", desc: "Du kommst nicht weiter oder möchtest etwas wissen." },
};

export interface Choice { value: string; label: string }

export interface FieldDef {
  key: string;
  label: string;
  kind: "text" | "textarea" | "choice" | "area";
  required?: boolean;
  placeholder?: string;
  hint?: string;
  options?: Choice[];
}

export interface StepDef {
  id: string;
  title: string;
  intro?: string;
  fields: FieldDef[];
}

/** Bereiche der App — die Navigation plus das, was keinen eigenen Tab hat. */
export const AREAS: Choice[] = [
  ...NAV_TABS.map((t) => ({ value: t.id, label: t.label })),
  { value: "login", label: "Anmeldung" },
  { value: "api", label: "API / MCP / Verbindungen" },
  { value: "general", label: "Allgemein / überall" },
];

/** Bereich, in dem jemand gerade war, als er den Wizard geöffnet hat. */
export function areaForPath(pathname: string): string {
  if (pathname.startsWith("/api-docs")) return "api";
  const tab = NAV_TABS.find((t) => t.href !== "/" && (pathname === t.href || pathname.startsWith(t.href + "/")));
  return tab?.id ?? (pathname === "/" ? "home" : "general");
}

const TITLE = (placeholder: string, required = true): FieldDef => ({
  key: "title", label: "Kurz zusammengefasst", kind: "text", required, placeholder,
});
const AREA: FieldDef = { key: "area", label: "Bereich", kind: "area", required: true };

export const STEPS: Record<FeedbackType, StepDef[]> = {
  bug: [
    {
      id: "what",
      title: "Was ist passiert?",
      intro: "Beschreibe, was du gesehen hast — und was stattdessen hätte passieren sollen.",
      fields: [
        TITLE("z. B. „Anhang lässt sich nicht herunterladen“"),
        AREA,
        { key: "actual", label: "Was ist passiert?", kind: "textarea", required: true, placeholder: "Fehlermeldung, leere Seite, falsche Daten …" },
        { key: "expected", label: "Was hättest du erwartet?", kind: "textarea", placeholder: "Optional" },
      ],
    },
    {
      id: "repro",
      title: "Wie kommt es dazu?",
      intro: "Je genauer wir den Fehler nachstellen können, desto schneller ist er behoben.",
      fields: [
        { key: "steps", label: "Schritte bis zum Fehler", kind: "textarea", placeholder: "1. Mail öffnen\n2. Auf „Antworten“ klicken\n3. …" },
        {
          key: "frequency", label: "Wie oft passiert das?", kind: "choice", required: true,
          options: [
            { value: "always", label: "Jedes Mal" },
            { value: "sometimes", label: "Manchmal" },
            { value: "once", label: "Einmal" },
          ],
        },
        {
          key: "impact", label: "Wie sehr stört es?", kind: "choice", required: true,
          options: [
            { value: "blocker", label: "Ich komme nicht weiter" },
            { value: "annoying", label: "Nervt, aber geht" },
            { value: "minor", label: "Kleinigkeit" },
          ],
        },
      ],
    },
  ],
  feature: [
    {
      id: "wish",
      title: "Was wünschst du dir?",
      fields: [
        TITLE("z. B. „Mails nach Absender filtern“"),
        AREA,
        { key: "wish", label: "Was möchtest du tun können?", kind: "textarea", required: true },
      ],
    },
    {
      id: "why",
      title: "Wofür brauchst du das?",
      intro: "Das Problem dahinter hilft oft mehr als die Lösung — vielleicht gibt es einen einfacheren Weg.",
      fields: [
        { key: "why", label: "Welches Problem löst das? Wie machst du es heute?", kind: "textarea" },
        {
          key: "priority", label: "Wie wichtig ist dir das?", kind: "choice", required: true,
          options: [
            { value: "nice", label: "Wäre schön" },
            { value: "important", label: "Wichtig" },
            { value: "essential", label: "Brauche ich dringend" },
          ],
        },
      ],
    },
  ],
  feedback: [
    {
      id: "message",
      title: "Dein Feedback",
      fields: [
        {
          key: "mood", label: "Wie ist dein Eindruck?", kind: "choice", required: true,
          options: [
            { value: "positive", label: "Gut" },
            { value: "neutral", label: "Gemischt" },
            { value: "negative", label: "Schlecht" },
          ],
        },
        AREA,
        TITLE("Betreff (optional)", false),
        { key: "message", label: "Was möchtest du uns sagen?", kind: "textarea", required: true },
      ],
    },
  ],
  question: [
    {
      id: "question",
      title: "Deine Frage",
      intro: "Damit wir antworten können, brauchst du im Schritt „Kontakt“ einen Kontaktweg.",
      fields: [
        TITLE("Worum geht es?"),
        AREA,
        { key: "question", label: "Deine Frage", kind: "textarea", required: true },
        { key: "tried", label: "Was hast du schon versucht?", kind: "textarea", placeholder: "Optional" },
      ],
    },
  ],
};

export const LIMITS = { text: 200, textarea: 5000 };

export type ContactMethod = "none" | "lernsax" | "manual";

export const CONTACT_PATTERN = {
  email: /^[^\s@]+@[^\s@]+\.[^\s@]+$/,
  phone: /^\+?[\d\s()/-]{6,30}$/,
};

export function isValidManualContact(v: string): boolean {
  const s = v.trim();
  return CONTACT_PATTERN.email.test(s) || CONTACT_PATTERN.phone.test(s);
}

/** Label for a stored value — `choice` and `area` store keys, not text. */
export function displayValue(field: FieldDef, value: string): string {
  if (field.kind === "area") return AREAS.find((a) => a.value === value)?.label ?? value;
  if (field.kind === "choice") return field.options?.find((o) => o.value === value)?.label ?? value;
  return value;
}

/** What the server can add on request — previewed in the wizard before sending. */
export interface ServerContext {
  account: { name: string; login: string; email: string; schools: string[]; classes: string[] };
  config: {
    timetable: { configured: boolean; source_type: string | null; class_filter: boolean; teacher_filter: boolean };
    groups: { schools: number; classes: number };
    connections: { oauth: number; api_tokens: number };
  };
  /** Address used for "per LernSax-Mail" — always taken from the session. */
  lernsax_email: string;
}

export interface FeedbackPayload {
  type: FeedbackType;
  fields: Record<string, string>;
  include: { screenshot: boolean; logs: boolean; config: boolean; account: boolean };
  /** JPEG data URL, only when `include.screenshot`. */
  screenshot?: string;
  logs?: { t: number; level: string; msg: string }[];
  client_config?: Record<string, unknown>;
  contact: { method: ContactMethod; value?: string };
}
