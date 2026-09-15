import type {
  HomeAssistantEntityInformation,
  HomeAssistantEntityRegistry,
  HomeAssistantEntityState,
} from "@home-assistant-matter-hub/common";
import { describe, expect, it } from "vitest";
import { InputSelectDevice, SelectDevice } from "./index.js";

function createEntity(
  entityId: string,
  state: string,
  attributes: Record<string, unknown>,
): HomeAssistantEntityInformation {
  const registry: HomeAssistantEntityRegistry = {
    device_id: `${entityId}_device`,
    categories: {},
    entity_id: entityId,
    has_entity_name: false,
    id: entityId,
    original_name: entityId,
    platform: "test",
    unique_id: entityId,
  };
  const entityState: HomeAssistantEntityState = {
    entity_id: entityId,
    state,
    context: { id: "context" },
    last_changed: "2026-01-01T00:00:00",
    last_updated: "2026-01-01T00:00:00",
    attributes,
  };
  return { entity_id: entityId, registry, state: entityState };
}

function readSupportedModes(endpointType: unknown): {
  description: string;
  currentMode: number;
  supportedModes: Array<{
    label: string;
    mode: number;
    semanticTags: unknown[];
  }>;
} {
  // The endpoint type stores initial state under behaviors.<id>.defaults.
  // biome-ignore lint/suspicious/noExplicitAny: inspecting matter.js internals
  const behaviors = (endpointType as any).behaviors as Record<string, unknown>;
  // biome-ignore lint/suspicious/noExplicitAny: inspecting matter.js internals
  const modeSelect = behaviors.modeSelect as any;
  return {
    description: modeSelect.defaults.description as string,
    currentMode: modeSelect.defaults.currentMode as number,
    supportedModes: modeSelect.defaults.supportedModes,
  };
}

