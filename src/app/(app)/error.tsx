"use client";

import { AlertTriangle } from "lucide-react";
import { useEffect } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";

export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <EmptyState
      icon={AlertTriangle}
      title="This page couldn't load"
      description={
        error.digest
          ? `Try again. If it keeps happening, give the owner this reference: ${error.digest}`
          : "Try again. If it keeps happening, tell the owner."
      }
      action={<Button onClick={reset}>Try again</Button>}
    />
  );
}
