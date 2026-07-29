ALTER TABLE "provider_credentials" ADD COLUMN "cached_models" text[];--> statement-breakpoint
ALTER TABLE "provider_credentials" ADD COLUMN "models_cached_at" timestamp with time zone;