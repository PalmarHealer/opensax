import type { FocusSpec, LernSaxSession } from "../session.js";

export interface Resource {
  id: string;
  name: string;
  description?: string;
  [k: string]: unknown;
}

export interface Booking {
  id: string;
  resource_id: string;
  start: number;
  end: number;
  title?: string;
  by?: { login: string; name_hr?: string };
  [k: string]: unknown;
}

export class ResourcesApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus(group: string): FocusSpec {
    const login = this.session.resolveGroup(group);
    if (!login) throw new Error(`Unknown group: ${group}`);
    return { object: "resource_management", login };
  }
  async list(group: string): Promise<Resource[]> {
    const r = await this.session.call("get_entries", {}, this.focus(group));
    return (r.entries as Resource[]) ?? [];
  }
  async bookings(group: string, params: { start?: number; end?: number; resource_id?: string } = {}): Promise<Booking[]> {
    const r = await this.session.call("get_bookings", params, this.focus(group));
    return (r.bookings as Booking[]) ?? [];
  }
  async book(group: string, params: { resource_id: string; start: number; end: number; title?: string }): Promise<Booking> {
    const r = await this.session.call("add_booking", params, this.focus(group));
    return r as Booking;
  }
  async cancel(group: string, id: string): Promise<void> {
    await this.session.call("delete_booking", { id }, this.focus(group));
  }
}
