import type { LernSaxSession } from "../session.js";

export interface Profile {
  fullname?: string;
  firstname?: string;
  lastname?: string;
  title?: string;
  /** "0" = group only, "1" = school, "2" = everyone */
  visible?: string;
  // Contact
  phone?: string;
  phone_business?: string;
  phone_mobile?: string;
  fax?: string;
  // Address
  street?: string;
  zip?: string;
  city?: string;
  country?: string;
  // Work
  homepage?: string;
  company?: string;
  department?: string;
  position?: string;
  // Personal
  birthday?: string;
  comment?: string;
  skype?: string;
  icq?: string;
  msn?: string;
  // Show flags ("0"/"1")
  show_phone?: string;
  show_email?: string;
  show_address?: string;
  show_company?: string;
  [k: string]: unknown;
}

export class ProfileApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus() { return { object: "profile" } as const; }

  async get(login?: string): Promise<Profile> {
    const r = await this.session.call("get_profile", login ? { login } : {}, this.focus());
    return (r.profile as Profile) ?? (r as Profile);
  }
  async update(patch: Partial<Profile>): Promise<void> {
    await this.session.call("set_profile", patch, this.focus());
  }
}
