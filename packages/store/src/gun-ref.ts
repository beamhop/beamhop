// A narrow, structural view of the Gun chain API — just the methods this
// project uses. We deliberately avoid Gun's own heavily-generic `IGunChain`
// types (4 type params, awkward to thread) and instead treat every chain as
// this simple shape. `createGun` casts the real Gun instance to it.

import Gun from "gun";

export interface GunRef {
  get(key: string): GunRef;
  put(data: unknown, cb?: (ack: { err?: string; ok?: number }) => void): GunRef;
  set(data: unknown, cb?: (ack: { err?: string; ok?: number }) => void): GunRef;
  map(): GunRef;
  on(cb: (data: unknown, key: string) => void): GunRef;
  once(cb: (data: unknown, key: string) => void): GunRef;
  off(): void;
}

export interface GunOptions {
  peers?: string[];
  web?: unknown;
  radisk?: boolean;
  file?: string;
  localStorage?: boolean;
  [key: string]: unknown;
}

/** Construct a Gun instance and view it through the narrow GunRef interface. */
export function createGun(options: GunOptions): GunRef {
  // Gun's call signature is permissive; cast through unknown to our view.
  return (Gun as unknown as (o: GunOptions) => unknown)(options) as GunRef;
}
