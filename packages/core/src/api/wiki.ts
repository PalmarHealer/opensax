import type { FocusSpec, LernSaxSession } from "../session.js";

export interface WikiPage {
  id: string;
  title: string;
  content?: string;
  text?: string;
  modified?: number;
  created?: number;
  [k: string]: unknown;
}

export class WikiApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus(group: string): FocusSpec {
    const login = this.session.resolveGroup(group);
    if (!login) throw new Error(`Unknown group: ${group}`);
    return { object: "wiki", login };
  }
  async list(group: string): Promise<WikiPage[]> {
    const r = await this.session.call("get_entries", {}, this.focus(group));
    return (r.entries as WikiPage[]) ?? [];
  }
  async page(group: string, id: string): Promise<WikiPage> {
    const r = await this.session.call("get_page", { id }, this.focus(group));
    return r as WikiPage;
  }
  async create(group: string, entry: { title: string; text: string }): Promise<WikiPage> {
    const r = await this.session.call("add_entry", entry, this.focus(group));
    return r as WikiPage;
  }
  async update(group: string, id: string, patch: Partial<{ title: string; text: string }>): Promise<WikiPage> {
    const r = await this.session.call("set_entry", { id, ...patch }, this.focus(group));
    return r as WikiPage;
  }
  async remove(group: string, id: string): Promise<void> {
    await this.session.call("delete_entry", { id }, this.focus(group));
  }
}
