/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_SUPABASE_URL: string;
  readonly VITE_SUPABASE_ANON_KEY: string;
  // add any others you use:
  readonly VITE_HOME_VIDEO_URL?: string;
  readonly VITE_EXPOSE_SB?: "1" | "0";
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}