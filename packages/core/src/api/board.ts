import type { FocusObject, FocusSpec, LernSaxSession } from "../session.js";

export type BoardKind = "general" | "teacher" | "pupil";

export interface BoardUserStamp {
  date: number;
  user?: { login: string; name_hr?: string; alias?: string; type?: number };
}

export interface BoardEntry {
  id: string;
  title: string;
  text: string;
  /** numeric color id from LernSax (0..7) */
  color?: number;
  delete_date?: number;
  created?: BoardUserStamp;
  modified?: BoardUserStamp;
  [k: string]: unknown;
}

const OBJ: Record<BoardKind, FocusObject> = {
  general: "board",
  teacher: "board_teacher",
  pupil: "board_pupil",
};

export class BoardApi {
  constructor(private readonly session: LernSaxSession) {}

  private focus(kind: BoardKind, group: string): FocusSpec {
    const login = this.session.resolveGroup(group);
    if (!login) throw new Error(`Unknown group: ${group}`);
    return { object: OBJ[kind], login };
  }

  async list(group: string, kind: BoardKind = "general"): Promise<BoardEntry[]> {
    const r = await this.session.call("get_entries", {}, this.focus(kind, group));
    return (r.entries as BoardEntry[]) ?? [];
  }

  async post(
    group: string,
    entry: { title: string; text: string; color?: number; delete_date?: number },
    kind: BoardKind = "general",
  ): Promise<BoardEntry> {
    const r = await this.session.call("add_entry", entry, this.focus(kind, group));
    return r as BoardEntry;
  }

  async update(
    group: string,
    id: string,
    patch: Partial<{ title: string; text: string; color: number; delete_date: number }>,
    kind: BoardKind = "general",
  ): Promise<BoardEntry> {
    const r = await this.session.call("set_entry", { id, ...patch }, this.focus(kind, group));
    return r as BoardEntry;
  }

  async remove(group: string, id: string, kind: BoardKind = "general"): Promise<void> {
    await this.session.call("delete_entry", { id }, this.focus(kind, group));
  }
}
