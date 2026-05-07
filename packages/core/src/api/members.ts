import type { FocusSpec, LernSaxSession } from "../session.js";

export interface RoomMember {
  login: string;
  name_hr?: string;
  type?: string;
  rights?: string[];
  online?: boolean;
  [k: string]: unknown;
}

export class MembersApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus(group: string): FocusSpec {
    const login = this.session.resolveGroup(group);
    if (!login) throw new Error(`Unknown group: ${group}`);
    return { object: "members", login };
  }

  async users(group: string): Promise<RoomMember[]> {
    const r = await this.session.call("get_users", {}, this.focus(group));
    return (r.users as RoomMember[]) ?? [];
  }
  async broadcast(group: string, text: string): Promise<void> {
    await this.session.call("send_quick_message", { text }, this.focus(group));
  }
}
