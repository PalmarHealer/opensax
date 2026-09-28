import type { FocusSpec, LernSaxSession } from "../session.js";

/** Author/timestamp metadata as LernSax returns it on `get_entries`/`get_entry`. */
export type ForumStamp = number | { date?: number; user?: { login?: string; name_hr?: string } };

export interface ForumEntry {
  id: string;
  title: string;
  text?: string;
  author?: { login: string; name_hr?: string };
  parent_id?: string;
  created?: ForumStamp;
  modified?: ForumStamp;
  reply_count?: number;
  [k: string]: unknown;
}

export class ForumApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus(group: string): FocusSpec {
    const login = this.session.resolveGroup(group);
    if (!login) throw new Error(`Unknown group: ${group}`);
    return { object: "forum", login };
  }
  async list(group: string, parent_id?: string): Promise<ForumEntry[]> {
    const r = await this.session.call("get_entries", parent_id ? { parent_id } : {}, this.focus(group));
    return (r.entries as ForumEntry[]) ?? [];
  }
  async get(group: string, id: string): Promise<ForumEntry> {
    const r = await this.session.call("get_entry", { id }, this.focus(group));
    return ((r.entry as ForumEntry) ?? (r as ForumEntry));
  }
  /**
   * `parent_id` und `icon` sind laut API-Doku beide Pflicht — auch für ein neues
   * Thema, das per Definition keinen Elternbeitrag hat. Fehlen sie, antwortet
   * der Server mit `Parameter "parent_id" required` und, sobald das behoben ist,
   * mit derselben Meldung für `icon`. "0" steht für die Wurzel, Icon 0 für das
   * Standardsymbol (die Doku lässt 0–5 zu).
   */
  async post(
    group: string,
    entry: { title: string; text: string; parent_id?: string; icon?: number },
  ): Promise<ForumEntry> {
    const r = await this.session.call(
      "add_entry",
      {
        title: entry.title,
        text: entry.text,
        parent_id: entry.parent_id ?? "0",
        icon: entry.icon ?? 0,
      },
      this.focus(group),
    );
    return r as ForumEntry;
  }
  async remove(group: string, id: string): Promise<void> {
    await this.session.call("delete_entry", { id }, this.focus(group));
  }
}
