CREATE TABLE IF NOT EXISTS "model_roles" (
	"role" text PRIMARY KEY NOT NULL,
	"credential_id" uuid,
	"model" text NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "model_roles" ADD CONSTRAINT "model_roles_credential_id_provider_credentials_id_fk" FOREIGN KEY ("credential_id") REFERENCES "public"."provider_credentials"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
