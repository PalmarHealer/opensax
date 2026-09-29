/**
 * LernSax-Forensymbole (Wert = `icon` am Beitrag), Reihenfolge wie im
 * LernSax-Formular. Bewusst nicht aus `@lernsax/core` importiert: das Modul
 * läuft im Browser, und der Core zieht Node-Abhängigkeiten (undici) mit.
 */
export const FORUM_ICON_CHOICES = [
  { id: 0, label: "Info", icon: "info-circle", color: "text-sky-400" },
  { id: 2, label: "Frage", icon: "help-circle", color: "text-violet-400" },
  { id: 4, label: "Pro", icon: "thumb-up", color: "text-emerald-400" },
  { id: 1, label: "Humor", icon: "mood-smile", color: "text-amber-400" },
  { id: 3, label: "Antwort", icon: "message-report", color: "text-indigo-400" },
  { id: 5, label: "Kontra", icon: "thumb-down", color: "text-rose-400" },
] as const;

export function forumIcon(id: number | undefined) {
  return FORUM_ICON_CHOICES.find((i) => i.id === (id ?? 0)) ?? FORUM_ICON_CHOICES[0];
}