describe("SelectDevice / InputSelectDevice ModeSelect labels (#296)", () => {
  it("input_select: supportedModes carry the HA option names as labels", () => {
    const entity = createEntity("input_select.house_mode", "Night", {
      friendly_name: "House Mode",
      options: ["Home", "Night", "Away", "Vacation"],
    });

    const endpointType = InputSelectDevice({ entity } as never);
    expect(endpointType).toBeDefined();

    const { description, currentMode, supportedModes } = readSupportedModes(
      endpointType!,
    );
    expect(description).toBe("House Mode");
    expect(currentMode).toBe(1);
    expect(supportedModes).toEqual([
      { label: "Home", mode: 0, semanticTags: [] },
      { label: "Night", mode: 1, semanticTags: [] },
      { label: "Away", mode: 2, semanticTags: [] },
      { label: "Vacation", mode: 3, semanticTags: [] },
    ]);
  });

  it("select: supportedModes carry the HA option names as labels", () => {
    const entity = createEntity("select.thermostat_mode", "heat", {
      friendly_name: "Thermostat Mode",
      options: ["off", "heat", "cool", "auto"],
    });

    const endpointType = SelectDevice({ entity } as never);
    expect(endpointType).toBeDefined();

    const { description, currentMode, supportedModes } = readSupportedModes(
      endpointType!,
    );
    expect(description).toBe("Thermostat Mode");
    expect(currentMode).toBe(1);
    expect(supportedModes.map((m) => m.label)).toEqual([
      "off",
      "heat",
      "cool",
      "auto",
    ]);
  });

  it("long labels are truncated to 64 chars (TLV max length)", () => {
    const longLabel = "a".repeat(100);
    const entity = createEntity("input_select.long", "short", {
      friendly_name: "Long",
      options: ["short", longLabel],
    });

    const endpointType = InputSelectDevice({ entity } as never);
    const { supportedModes } = readSupportedModes(endpointType!);
    expect(supportedModes[0].label).toBe("short");
    expect(supportedModes[1].label).toHaveLength(64);
    expect(supportedModes[1].label).toBe("a".repeat(64));
  });

  it("uses custom labels while keeping the raw HA options for commands", () => {
    const rawOptions = ["C0", "C1", "C2", "C3", "C4", "C5"];
    const labels = [
      "Stufe 0",
      "Stufe 1",
      "Stufe 2",
      "Stufe 3",
      "Stufe 4",
      "Stufe 5",
    ];
    const entity = createEntity("select.kamin_flammenfarbe", "C4", {
      friendly_name: "Flammenfarbe",
      options: rawOptions,
    });

    const endpointType = SelectDevice({
      entity,
      customName: "Flammenfarbe",
      mapping: {
        entityId: "select.kamin_flammenfarbe",
        matterDeviceType: "mode_select",
        modeSelectOptions: labels,
      },
    } as never);
    expect(endpointType).toBeDefined();

    const { description, currentMode, supportedModes } = readSupportedModes(
      endpointType!,
    );
    expect(description).toBe("Flammenfarbe");
    expect(currentMode).toBe(4);
    expect(supportedModes.map((mode) => mode.label)).toEqual(labels);

    // biome-ignore lint/suspicious/noExplicitAny: inspect behavior config
    const behaviors = (endpointType as any).behaviors as Record<string, any>;
    const config = behaviors.modeSelect.defaults.config as {
      getOptions: (entity: HomeAssistantEntityInformation) => string[];
      getLabels: (
        entity: HomeAssistantEntityInformation,
        agent: unknown,
      ) => string[];
      selectOption: (option: string) => { action: string; data: unknown };
    };
    const agent = {
      get: () => ({
        state: {
          mapping: { modeSelectOptions: labels },
        },
      }),
    };
    expect(config.getOptions(entity)).toEqual(rawOptions);
    expect(config.getLabels(entity, agent)).toEqual(labels);
    expect(config.selectOption(config.getOptions(entity)[5])).toEqual({
      action: "select.select_option",
      data: { option: "C5" },
    });
  });

  it("keeps heating and flame as independent five-stage Mode Select devices", () => {
    const labels = ["Stufe 1", "Stufe 2", "Stufe 3", "Stufe 4", "Stufe 5"];
    const heating = createEntity(
      "input_select.kamin_matter_heizstufe_test",
      "Stufe 2",
      { friendly_name: "Heizstufe", options: labels },
    );
    const flame = createEntity("select.kamin_matter_flamme_test", "Stufe 4", {
      friendly_name: "Flamme",
      options: labels,
    });

    const heatingType = InputSelectDevice({
      entity: heating,
      customName: "Heizstufe",
      mapping: {
        entityId: heating.entity_id,
        matterDeviceType: "mode_select",
        modeSelectOptions: labels,
      },
    } as never);
    const flameType = SelectDevice({
      entity: flame,
      customName: "Flamme",
      mapping: {
        entityId: flame.entity_id,
        matterDeviceType: "mode_select",
        modeSelectOptions: labels,
      },
    } as never);

    const heatMode = readSupportedModes(heatingType!);
    const flameMode = readSupportedModes(flameType!);
    expect(heatMode.description).toBe("Heizstufe");
    expect(flameMode.description).toBe("Flamme");
    expect(heatMode.supportedModes.map((mode) => mode.label)).toEqual(labels);
    expect(flameMode.supportedModes.map((mode) => mode.label)).toEqual(labels);
    expect(heatMode.currentMode).toBe(1);
    expect(flameMode.currentMode).toBe(3);
  });

  it("returns undefined when options are missing", () => {
    const entity = createEntity("input_select.empty", "unknown", {});
    expect(InputSelectDevice({ entity } as never)).toBeUndefined();
    expect(SelectDevice({ entity } as never)).toBeUndefined();
  });

  it("input_select calls input_select.select_option, select calls select.select_option", () => {
    const inputEntity = createEntity("input_select.house_mode", "Home", {
      friendly_name: "House Mode",
      options: ["Home", "Away"],
    });
    const selectEntity = createEntity("select.thermostat_mode", "heat", {
      friendly_name: "Thermostat Mode",
      options: ["heat", "cool"],
    });

    const readAction = (endpointType: unknown): string => {
      // biome-ignore lint/suspicious/noExplicitAny: inspecting matter.js internals
      const behaviors = (endpointType as any).behaviors as Record<
        string,
        unknown
      >;
      // biome-ignore lint/suspicious/noExplicitAny: inspecting matter.js internals
      const modeSelect = behaviors.modeSelect as any;
      const config = modeSelect.defaults.config as {
        selectOption: (option: string) => { action: string };
      };
      return config.selectOption("whatever").action;
    };

    expect(
      readAction(InputSelectDevice({ entity: inputEntity } as never)),
    ).toBe("input_select.select_option");
    expect(readAction(SelectDevice({ entity: selectEntity } as never))).toBe(
      "select.select_option",
    );
  });
});
