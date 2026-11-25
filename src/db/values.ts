import { Decimal } from "./codec";
import { err } from "./errors";

export type SeamType =
  | { k: "int" }
  | { k: "decimal"; precision: number; scale: number }
  | { k: "text" }
  | { k: "bool" }
  | { k: "stamp" }
  | { k: "day" }
  | { k: "null" };

export type SeamValue =
  | { t: "null" }
  | { t: "int"; v: bigint }
  | { t: "decimal"; v: Decimal }
  | { t: "text"; v: string }
  | { t: "bool"; v: boolean }
  | { t: "stamp"; v: bigint }
  | { t: "day"; v: number };

export const I64_MIN = -9223372036854775808n;
export const I64_MAX = 9223372036854775807n;

export function typeName(ty: SeamType): string {
  switch (ty.k) {
    case "int":
      return "whole number";
    case "decimal":
      return `decimal(${ty.precision}, ${ty.scale})`;
    case "text":
      return "text";
    case "bool":
      return "yesno";
    case "stamp":
      return "stamp";
    case "day":
      return "day";
    case "null":
      return "null";
  }
}

export function valueType(v: SeamValue): SeamType {
  switch (v.t) {
    case "null":
      return { k: "null" };
    case "int":
      return { k: "int" };
    case "decimal":
      return { k: "decimal", precision: v.v.precision, scale: v.v.scale };
    case "text":
      return { k: "text" };
    case "bool":
      return { k: "bool" };
    case "stamp":
      return { k: "stamp" };
    case "day":
      return { k: "day" };
  }
}

export function displayValue(v: SeamValue): string {
  switch (v.t) {
    case "null":
      return "null";
    case "int":
      return v.v.toString();
    case "decimal":
      return v.v.toString();
    case "text":
      return JSON.stringify(v.v);
    case "bool":
      return v.v ? "yes" : "no";
    case "stamp":
      return v.v.toString();
    case "day":
      return String(v.v);
  }
}

export function checkInt(n: bigint): bigint {
  if (n < I64_MIN || n > I64_MAX) err("E_OVERFLOW", "whole number overflow.");
  return n;
}

export function sameType(a: SeamType, b: SeamType): boolean {
  if (a.k === "null" || b.k === "null") return true;
  if (a.k === "decimal" && b.k === "decimal") return true; // precision/scale are storage bounds
  if ((a.k === "int" && b.k === "decimal") || (a.k === "decimal" && b.k === "int")) return true; // exact widening
  return a.k === b.k;
}

export function unify(a: SeamType, b: SeamType): SeamType {
  if (a.k === "null") return b;
  if (b.k === "null") return a;
  // Whole numbers widen exactly into decimals; the decimal side wins.
  if (a.k === "int" && b.k === "decimal") return b;
  if (a.k === "decimal" && b.k === "int") return a;
  if (!sameType(a, b)) {
    err("E_TYPE_MISMATCH", `${typeName(a)} vs ${typeName(b)}. No implicit conversion was performed.`, {
      hint: "Try a value that matches the declared type.",
    });
  }
  return a;
}
