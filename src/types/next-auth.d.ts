import type { Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    id: string;
    role: Role;
    branchId: string | null;
  }

  interface Session {
    user: {
      id: string;
      name: string;
      email: string;
      role: Role;
      branchId: string | null;
    };
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    userId: string;
    role: Role;
    branchId: string | null;
  }
}
