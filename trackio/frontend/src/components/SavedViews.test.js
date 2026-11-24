import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import Harness from "./SavedViewsTestHarness.svelte";
import { VIEW_DEFAULTS } from "../lib/savedViews.js";

let app;
let target;
const button = (text) => [...target.querySelectorAll("button")].find((node) => node.textContent === text);
const select = () => target.querySelector("select");
const label = () => select().selectedOptions[0].textContent;

beforeEach(() => {
  localStorage.clear();
  target = document.createElement("div");
  document.body.appendChild(target);
  vi.stubGlobal("prompt", vi.fn(() => "My view"));
  vi.stubGlobal("confirm", vi.fn(() => true));
});

afterEach(async () => {
  await unmount(app);
  target.remove();
  vi.unstubAllGlobals();
});

it("shows the current name, marks edits, and saves without asking for the name again", async () => {
  app = mount(Harness, {target});
  await tick();
  button("Save").click();
  await tick();
  expect(label()).toBe("My view");
  expect(button("Save").disabled).toBe(true);
  button("Change filter").click();
  await tick();
  expect(label()).toBe("My view *");
  expect(button("Save").disabled).toBe(false);
  button("Save").click();
  await tick();
  expect(label()).toBe("My view");
  expect(prompt).toHaveBeenCalledTimes(1);
  expect(JSON.parse(localStorage.getItem("test-views")).named["My view"].filterText).toBe("train");
  button("Delete").click();
  await tick();
  expect(label()).toBe("Unsaved view *");
  expect(button("Delete").disabled).toBe(true);
});

it("opens a selected view directly and restores the active name", async () => {
  localStorage.setItem("test-views", JSON.stringify({version:1, active:"Base", named:{Base:VIEW_DEFAULTS, Other:{...VIEW_DEFAULTS,filterText:"eval"}}}));
  app = mount(Harness, {target});
  await tick();
  expect(label()).toBe("Base");
  select().value = "Other";
  select().dispatchEvent(new Event("change", {bubbles:true}));
  await tick();
  expect(target.querySelector("output").textContent).toBe("eval");
  expect(label()).toBe("Other");
  expect(JSON.parse(localStorage.getItem("test-views")).active).toBe("Other");
});

it("keeps dirty changes when switching views is cancelled", async () => {
  localStorage.setItem("test-views", JSON.stringify({version:1, active:"Base", named:{Base:VIEW_DEFAULTS, Other:{...VIEW_DEFAULTS,filterText:"eval"}}}));
  app = mount(Harness, {target});
  await tick();
  button("Change filter").click();
  await tick();
  confirm.mockReturnValue(false);
  select().value = "Other";
  select().dispatchEvent(new Event("change", {bubbles:true}));
  await tick();
  expect(label()).toBe("Base *");
  expect(target.querySelector("output").textContent).toBe("train");
});
