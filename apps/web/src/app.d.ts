import type { LernSaxClient } from "@lernsax/core";

declare global {
  namespace App {
    interface Locals {
      sessionId: string | null;
      client: LernSaxClient | null;
    }
  }
}

export {};
