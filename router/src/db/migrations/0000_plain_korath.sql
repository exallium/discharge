CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"action" varchar(100) NOT NULL,
	"entity_type" varchar(50) NOT NULL,
	"entity_id" varchar(255),
	"actor" varchar(255),
	"changes" jsonb,
	"ip_address" "inet",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversation_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"role" varchar(20) NOT NULL,
	"content" text NOT NULL,
	"source_type" varchar(50),
	"source_id" varchar(255),
	"source_author" varchar(255),
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "conversations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trigger_type" varchar(100) NOT NULL,
	"external_id" varchar(500) NOT NULL,
	"project_id" varchar(255) NOT NULL,
	"state" varchar(20) DEFAULT 'idle' NOT NULL,
	"current_job_id" varchar(255),
	"route_mode" varchar(20) DEFAULT 'plan_review' NOT NULL,
	"status" varchar(20) DEFAULT 'pending' NOT NULL,
	"iteration" integer DEFAULT 0 NOT NULL,
	"plan_ref" varchar(500),
	"plan_version" integer DEFAULT 1,
	"confidence" jsonb,
	"trigger_event" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_activity_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "job_history" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"job_id" varchar(255) NOT NULL,
	"project_id" varchar(255) NOT NULL,
	"trigger_type" varchar(100) NOT NULL,
	"trigger_id" varchar(255) NOT NULL,
	"status" varchar(50) NOT NULL,
	"fixed" boolean,
	"reason" text,
	"pr_url" text,
	"analysis" jsonb,
	"queued_at" timestamp with time zone NOT NULL,
	"started_at" timestamp with time zone,
	"completed_at" timestamp with time zone,
	"duration_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pending_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"conversation_id" uuid NOT NULL,
	"event_type" varchar(50) NOT NULL,
	"event_payload" jsonb NOT NULL,
	"queued_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "projects" (
	"id" varchar(255) PRIMARY KEY NOT NULL,
	"repo" text NOT NULL,
	"repo_full_name" varchar(255) NOT NULL,
	"branch" varchar(255) DEFAULT 'main' NOT NULL,
	"vcs" jsonb NOT NULL,
	"runner" jsonb,
	"triggers" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"constraints" jsonb,
	"conversation" jsonb,
	"enabled" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "projects_repo_full_name_unique" UNIQUE("repo_full_name")
);
--> statement-breakpoint
CREATE TABLE "settings" (
	"key" varchar(255) PRIMARY KEY NOT NULL,
	"value" text NOT NULL,
	"encrypted" boolean DEFAULT false NOT NULL,
	"description" text,
	"category" varchar(100) DEFAULT 'general',
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "conversation_messages" ADD CONSTRAINT "conversation_messages_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "job_history" ADD CONSTRAINT "job_history_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "public"."projects"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pending_events" ADD CONSTRAINT "pending_events_conversation_id_conversations_id_fk" FOREIGN KEY ("conversation_id") REFERENCES "public"."conversations"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_audit_log_entity" ON "audit_log" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "idx_audit_log_created_at" ON "audit_log" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_audit_log_action" ON "audit_log" USING btree ("action");--> statement-breakpoint
CREATE INDEX "idx_messages_conversation" ON "conversation_messages" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_messages_created_at" ON "conversation_messages" USING btree ("created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "idx_conversations_target" ON "conversations" USING btree ("trigger_type","external_id");--> statement-breakpoint
CREATE INDEX "idx_conversations_state" ON "conversations" USING btree ("state");--> statement-breakpoint
CREATE INDEX "idx_conversations_status" ON "conversations" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_conversations_project" ON "conversations" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_job_history_project_id" ON "job_history" USING btree ("project_id");--> statement-breakpoint
CREATE INDEX "idx_job_history_status" ON "job_history" USING btree ("status");--> statement-breakpoint
CREATE INDEX "idx_job_history_created_at" ON "job_history" USING btree ("created_at");--> statement-breakpoint
CREATE INDEX "idx_job_history_trigger" ON "job_history" USING btree ("trigger_type","trigger_id");--> statement-breakpoint
CREATE INDEX "idx_pending_events_conversation" ON "pending_events" USING btree ("conversation_id");--> statement-breakpoint
CREATE INDEX "idx_pending_events_unprocessed" ON "pending_events" USING btree ("conversation_id","processed_at");--> statement-breakpoint
CREATE INDEX "idx_projects_enabled" ON "projects" USING btree ("enabled");--> statement-breakpoint
CREATE INDEX "idx_settings_category" ON "settings" USING btree ("category");