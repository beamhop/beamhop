/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RELAY_URL?: string;
  readonly VITE_PROVIDER_ID?: string;
  readonly VITE_MODEL_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
