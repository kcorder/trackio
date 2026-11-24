import { expect, it } from "vitest";
import { normalizeView, readViews, writeViews } from "./savedViews.js";
it("round trips browser views and tolerates unavailable or invalid storage", () => {
  let value;
  const storage = {getItem:()=>value,setItem:(_key, next)=>{value=next;}};
  const view = normalizeView({bandMethod:"std", groupByKeys:["model"],panelsPerRow:3});
  expect(writeViews("key", {named:{example:view}, latest:view}, storage)).toBe(true);
  expect(readViews("key",storage).latest).toEqual(view);
  value = "{broken";
  expect(readViews("key",storage).latest).toBe(null);
  expect(writeViews("key",{}, {setItem(){throw new Error();}})).toBe(false);
  expect(normalizeView({configFilters:[[{}]]}).configFilters).toEqual([]);
});
