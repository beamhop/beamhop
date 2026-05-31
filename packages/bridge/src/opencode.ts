// The narrow slice of the OpenCode SDK client the bridge depends on. Defining
// it as an interface (rather than importing the concrete OpencodeClient type)
// lets tests inject a fake client and a scripted event stream, and isolates us
// from SDK surface churn. The real client structurally satisfies this.

import type { Event, Message, Part, Provider, Session } from "@opencode-ai/sdk";

export type { Event, Message, Part, Provider, Session };

/** Result of an SDK call: `{ data, ... }` or throws on error. */
export interface SdkResult<T> {
  data?: T;
  error?: unknown;
}

export interface ProvidersResult {
  providers: Provider[];
  /** Map of providerID -> default modelID. */
  default: Record<string, string>;
}

export interface OpencodeLike {
  session: {
    list(): Promise<SdkResult<Session[]>>;
    create(opts: { body?: { title?: string; parentID?: string } }): Promise<SdkResult<Session>>;
    delete(opts: { path: { id: string } }): Promise<SdkResult<unknown>>;
    abort(opts: { path: { id: string } }): Promise<SdkResult<boolean>>;
    messages(opts: {
      path: { id: string };
    }): Promise<SdkResult<Array<{ info: Message; parts: Part[] }>>>;
    prompt(opts: {
      path: { id: string };
      body: {
        model?: { providerID: string; modelID: string };
        agent?: string;
        parts: Array<{ type: "text"; text: string }>;
      };
    }): Promise<SdkResult<unknown>>;
  };
  /** Respond to a tool-permission request (top-level client method, not session.*). */
  postSessionIdPermissionsPermissionId(opts: {
    path: { id: string; permissionID: string };
    body: { response: "once" | "always" | "reject" };
  }): Promise<SdkResult<unknown>>;
  event: {
    subscribe(): Promise<{ stream: AsyncIterable<Event> }>;
  };
  config: {
    providers(): Promise<SdkResult<ProvidersResult>>;
  };
}
