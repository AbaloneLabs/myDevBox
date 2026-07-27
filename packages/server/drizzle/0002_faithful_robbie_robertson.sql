CREATE TABLE IF NOT EXISTS "sync_needed" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"flagged_at" timestamp DEFAULT now() NOT NULL,
	"reason" text
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wiki_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"op" text NOT NULL,
	"summary" text NOT NULL,
	"meta" jsonb DEFAULT '{}'::jsonb,
	"created_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wiki_pages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"project_id" uuid,
	"path" text NOT NULL,
	"title" text NOT NULL,
	"type" text NOT NULL,
	"content" text DEFAULT '' NOT NULL,
	"frontmatter" jsonb DEFAULT '{}'::jsonb,
	"tags" text[] DEFAULT '{}',
	"status" text DEFAULT 'active',
	"sha" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "wiki_sync_state" (
	"project_id" uuid PRIMARY KEY NOT NULL,
	"last_commit_sha" text,
	"updated_at" timestamp DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "sync_needed" ADD CONSTRAINT "sync_needed_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wiki_log" ADD CONSTRAINT "wiki_log_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wiki_pages" ADD CONSTRAINT "wiki_pages_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "wiki_sync_state" ADD CONSTRAINT "wiki_sync_state_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
-- Full-text search vector (pg native tsvector) + indexes (수동 추가)
ALTER TABLE "wiki_pages" ADD COLUMN "search_vector" tsvector
  GENERATED ALWAYS AS (to_tsvector('english', coalesce("title",'') || ' ' || coalesce("content",''))) STORED;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wiki_pages_search_idx" ON "wiki_pages" USING GIN("search_vector");
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wiki_pages_project_path_uniq" ON "wiki_pages" ("project_id", "path") WHERE "project_id" IS NOT NULL;
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "wiki_pages_master_path_uniq" ON "wiki_pages" ("path") WHERE "project_id" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wiki_log_project_created_idx" ON "wiki_log" ("project_id", "created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "wiki_log_master_created_idx" ON "wiki_log" ("created_at" DESC) WHERE "project_id" IS NULL;
