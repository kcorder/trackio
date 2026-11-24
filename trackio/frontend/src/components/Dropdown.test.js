import { expect, it, vi } from "vitest";
import { mount, tick, unmount } from "svelte";
import Dropdown from "./Dropdown.svelte";

it.each(["blur", "mouse", "keyboard"])("clears grouping choices selected using %s", async (method) => {
  const target = document.createElement("div");
  document.body.appendChild(target);
  const onSelect = vi.fn();
  const component = mount(Dropdown, {
    target,
    props: {
      choices: [{ label: "Model", value: "model" }],
      clearOnSelect: true,
      onSelect,
    },
  });
  try {
    await tick();
    const input = target.querySelector("input");
    input.focus();
    input.value = "Model";
    input.dispatchEvent(new Event("input"));
    await tick();
    if (method === "blur") input.blur();
    else if (method === "mouse") {
      target.querySelector("li").dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    } else {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    }
    await tick();
    await vi.waitFor(() => expect(onSelect).toHaveBeenCalledExactlyOnceWith("model"));
    expect(input.value).toBe("");
  } finally {
    await unmount(component);
    target.remove();
  }
});
