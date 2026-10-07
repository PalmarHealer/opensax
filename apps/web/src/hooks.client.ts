import type { HandleClientError } from "@sveltejs/kit";
import { installConsoleBuffer, recordError } from "$lib/consoleBuffer";

// Runs once at app start, before any page code — see consoleBuffer.ts.
installConsoleBuffer();

export const handleError: HandleClientError = ({ error, message, status }) => {
  recordError(error, `[${status}] ${message}`);
};
