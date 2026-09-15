import { describe, expect, it } from "vitest";
import { buildSupportedModes, modeSelectLogTag } from "./mode-select-server.js";

describe("buildSupportedModes", () => {
  it("keeps mode labels stable for runtime option updates", () => {
    expect(buildSupportedModes(["Home", "Night"])).toEqual([
      { label: "Home", mode: 0, semanticTags: [] },
      { label: "Night", mode: 1, semanticTags: [] },
    ]);
  });

  it("truncates labels to the Matter string limit", () => {
    expect(buildSupportedModes(["a".repeat(100)])[0].label).toBe(
      "a".repeat(64),
    );
  });
});

describe("Mode Select command log tags", () => {
  it("distinguishes the fireplace heating and flame controls", () => {
    expect(modeSelectLogTag("input_select.kamin_matter_heizstufe_test")).toBe(
      "HEAT_MODE",
    );
    expect(modeSelectLogTag("select.kamin_matter_flamme_test")).toBe(
      "FLAME_MODE",
    );
  });

  it("keeps a generic tag for unrelated Mode Select entities", () => {
    expect(modeSelectLogTag("select.house_mode")).toBe("MODE_SELECT");
  });
});
