/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_GLITCHTIP_DSN: string;
  readonly VITE_GLITCHTIP_ENVIRONMENT: string;
  readonly VITE_POSTHOG_KEY?: string;
  readonly VITE_POSTHOG_HOST?: string;
  readonly VITE_FLUXER_INSTANCE_API?: string;
  readonly VITE_FLUXER_INSTANCE_WEB?: string;
  readonly VITE_FLUXER_INSTANCE_MEDIA?: string;
  readonly VITE_FLUXER_CLIENT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

declare module '*.css' {
  const content: string;
  export default content;
}
