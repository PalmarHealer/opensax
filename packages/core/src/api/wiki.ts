import type { FocusSpec, LernSaxSession } from "../session.js";

export interface WikiPage {
  id: string;
  title: string;
  content?: string;
  modified?: number;
  [k: string]: unknown;
}

export class WikiApi {
  constructor(private readonly session: LernSaxSession) {}
  private focus(group: string): FocusSpec {
    const login = this.session.resolveGroup(group);
    if (!login) throw new Error(`Unknown group: ${group}`);
    return { object: "wiki", login };
  }
  async page(group: string, id: string): Promise<WikiPage> {
    const r = await this.session.call("get_page", { id }, this.focus(group));
    return r as WikiPage;
  }
}
