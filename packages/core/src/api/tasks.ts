import type { FocusSpec, LernSaxSession } from "../session.js";

export interface TaskEntry {
  id: string;
  title: string;
  description?: string;
  start_date?: number;
  due_date?: number;
  completed?: boolean;
  created?: number;
  modified?: number;
  created_by?: { login: string; name_hr?: string };
  [k: string]: unknown;
}

export class TasksApi {
  constructor(private readonly session: LernSaxSession) {}

  private focus(group?: string): FocusSpec {
    const login = group ? this.session.resolveGroup(group) : undefined;
    return login ? { object: "tasks", login } : { object: "tasks" };
  }

  async list(group?: string): Promise<TaskEntry[]> {
    const r = await this.session.call("get_entries", {}, this.focus(group));
    return (r.entries as TaskEntry[]) ?? [];
  }

  async create(
    group: string | undefined,
    entry: { title: string; description?: string; start_date?: number; due_date?: number; completed?: boolean },
  ): Promise<TaskEntry> {
    const r = await this.session.call("add_entry", entry, this.focus(group));
    return r as TaskEntry;
  }

  async update(
    group: string | undefined,
    id: string,
    patch: Partial<{ title: string; description: string; start_date: number; due_date: number; completed: boolean }>,
  ): Promise<TaskEntry> {
    const r = await this.session.call("set_entry", { id, ...patch }, this.focus(group));
    return r as TaskEntry;
  }

  async remove(group: string | undefined, id: string): Promise<void> {
    await this.session.call("delete_entry", { id }, this.focus(group));
  }
}
