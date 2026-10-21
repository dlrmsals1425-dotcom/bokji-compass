declare namespace Cloudflare {
  interface Env {
    OPENAI_API_KEY?: string;
    ASSETS?: Fetcher;
    DB?: D1Database;
    BUCKET?: R2Bucket;
  }
}
