import type { Metadata } from "next";
import { UserLookup } from "@/components/user-lookup/user-lookup";

export const metadata: Metadata = { title: "Users" };

export default function UsersPage() {
  return (
    <main className="page">
      <h1 className="page__title">Find a user</h1>
      <UserLookup />
    </main>
  );
}
