"use client";

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useUrlParams } from "@/hooks/use-url-params";

const ANY = "__any";

/** Toolbar select bound to a query param. The "any" option clears the param. */
export function ParamSelect({
  param,
  label,
  anyLabel,
  options,
  defaultValue,
}: {
  param: string;
  label: string;
  anyLabel: string;
  options: { value: string; label: string }[];
  /** Value meaning "no param in the URL" when it isn't "any" (e.g. status defaults to In stock). */
  defaultValue?: string;
}) {
  const { searchParams, setParams } = useUrlParams();
  const current = searchParams.get(param) ?? defaultValue ?? ANY;

  return (
    <Select
      value={current}
      onValueChange={(value) => setParams({ [param]: value === (defaultValue ?? ANY) ? null : value })}
    >
      <SelectTrigger aria-label={label} className="min-w-40">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {defaultValue === undefined && <SelectItem value={ANY}>{anyLabel}</SelectItem>}
        {options.map((option) => (
          <SelectItem key={option.value} value={option.value}>
            {option.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
