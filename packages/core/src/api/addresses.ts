import type { FocusSpec, LernSaxSession } from "../session.js";

export interface AddressEntry {
  id: string;
  first_name?: string;
  last_name?: string;
  email?: string;
  phone?: string;
  organization?: string;
  notes?: string;
  [k: string]: unknown;
}

export class AddressesApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus(group?: string): FocusSpec {
    const login = group ? this.session.resolveGroup(group) : undefined;
    return login ? { object: "addresses", login } : { object: "addresses" };
  }
  async list(group?: string): Promise<AddressEntry[]> {
    const r = await this.session.call("get_entries", {}, this.focus(group));
    return (r.entries as AddressEntry[]) ?? [];
  }
  async create(group: string | undefined, entry: Omit<AddressEntry, "id">): Promise<AddressEntry> {
    const r = await this.session.call("add_entry", entry, this.focus(group));
    return r as AddressEntry;
  }
  async update(group: string | undefined, id: string, patch: Partial<Omit<AddressEntry, "id">>): Promise<AddressEntry> {
    const r = await this.session.call("set_entry", { id, ...patch }, this.focus(group));
    return r as AddressEntry;
  }
  async remove(group: string | undefined, id: string): Promise<void> {
    await this.session.call("delete_entry", { id }, this.focus(group));
  }
}
