import type { Role } from "@/generated/prisma/enums";

declare module "next-auth" {
  interface User {
    id: string;
    role: Role;
    branchId: string | null;
    sessionVersion: number;
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
    /** User.sessionVersion when issued; missing on tokens issued before it existed (treated as 0). */
    sv?: number;
  }
}
