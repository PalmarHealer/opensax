import type { FocusSpec, LernSaxSession } from "../session.js";

export interface NoteEntry {
  id: string;
  title?: string;
  text: string;
  color?: string;
  created?: number;
  modified?: number;
  [k: string]: unknown;
}

export class NotesApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus(group?: string): FocusSpec {
    const login = group ? this.session.resolveGroup(group) : undefined;
    return login ? { object: "notes", login } : { object: "notes" };
  }

  async list(group?: string): Promise<NoteEntry[]> {
    const r = await this.session.call("get_entries", {}, this.focus(group));
    return (r.entries as NoteEntry[]) ?? [];
  }
  async create(group: string | undefined, entry: { title?: string; text: string; color?: string }): Promise<NoteEntry> {
    const r = await this.session.call("add_entry", entry, this.focus(group));
    return r as NoteEntry;
  }
  async update(group: string | undefined, id: string, patch: Partial<{ title: string; text: string; color: string }>): Promise<NoteEntry> {
    const r = await this.session.call("set_entry", { id, ...patch }, this.focus(group));
    return r as NoteEntry;
  }
  async remove(group: string | undefined, id: string): Promise<void> {
    await this.session.call("delete_entry", { id }, this.focus(group));
  }
}
