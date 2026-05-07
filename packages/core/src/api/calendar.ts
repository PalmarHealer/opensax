import type { FocusSpec, LernSaxSession } from "../session.js";

export interface CalendarEntry {
  id: string;
  title: string;
  description?: string;
  start_date: number;
  end_date: number;
  start_date_iso?: string;
  end_date_iso?: string;
  is_all_day?: 0 | 1;
  is_locking?: 0 | 1;
  is_global?: 0 | 1;
  location?: string;
  rrule?: string;
  modified?: { date: number; user?: { login: string; name_hr?: string } };
  created?: { date: number; user?: { login: string; name_hr?: string } };
  [k: string]: unknown;
}

export class CalendarApi {
  constructor(private readonly session: LernSaxSession) {}

  private focus(group?: string): FocusSpec {
    const login = group ? this.session.resolveGroup(group) : undefined;
    return login ? { object: "calendar", login } : { object: "calendar" };
  }

  /** All entries for the focus (no server-side date filter — caller filters by `start_date`). */
  async list(params: { group?: string } = {}): Promise<CalendarEntry[]> {
    const r = await this.session.call("get_entries", {}, this.focus(params.group));
    return (r.entries as CalendarEntry[]) ?? [];
  }

  /** Holidays / superior-calendar entries (e.g. Ferien, gesetzliche Feiertage). */
  async holidays(): Promise<CalendarEntry[]> {
    const r = await this.session.call("get_superiors", {}, { object: "calendar" });
    return (r.entries as CalendarEntry[]) ?? [];
  }

  async create(
    group: string | undefined,
    entry: { title: string; start_date: number; end_date: number; description?: string; location?: string; is_all_day?: 0 | 1; rrule?: string },
  ): Promise<CalendarEntry> {
    const r = await this.session.call("add_entry", entry, this.focus(group));
    return (r.entry as CalendarEntry) ?? (r as CalendarEntry);
  }

  async update(
    group: string | undefined,
    id: string,
    patch: Partial<{ title: string; start_date: number; end_date: number; description: string; location: string; is_all_day: 0 | 1; rrule: string }>,
  ): Promise<CalendarEntry> {
    const r = await this.session.call("set_entry", { id, ...patch }, this.focus(group));
    return (r.entry as CalendarEntry) ?? (r as CalendarEntry);
  }

  async remove(group: string | undefined, id: string): Promise<void> {
    await this.session.call("delete_entry", { id }, this.focus(group));
  }
}
