import type { FocusSpec, LernSaxSession } from "../session.js";

export interface ForumEntry {
  id: string;
  title: string;
  text?: string;
  author?: { login: string; name_hr?: string };
  parent_id?: string;
  created?: number;
  modified?: number;
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
  async post(group: string, entry: { title: string; text: string; parent_id?: string }): Promise<ForumEntry> {
    const r = await this.session.call("add_entry", entry, this.focus(group));
    return r as ForumEntry;
  }
  async remove(group: string, id: string): Promise<void> {
    await this.session.call("delete_entry", { id }, this.focus(group));
  }
}
