CREATE TYPE "user_role" AS ENUM('admin', 'member', 'viewer');--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" "user_role" DEFAULT 'member'::"user_role" NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_key" ON "users" ("email");--> statement-breakpoint
CREATE INDEX "users_created_at_idx" ON "users" ("created_at");