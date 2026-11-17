import type { Metadata } from "next";
import { Suspense } from "react";
import { z } from "zod";

import { BranchesSection } from "@/app/(app)/settings/sections/branches-section";
import { BusinessForm } from "@/app/(app)/settings/sections/business-form";
import { MessagingSection } from "@/app/(app)/settings/sections/messaging-section";
import { SystemSection } from "@/app/(app)/settings/sections/system-section";
import { TemplateEditor } from "@/app/(app)/settings/sections/template-editor";
import { UsersSection } from "@/app/(app)/settings/sections/users-section";
import { FilterChips } from "@/components/filter-chips";
import { PageBody } from "@/components/shell/page-body";
import { PageSkeleton } from "@/components/shell/page-skeleton";
import { requirePageAccess } from "@/server/auth/session";
import { getBusinessSettings, listAdminBranches, listAdminUsers } from "@/server/services/admin.service";
import { getMessagingSetup, listTemplates } from "@/server/services/messaging-settings.service";
import { getSystemStatus } from "@/server/services/system.service";

export const metadata: Metadata = { title: "Settings" };

const SECTIONS = [
  { value: "business", label: "Business" },
  { value: "branches", label: "Branches" },
  { value: "users", label: "Users and roles" },
  { value: "templates", label: "Message templates" },
  { value: "messaging", label: "Messaging providers" },
  { value: "system", label: "System" },
] as const;
type Section = (typeof SECTIONS)[number]["value"];

const paramsSchema = z.object({
  section: z.enum(["business", "branches", "users", "templates", "messaging", "system"]).catch("business"),
  template: z.string().max(60).optional().catch(undefined),
});

export default function SettingsPage({ searchParams }: PageProps<"/settings">) {
  return (
    <Suspense fallback={<PageSkeleton />}>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

/** Settings (DESIGN.md §5.11): owner only. */
async function Content({ searchParams }: { searchParams: PageProps<"/settings">["searchParams"] }) {
  const ctx = await requirePageAccess("settings.view");
  const raw = await searchParams;
  const params = paramsSchema.parse(Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])));
  const section: Section = params.section;

  let body: React.ReactNode;
  if (section === "business") body = <BusinessForm initial={await getBusinessSettings(ctx)} />;
  else if (section === "branches") body = <BranchesSection branches={await listAdminBranches(ctx)} />;
  else if (section === "users") {
    const [users, branches] = await Promise.all([listAdminUsers(ctx), listAdminBranches(ctx)]);
    body = <UsersSection users={users} branches={branches} currentUserId={ctx.userId} />;
  } else if (section === "templates") body = <TemplateEditor templates={await listTemplates(ctx)} selectedKey={params.template ?? "receipt"} />;
  else if (section === "messaging") body = <MessagingSection setup={await getMessagingSetup(ctx)} />;
  else body = <SystemSection status={await getSystemStatus(ctx)} />;

  return (
    <PageBody className="flex flex-col gap-6">
      <FilterChips label="Settings sections" items={SECTIONS.map((s) => ({ label: s.label, href: s.value === "business" ? "/settings" : `/settings?section=${s.value}`, active: s.value === section }))} />
      {body}
    </PageBody>
  );
}
