ALTER TABLE "provider_credentials" ADD COLUMN "oauth_access_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "oauth_refresh_token_encrypted" text;--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "oauth_expires_at" timestamp with time zone;